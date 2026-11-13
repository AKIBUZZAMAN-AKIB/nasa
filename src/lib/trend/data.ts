/**
 * Data access for the explorer. Everything here runs in the browser:
 * - NASA POWER monthly regional grids (MERRA-2, CERES): live, CORS-enabled.
 * - NASA POWER daily point series (GPM IMERG): live, summed to months.
 * - ERA5 daily via Open-Meteo: live, used only to check dataset agreement.
 * - Bundled samples in static/trend-samples (MODIS NDVI/NPP, MUR SST,
 *   MODIS chlorophyll, NSIDC sea ice), built by scripts/fetch-trend-samples.py.
 */
import { type Region, inRegion, requestBox } from './regions';

import type { Monthly } from './analyze';
import type { Variable } from './catalog';

const POWER = 'https://power.larc.nasa.gov/api/temporal';
const OPEN_METEO = 'https://archive-api.open-meteo.com/v1/archive';
const FILL = -999;

export interface Cell {
	lon: number;
	lat: number;
	monthly: Monthly;
}

export interface RegionData {
	monthly: Monthly;
	/** Yearly values for yearly-only datasets (MODIS NPP). */
	annual?: Map<number, number>;
	/** Grid cells inside the region (POWER grids only), for the 'where' map. */
	cells?: Cell[];
	/** How the region value was formed, shown under the chart. */
	method: string;
	/** Source URL that was actually requested, for transparency. */
	requestUrl: string;
	/** For bundled samples: retrieval date and description from the file. */
	sample?: {
		retrieved: string;
		dataset: string;
		source: string;
		sites: { id: string; lat: number; lon: number }[];
	};
}

const cache = new Map<string, Promise<unknown>>();

/** How long one remote answer may take before it counts as failed. */
const FETCH_TIMEOUT_MS = 60_000;

/**
 * Share one download between every caller that asks for the same URL. The
 * shared download runs on its own timeout, never on a caller's signal: when
 * one caller is cancelled (the user picked something else), the others still
 * get the answer. Each caller stops waiting when its own signal aborts.
 */
function memo<T>(
	key: string,
	load: (signal: AbortSignal) => Promise<T>,
	signal?: AbortSignal
): Promise<T> {
	let shared = cache.get(key) as Promise<T> | undefined;
	if (!shared) {
		shared = load(AbortSignal.timeout(FETCH_TIMEOUT_MS)).catch((e) => {
			cache.delete(key);
			throw e;
		});
		cache.set(key, shared);
	}
	return untilAborted(shared, signal);
}

/** Resolve with the promise, or reject with an AbortError as soon as the signal aborts. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			(v) => {
				signal.removeEventListener('abort', onAbort);
				resolve(v);
			},
			(e) => {
				signal.removeEventListener('abort', onAbort);
				reject(e);
			}
		);
	});
}

export class DataError extends Error {}

const CACHE_NAME = 'trend-explorer-v1';
/** Remote answers are kept for a day: monthly archives change at most once a month. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Read a fresh copy of a remote answer from the browser's Cache Storage. */
async function cachedJson(url: string): Promise<unknown | undefined> {
	if (typeof caches === 'undefined' || !/^https?:\/\//.test(url)) return undefined;
	try {
		const cache = await caches.open(CACHE_NAME);
		const hit = await cache.match(url);
		if (!hit) return undefined;
		const saved = Number(hit.headers.get('x-saved-at') ?? 0);
		if (Date.now() - saved > CACHE_TTL_MS) {
			await cache.delete(url);
			return undefined;
		}
		return await hit.json();
	} catch {
		return undefined;
	}
}

async function storeJson(url: string, body: unknown): Promise<void> {
	if (typeof caches === 'undefined' || !/^https?:\/\//.test(url)) return;
	try {
		const cache = await caches.open(CACHE_NAME);
		await cache.put(
			url,
			new Response(JSON.stringify(body), {
				headers: { 'content-type': 'application/json', 'x-saved-at': String(Date.now()) }
			})
		);
	} catch {
		/* storage full or blocked: caching is only an optimisation */
	}
}

async function getJson(url: string, signal?: AbortSignal, tries = 3): Promise<unknown> {
	const saved = await cachedJson(url);
	if (saved !== undefined) return saved;
	let lastError: unknown;
	for (let attempt = 0; attempt < tries; attempt++) {
		try {
			const res = await fetch(url, { signal });
			if (res.ok) {
				const body = await res.json();
				void storeJson(url, body);
				return body;
			}
			let detail = '';
			try {
				const body = await res.json();
				detail = (body?.messages ?? body?.reason ?? body?.message ?? '').toString();
			} catch {
				/* not JSON */
			}
			lastError = new DataError(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
			if (res.status < 500 && res.status !== 429) break;
		} catch (e) {
			if ((e as Error).name === 'TimeoutError' || signal?.aborted) {
				throw new DataError('The data server took too long to answer. Please try again.');
			}
			if ((e as Error).name === 'AbortError') throw e;
			lastError = e;
		}
		await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
	}
	throw lastError instanceof Error ? lastError : new DataError(String(lastError));
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parse POWER's {YYYYMM: value} objects (month 13 is the annual value and is dropped). */
export function parsePowerMonthly(
	record: Record<string, number>,
	opts: { scale?: number; perDay?: boolean } = {}
): Monthly {
	const out: Monthly = new Map();
	for (const [key, raw] of Object.entries(record)) {
		const year = Number(key.slice(0, 4));
		const month = Number(key.slice(4, 6));
		if (!(month >= 1 && month <= 12) || raw === FILL || raw === null || !Number.isFinite(raw))
			continue;
		let v = raw * (opts.scale ?? 1);
		if (opts.perDay) v *= daysInMonth(year, month);
		out.set(year * 100 + month, v);
	}
	return out;
}

/** Sum daily {YYYYMMDD: value} into monthly totals; months need 90% of their days. */
export function dailyToMonthly(record: Record<string, number>, agg: 'sum' | 'mean'): Monthly {
	const sums = new Map<number, { total: number; count: number }>();
	for (const [key, raw] of Object.entries(record)) {
		if (raw === FILL || raw === null || !Number.isFinite(raw)) continue;
		const ym = Number(key.slice(0, 6));
		const s = sums.get(ym) ?? { total: 0, count: 0 };
		s.total += raw;
		s.count++;
		sums.set(ym, s);
	}
	const out: Monthly = new Map();
	for (const [ym, { total, count }] of sums) {
		const days = daysInMonth(Math.floor(ym / 100), ym % 100);
		if (count < days * 0.9) continue;
		out.set(ym, agg === 'sum' ? (total / count) * days : total / count);
	}
	return out;
}

/** Area-weighted (cos latitude) mean of several monthly series, month by month. */
export function meanOfSeries(
	series: { lat: number; monthly: Monthly }[],
	minShare = 0.75
): Monthly {
	const keys = new Set<number>();
	for (const s of series) for (const k of s.monthly.keys()) keys.add(k);
	const out: Monthly = new Map();
	for (const k of keys) {
		let sum = 0;
		let weight = 0;
		let count = 0;
		for (const s of series) {
			const v = s.monthly.get(k);
			if (v === undefined) continue;
			const w = Math.cos((s.lat * Math.PI) / 180);
			sum += v * w;
			weight += w;
			count++;
		}
		if (count >= Math.max(1, Math.ceil(series.length * minShare))) out.set(k, sum / weight);
	}
	return out;
}

function thisYear(): number {
	return new Date().getUTCFullYear();
}

interface PowerFeature {
	geometry: { coordinates: [number, number, number?] };
	properties: { parameter: Record<string, Record<string, number>> };
}

/** Pick the cells inside the region, or the one nearest its centre when none is inside. */
export function selectCells(region: Region, cells: Cell[]): Cell[] {
	const inside = cells.filter((c) => inRegion(region, c.lon, c.lat));
	if (inside.length) return inside;
	const [lon, lat] = region.center;
	const nearest = cells.reduce<Cell | undefined>((best, c) => {
		const d = (c.lon - lon) ** 2 + (c.lat - lat) ** 2;
		return !best || d < (best.lon - lon) ** 2 + (best.lat - lat) ** 2 ? c : best;
	}, undefined);
	return nearest ? [nearest] : [];
}

async function powerMonthly(
	variable: Variable & { source: { kind: 'power-monthly' } },
	region: Region,
	signal?: AbortSignal
): Promise<RegionData> {
	const [w, s, e, n] = requestBox(region);
	const { parameter, scale, perDay } = variable.source;
	const url =
		`${POWER}/monthly/regional?parameters=${parameter}&community=AG` +
		`&latitude-min=${s}&latitude-max=${n}&longitude-min=${w}&longitude-max=${e}` +
		`&start=${variable.dataset.firstYear}&end=${thisYear()}&format=JSON`;
	const body = (await memo(url, (s) => getJson(url, s), signal)) as {
		features?: PowerFeature[];
		messages?: string[];
	};
	if (!body.features?.length)
		throw new DataError(body.messages?.join(' ') || 'NASA POWER returned no grid cells.');
	const all: Cell[] = body.features.map((f) => ({
		lon: f.geometry.coordinates[0],
		lat: f.geometry.coordinates[1],
		monthly: parsePowerMonthly(f.properties.parameter[parameter] ?? {}, { scale, perDay })
	}));
	const withData = all.filter((c) => c.monthly.size > 0);
	const cells = selectCells(region, withData);
	if (!cells.length) {
		throw new DataError(
			`NASA POWER has no ${variable.name.toLowerCase()} values for ${region.name} (this parameter is not defined over ${variable.domain === 'land' ? 'water' : 'this surface'}).`
		);
	}
	const method =
		cells.length === 1
			? `Grid cell at ${cells[0].lat.toFixed(2)}°, ${cells[0].lon.toFixed(3)}° (nearest to the region).`
			: `Area-weighted mean of ${cells.length} grid cells inside ${region.name.replace(/ \(.*\)$/, '')}.`;
	return { monthly: meanOfSeries(cells), cells, method, requestUrl: url };
}

/** Up to five sample points: the centre and, for larger regions, four inner points. */
export function samplePoints(region: Region): [number, number][] {
	const [w, s, e, n] = region.bbox;
	const pts: [number, number][] = [region.center];
	if (e - w >= 1 && n - s >= 1) {
		for (const fx of [0.3, 0.7]) {
			for (const fy of [0.3, 0.7]) {
				const lon = w + (e - w) * fx;
				const lat = s + (n - s) * fy;
				if (inRegion(region, lon, lat)) pts.push([lon, lat]);
			}
		}
	}
	return pts;
}

async function powerDaily(
	variable: Variable & { source: { kind: 'power-daily' } },
	region: Region,
	signal?: AbortSignal
): Promise<RegionData> {
	const { parameter, firstYear } = variable.source;
	const end = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10).replaceAll('-', '');
	const points = samplePoints(region);
	const urls = points.map(
		([lon, lat]) =>
			`${POWER}/daily/point?parameters=${parameter}&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}` +
			`&start=${firstYear}0101&end=${end}&format=JSON&time-standard=utc`
	);
	// The sample points are independent requests: fetch them side by side.
	const bodies = (await Promise.all(
		urls.map((url) => memo(url, (s) => getJson(url, s), signal))
	)) as { properties?: { parameter?: Record<string, Record<string, number>> } }[];
	const series: { lat: number; monthly: Monthly }[] = [];
	bodies.forEach((body, i) => {
		const record = body.properties?.parameter?.[parameter];
		if (record) series.push({ lat: points[i][1], monthly: dailyToMonthly(record, variable.agg) });
	});
	if (!series.length) throw new DataError('NASA POWER returned no daily values.');
	return {
		monthly: meanOfSeries(series),
		method:
			series.length === 1
				? 'Daily values at the region centre, added up month by month.'
				: `Mean of ${series.length} sample points across the region; daily values added up month by month.`,
		requestUrl: urls[0]
	};
}

interface SampleFile {
	dataset: string;
	source: string;
	url: string;
	retrieved: string;
	method: string;
	unit: string;
	sites: Record<
		string,
		{ lat: number; lon: number; monthly?: Record<string, number>; annual?: Record<string, number> }
	>;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const r = Math.PI / 180;
	const a =
		Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
		Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
	return 12742 * Math.asin(Math.sqrt(a));
}

async function sample(
	variable: Variable & { source: { kind: 'sample' | 'regional' } },
	region: Region,
	assetBase: string,
	signal?: AbortSignal
): Promise<RegionData> {
	const url = `${assetBase}/trend-samples/${variable.source.file}`;
	const file = (await memo(url, (s) => getJson(url, s), signal)) as SampleFile;
	const keyed = variable.source.kind === 'regional';
	let ids = keyed
		? file.sites[region.id]
			? [region.id]
			: []
		: region.sampleSites.filter((id) => file.sites[id]);
	if (!ids.length && !keyed && region.group === 'Custom') {
		const [lon, lat] = region.center;
		const near = Object.entries(file.sites)
			.map(([id, s]) => ({ id, d: distanceKm(lat, lon, s.lat, s.lon) }))
			.sort((a, b) => a.d - b.d)[0];
		if (near && near.d <= 60) ids = [near.id];
	}
	if (!ids.length) {
		throw new DataError(
			`${variable.dataset.name} is precomputed only for ${keyed ? 'the listed regions' : 'its sample sites'}, and ${region.name} is not one of them. Pick one of the suggested regions.`
		);
	}
	const sites = ids.map((id) => ({ id, ...file.sites[id] }));
	const meta = {
		retrieved: file.retrieved,
		dataset: file.dataset,
		source: file.source,
		sites: sites.map(({ id, lat, lon }) => ({ id, lat, lon }))
	};
	const where = keyed
		? `the precomputed mean for ${region.name}`
		: sites.length === 1
			? `the sample site at ${sites[0].lat.toFixed(2)}°, ${sites[0].lon.toFixed(2)}°`
			: `the mean of ${sites.length} sample sites`;
	if (variable.source.kind === 'sample' && variable.source.annualOnly) {
		const series = sites.map((s) => ({
			lat: s.lat,
			monthly: new Map(Object.entries(s.annual ?? {}).map(([y, v]) => [Number(y) * 100 + 1, v]))
		}));
		const merged = meanOfSeries(series);
		const annual = new Map([...merged].map(([k, v]) => [Math.floor(k / 100), v]));
		return {
			monthly: new Map(),
			annual,
			method: `Bundled sample: ${where}. ${file.method}`,
			requestUrl: file.url,
			sample: meta
		};
	}
	const series = sites.map((s) => ({
		lat: s.lat,
		monthly: new Map(
			Object.entries(s.monthly ?? {}).map(([k, v]) => [Number(k), v] as [number, number])
		)
	}));
	return {
		monthly: meanOfSeries(series),
		method: `Bundled sample: ${where}. ${file.method}`,
		requestUrl: file.url,
		sample: meta
	};
}

export async function loadRegionData(
	variable: Variable,
	region: Region,
	assetBase: string,
	signal?: AbortSignal
): Promise<RegionData> {
	const src = variable.source;
	if (src.kind === 'power-monthly') return powerMonthly(variable as never, region, signal);
	if (src.kind === 'power-daily') return powerDaily(variable as never, region, signal);
	return sample(variable as never, region, assetBase, signal);
}

/** ERA5 daily values for the region centre via Open-Meteo, aggregated to months. */
export async function loadEra5Monthly(
	era5Variable: string,
	agg: 'sum' | 'mean',
	region: Region,
	firstYear: number,
	signal?: AbortSignal
): Promise<Monthly> {
	// One point (the centre): the free API weighs a 45-year request heavily,
	// so several points would hit its per-minute limit.
	const points: [number, number][] = [region.center];
	const end = new Date(Date.now() - 86400000 * 7).toISOString().slice(0, 10);
	const url =
		`${OPEN_METEO}?latitude=${points.map((p) => p[1].toFixed(3)).join(',')}` +
		`&longitude=${points.map((p) => p[0].toFixed(3)).join(',')}` +
		`&start_date=${firstYear}-01-01&end_date=${end}&daily=${era5Variable}&models=era5&timezone=GMT`;
	type Body = {
		latitude?: number;
		daily?: { time: string[]; [k: string]: (number | null)[] | string[] };
	};
	const raw = (await memo(url, (s) => getJson(url, s, 2), signal)) as Body | Body[];
	const bodies = Array.isArray(raw) ? raw : [raw];
	const series: { lat: number; monthly: Monthly }[] = [];
	bodies.forEach((body, i) => {
		const daily = body.daily;
		if (!daily) return;
		const values = daily[era5Variable] as (number | null)[];
		const record: Record<string, number> = {};
		daily.time.forEach((t, k) => {
			const v = values[k];
			if (v !== null && v !== undefined) record[t.replaceAll('-', '')] = v;
		});
		if (Object.keys(record).length) {
			series.push({ lat: body.latitude ?? points[i][1], monthly: dailyToMonthly(record, agg) });
		}
	});
	if (!series.length) throw new DataError('Open-Meteo returned no data.');
	return meanOfSeries(series);
}

interface ReferenceFile {
	retrieved: string;
	datasets: Record<string, { name: string; unit: string; resolution: string; url: string }>;
	series: Record<string, Record<string, { cells: number; monthly: Record<string, number> }>>;
}

/**
 * Precomputed monthly reference series for the predefined land regions from
 * independent NOAA PSL products (see scripts/fetch-reference.py). Rain in
 * mm/day becomes a monthly total for 'sum' variables.
 */
export async function loadReferenceMonthly(
	key: string,
	agg: 'sum' | 'mean',
	region: Region,
	assetBase: string,
	signal?: AbortSignal
): Promise<Monthly> {
	const url = `${assetBase}/trend-samples/reference-psl.json`;
	const file = (await memo(url, (s) => getJson(url, s), signal)) as ReferenceFile;
	const site = file.series[key]?.[region.id];
	if (!site) throw new DataError(`No precomputed reference series for ${region.name}.`);
	const perDay = file.datasets[key]?.unit === 'mm/day' && agg === 'sum';
	const monthly: Monthly = new Map();
	for (const [k, v] of Object.entries(site.monthly)) {
		const ym = Number(k);
		monthly.set(ym, perDay ? v * daysInMonth(Math.floor(ym / 100), ym % 100) : v);
	}
	return monthly;
}
