/**
 * Data-source adapters for the Historical analysis panel.
 *
 * Both adapters return the same `AnalysisSeries` shape so every statistic and
 * D3 chart is source-agnostic.
 *
 * NASA POWER (https://power.larc.nasa.gov/docs/services/api/):
 * - The parameter catalog is read live from `/api/system/manager/parameters`
 *   per community and temporal level (daily ≈ 152, monthly ≈ 1388 codes).
 *   Calculated parameters (PSC, WSC) need extra inputs and are excluded.
 * - One point request returns the full 1981→last-complete-year record of one
 *   parameter (≈ 16k daily values, ~0.3 MB). It is cached per
 *   community + temporal + code + location, so changing the analysis period
 *   or baseline is a client-side slice rather than another request.
 * - Community is part of the key because AG and RE report 35 radiation
 *   parameters in different units (MJ/m²/day vs kWh/m²/day).
 * - `time-standard=utc` is required for IMERG and keeps POWER days aligned
 *   with the Open-Meteo (timezone=UTC) days used by the comparison.
 * - Monthly responses carry a 13th "month" (annual value): it is ignored and
 *   annual values are recomputed with explicit completeness rules.
 * - Regional requests are limited to one parameter and ≤ 10° per axis; daily
 *   regional requests are limited to 366 days, so long-term spatial trends use
 *   monthly regional data (observed grid 0.5° × 0.625° for MERRA-2).
 */
import {
	ArchiveError,
	type ArchiveModel,
	OPEN_METEO_ARCHIVE_BASE,
	dailyAggregateFor,
	fetchArchiveSeriesCached,
	getArchiveModel,
	getArchiveVariable,
	scheduleArchiveRequest
} from '$lib/stores/archive';

import {
	type PowerBounds,
	type PowerCommunity,
	type PowerJsonResponse,
	type PowerParameterMetadata,
	buildPowerTemporalUrl,
	numericPowerValue,
	powerJsonError,
	powerParameterCatalogUrl,
	powerSourceResolutionNotes
} from '$lib/nasa-power';

import type { AggregateKind, SampleResolution, TimePoint } from './analysis-stats';

export type AnalysisSource = 'open-meteo' | 'nasa-power';
export type PowerAnalysisTemporal = 'daily' | 'monthly';

export const POWER_START_YEAR = 1981;
/** POWER solar (SRB → CERES) daily/monthly records start on 1984-01-01. */
export const POWER_SOLAR_START_YEAR = 1984;
/** IMERG precipitation in POWER starts in 2001 (daily, UTC). */
export const POWER_IMERG_START_YEAR = 2001;

export interface AnalysisSeries {
	/** Stable cache identity. */
	id: string;
	source: AnalysisSource;
	/** e.g. "ERA5 · Open-Meteo" or "NASA POWER · AG". */
	sourceLabel: string;
	code: string;
	label: string;
	definition?: string;
	/** Unit of one sample as reported by the API (prettified later). */
	unit: string;
	resolution: SampleResolution;
	aggregate: AggregateKind;
	/** Valid samples, ascending, over the full fetched range. */
	points: TimePoint[];
	totalCount: number;
	missingCount: number;
	latitude: number;
	longitude: number;
	elevation?: number;
	/** Data-provenance notes shown with the charts. */
	notes: string[];
	/** POWER source identifiers from the response header (MERRA2, SYN1DEG …). */
	sources?: string[];
	/** Category used to colour charts and pick caveats. */
	category?: string;
}

// ---------------------------------------------------------------------------
// Request queue for POWER (separate host, gentle spacing)
// ---------------------------------------------------------------------------

const POWER_MIN_INTERVAL_MS = 350;
let powerQueue: Promise<unknown> = Promise.resolve();
let powerLastCall = 0;

function schedulePower<T>(task: () => Promise<T>): Promise<T> {
	const next = powerQueue.then(async () => {
		const wait = Math.max(0, powerLastCall + POWER_MIN_INTERVAL_MS - Date.now());
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		powerLastCall = Date.now();
		return task();
	});
	powerQueue = next.catch(() => undefined);
	return next;
}

async function fetchPowerJson(url: URL | string, signal?: AbortSignal): Promise<PowerJsonResponse> {
	return schedulePower(async () => {
		const response = await fetch(url, { signal });
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new Error(`NASA POWER returned a non-JSON response (${response.status}).`);
		}
		if (!response.ok) {
			const message = powerJsonError(body) ?? `NASA POWER request failed (${response.status}).`;
			throw new Error(message);
		}
		return body as PowerJsonResponse;
	});
}

// ---------------------------------------------------------------------------
// POWER catalog
// ---------------------------------------------------------------------------

export interface PowerCatalogEntry {
	code: string;
	name: string;
	definition: string;
	units: string;
	type: string;
}

const catalogCache = new Map<string, Promise<PowerCatalogEntry[]>>();

export function parsePowerCatalog(body: unknown): PowerCatalogEntry[] {
	if (!body || typeof body !== 'object') return [];
	const entries: PowerCatalogEntry[] = [];
	for (const [code, raw] of Object.entries(body as Record<string, PowerParameterMetadata>)) {
		if (!raw || typeof raw !== 'object') continue;
		if (raw.calculated) continue;
		entries.push({
			code,
			name: String(raw.name ?? raw.longname ?? code),
			definition: String(raw.definition ?? ''),
			units: String(raw.units ?? ''),
			type: String(raw.type ?? 'OTHER')
		});
	}
	entries.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
	return entries;
}

export function fetchPowerCatalog(
	community: PowerCommunity,
	temporal: PowerAnalysisTemporal
): Promise<PowerCatalogEntry[]> {
	const key = `${community}|${temporal}`;
	let hit = catalogCache.get(key);
	if (!hit) {
		hit = fetchPowerJson(powerParameterCatalogUrl(community, temporal)).then(parsePowerCatalog);
		hit.catch(() => catalogCache.delete(key));
		catalogCache.set(key, hit);
	}
	return hit;
}

// ---------------------------------------------------------------------------
// Thematic grouping (POWER's own `type` is only METEOROLOGY / RADIATION / …)
// ---------------------------------------------------------------------------

/**
 * User-facing themes, modelled on the Copernicus Interactive Climate Atlas,
 * which groups its variables as heat & cold, wet & dry, wind & radiation, …
 * Order here is the display order in the parameter picker.
 */
export const POWER_THEMES = [
	{ key: 'temperature', label: 'Temperature' },
	{ key: 'precipitation', label: 'Precipitation & snow' },
	{ key: 'humidity', label: 'Humidity & water vapour' },
	{ key: 'wind', label: 'Wind' },
	{ key: 'radiation', label: 'Solar & radiation' },
	{ key: 'cloud', label: 'Cloud' },
	{ key: 'soil', label: 'Soil & land surface' },
	{ key: 'atmosphere', label: 'Pressure & atmosphere' },
	{ key: 'indices', label: 'Agro & energy indices' },
	{ key: 'other', label: 'Other' }
] as const;

export type PowerTheme = (typeof POWER_THEMES)[number]['key'];

/** Theme of a POWER parameter code (daily, monthly and hourly codes alike). */
export function powerTheme(code: string): PowerTheme {
	// Monthly diurnal variants (`PS_00` … `PS_23`, `PS_HR`) share their base theme.
	const c = code.toUpperCase().replace(/_(\d\d|HR)$/, '');
	if (/^SG_/.test(c)) return 'radiation';
	// Order matters: indices before radiation (CLRSKY_DAYS), humidity before
	// temperature (T2MDEW, T2MWET), soil before temperature (TSOIL*).
	if (/^(CDD|HDD|GDD)\d|^FROST_DAYS|^CLRSKY_DAYS|^PSH$/.test(c)) return 'indices';
	if (/^CLOUD_/.test(c)) return 'cloud';
	if (/PREC|^IMERG_|^SNODP|^FRSNO|^FRSEAICE/.test(c)) return 'precipitation';
	if (/^(GWET|PRMC|RZMC|SFMC|TSOIL)|^EVLAND|^EVPTRNS|^Z0M$|^DISPH$/.test(c)) return 'soil';
	if (/^RH2M|^QV\d|^T2MDEW|^T2MWET|^PW$|^TQV$|^TROPQ/.test(c)) return 'humidity';
	if (/^(WS|WD|U|V)\d|^WSC$/.test(c)) return 'wind';
	if (/^(PS|PSC|SLP|PBLTOP|RHOA|TO3)$|^TROP|^GWM_|^AOD/.test(c)) return 'atmosphere';
	if (/SKY_|^TOA_|^(SW|LW)LAND|^MIDDAY|^AIRMASS|^SZA|ALB|_KT$|PAR_|UV/.test(c)) return 'radiation';
	if (/^T(2M|10M|S|SURF)(_|$)|^TS_/.test(c)) return 'temperature';
	return 'other';
}

/** Codes surfaced as one-click picks; all exist in the daily and monthly catalogs. */
export const POWER_QUICK_PICKS = [
	'T2M',
	'T2M_MAX',
	'T2M_MIN',
	'PRECTOTCORR',
	'IMERG_PRECTOT',
	'RH2M',
	'WS10M',
	'ALLSKY_SFC_SW_DWN',
	'GWETROOT',
	'T2MWET'
];

// ---------------------------------------------------------------------------
// Aggregation semantics per POWER parameter
// ---------------------------------------------------------------------------

/**
 * How a POWER parameter aggregates over time.
 * - `rate`: mm/day amounts (precipitation, snowfall, evaporation). Daily
 *   values sum to totals; monthly values are mean daily rates.
 * - `count`: degree-days and day counts; monthly values are monthly totals,
 *   as are monthly `*_SUM` parameters (verified: PRECTOTCORR_SUM 2020-07 =
 *   451.9 mm while PRECTOTCORR = 14.58 mm/day).
 * - `circular`: wind direction in degrees.
 */
export function powerAggregateKind(code: string, units: string): AggregateKind {
	const upper = code.toUpperCase();
	if (/^WD\d/.test(upper)) return 'circular';
	if (/_SUM$/.test(upper)) return 'count';
	if (units === 'degree-day-c' || units === 'Days') return 'count';
	if (units === 'mm/day') return 'rate';
	return 'mean';
}

/** Earliest year with valid data for a POWER parameter. */
export function powerStartYear(code: string, type?: string): number {
	if (/^IMERG_/i.test(code)) return POWER_IMERG_START_YEAR;
	if ((type ?? '').toUpperCase() === 'RADIATION') return POWER_SOLAR_START_YEAR;
	return POWER_START_YEAR;
}

/** Bengal delta bounding box used for the region-specific precipitation caveat. */
function inBengal(lat: number, lon: number): boolean {
	return lat >= 20 && lat <= 27.5 && lon >= 85 && lon <= 93.5;
}

/** Provenance caveats for a POWER parameter over a period. */
export function powerParameterNotes(
	code: string,
	type: string | undefined,
	startYear: number,
	endYear: number,
	latitude: number,
	longitude: number
): string[] {
	const notes: string[] = [];
	const t = (type ?? '').toUpperCase();
	if (/^IMERG_/i.test(code)) {
		notes.push('GPM IMERG precipitation at 0.1°, daily UTC; available from 2001.');
	} else if (t === 'RADIATION') {
		notes.push(
			'Solar fluxes: GEWEX SRB (1984–2000) → CERES SYN1deg (2001→) → FLASHFlux near real time, on a 1° grid.'
		);
		if (startYear <= 2000 && endYear >= 2001) {
			notes.push(
				'This period spans the SRB → CERES source change in 2001; NASA advises against interpreting trends across it.'
			);
		}
	} else {
		notes.push(
			'Meteorology: MERRA-2 reanalysis (0.5° × 0.625°) with GEOS-IT for the latest months.'
		);
	}
	if (/^PREC/i.test(code)) {
		notes.push(
			'MERRA-2 corrected precipitation is forced by gauge analyses; network changes can create artificial steps (Reichle et al. 2017).'
		);
	}
	if (inBengal(latitude, longitude) && t !== 'RADIATION' && !/^IMERG_/i.test(code)) {
		notes.push(
			'Validation over Bangladesh found a POWER-vs-ERA5 step change around 1997–2001 (temperature, humidity, precipitation). Check the Compare tab before trusting trends.'
		);
	}
	return notes;
}

// ---------------------------------------------------------------------------
// POWER point series
// ---------------------------------------------------------------------------

export interface ParsedPowerSeries {
	points: TimePoint[];
	totalCount: number;
	missingCount: number;
	unit: string;
	name: string;
	latitude: number;
	longitude: number;
	elevation?: number;
	sources: string[];
}

/** Parse a POWER point JSON response for one parameter. */
export function parsePowerPointSeries(
	body: PowerJsonResponse,
	code: string,
	temporal: PowerAnalysisTemporal
): ParsedPowerSeries {
	const values = body.properties?.parameter?.[code] as Record<string, unknown> | undefined;
	if (!values) throw new Error(`NASA POWER response has no values for ${code}.`);
	const fill = body.header?.fill_value;
	const points: TimePoint[] = [];
	let total = 0;
	for (const [key, value] of Object.entries(values)) {
		let time: number | undefined;
		if (temporal === 'daily' && /^\d{8}$/.test(key)) {
			time = Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8));
		} else if (temporal === 'monthly' && /^\d{6}$/.test(key)) {
			const month = +key.slice(4, 6);
			if (month < 1 || month > 12) continue; // MM=13 is the annual value
			time = Date.UTC(+key.slice(0, 4), month - 1, 15);
		}
		if (time === undefined) continue;
		total++;
		if (numericPowerValue(value, fill)) points.push({ time, value });
	}
	points.sort((a, b) => a.time - b.time);
	const coords = body.geometry?.coordinates ?? [];
	const meta = body.parameters?.[code];
	const headerSources = body.header?.sources;
	return {
		points,
		totalCount: total,
		missingCount: total - points.length,
		unit: String(meta?.units ?? ''),
		name: String(meta?.longname ?? meta?.name ?? code),
		longitude: Number(coords[0]),
		latitude: Number(coords[1]),
		elevation: Number.isFinite(Number(coords[2])) ? Number(coords[2]) : undefined,
		sources: Array.isArray(headerSources)
			? headerSources.filter((s): s is string => typeof s === 'string')
			: []
	};
}

export function buildPowerAnalysisUrl(
	community: PowerCommunity,
	temporal: PowerAnalysisTemporal,
	code: string,
	latitude: number,
	longitude: number,
	startYear: number,
	endYear: number
): URL {
	return buildPowerTemporalUrl({
		temporal,
		spatial: 'point',
		community,
		parameters: [code],
		latitude: Number(latitude.toFixed(4)),
		longitude: Number(longitude.toFixed(4)),
		start: temporal === 'daily' ? `${startYear}0101` : String(startYear),
		end: temporal === 'daily' ? `${endYear}1231` : String(endYear),
		format: 'json',
		units: 'metric',
		timeStandard: 'utc',
		header: true
	});
}

const SERIES_TTL_MS = 30 * 60 * 1000;
const seriesCache = new Map<string, { at: number; value: Promise<AnalysisSeries> }>();

function cached(key: string, load: () => Promise<AnalysisSeries>): Promise<AnalysisSeries> {
	const hit = seriesCache.get(key);
	if (hit && Date.now() - hit.at < SERIES_TTL_MS) return hit.value;
	const value = load();
	value.catch(() => seriesCache.delete(key));
	seriesCache.set(key, { at: Date.now(), value });
	// Bound memory: each entry is up to a few MB for hourly series.
	if (seriesCache.size > 24) {
		const oldest = [...seriesCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
		if (oldest) seriesCache.delete(oldest[0]);
	}
	return value;
}

export function clearAnalysisCache(): void {
	seriesCache.clear();
	regionalCache.clear();
}

export interface PowerSeriesRequest {
	community: PowerCommunity;
	temporal: PowerAnalysisTemporal;
	code: string;
	latitude: number;
	longitude: number;
	endYear: number;
	catalogEntry?: PowerCatalogEntry;
}

/** Full-record POWER series for one parameter, cached. */
export function fetchPowerAnalysisSeries(request: PowerSeriesRequest): Promise<AnalysisSeries> {
	const { community, temporal, code, latitude, longitude, endYear, catalogEntry } = request;
	const startYear = powerStartYear(code, catalogEntry?.type);
	const key = [
		'power',
		community,
		temporal,
		code,
		latitude.toFixed(3),
		longitude.toFixed(3),
		startYear,
		endYear
	].join('|');
	return cached(key, async () => {
		const url = buildPowerAnalysisUrl(
			community,
			temporal,
			code,
			latitude,
			longitude,
			startYear,
			endYear
		);
		const body = await fetchPowerJson(url);
		const parsed = parsePowerPointSeries(body, code, temporal);
		if (parsed.points.length === 0) {
			throw new Error(`NASA POWER returned only fill values for ${code} at this location.`);
		}
		const unit = parsed.unit || catalogEntry?.units || '';
		return {
			id: key,
			source: 'nasa-power',
			sourceLabel: `NASA POWER · ${community}`,
			code,
			label: catalogEntry?.name ?? parsed.name,
			definition: catalogEntry?.definition,
			unit,
			resolution: temporal,
			aggregate: powerAggregateKind(code, unit),
			points: parsed.points,
			totalCount: parsed.totalCount,
			missingCount: parsed.missingCount,
			latitude: Number.isFinite(parsed.latitude) ? parsed.latitude : latitude,
			longitude: Number.isFinite(parsed.longitude) ? parsed.longitude : longitude,
			elevation: parsed.elevation,
			notes: powerSourceResolutionNotes(parsed.sources),
			sources: parsed.sources,
			category: catalogEntry?.type
		} satisfies AnalysisSeries;
	});
}

// ---------------------------------------------------------------------------
// POWER regional monthly grid
// ---------------------------------------------------------------------------

export interface RegionalCell {
	latitude: number;
	longitude: number;
	points: TimePoint[];
}

export interface RegionalGrid {
	code: string;
	unit: string;
	bounds: PowerBounds;
	latStep: number;
	lonStep: number;
	cells: RegionalCell[];
}

const regionalCache = new Map<string, Promise<RegionalGrid>>();

/** Square box of `size` degrees around a point, clamped to the globe and ≥ 2°. */
export function regionalBounds(latitude: number, longitude: number, size: number): PowerBounds {
	const span = Math.min(10, Math.max(2, size));
	const half = span / 2;
	let latitudeMin = latitude - half;
	let latitudeMax = latitude + half;
	if (latitudeMin < -90) {
		latitudeMin = -90;
		latitudeMax = -90 + span;
	}
	if (latitudeMax > 90) {
		latitudeMax = 90;
		latitudeMin = 90 - span;
	}
	let longitudeMin = longitude - half;
	let longitudeMax = longitude + half;
	if (longitudeMin < -180) {
		longitudeMin = -180;
		longitudeMax = -180 + span;
	}
	if (longitudeMax > 180) {
		longitudeMax = 180;
		longitudeMin = 180 - span;
	}
	const r = (v: number) => Math.round(v * 100) / 100;
	return {
		latitudeMin: r(latitudeMin),
		latitudeMax: r(latitudeMax),
		longitudeMin: r(longitudeMin),
		longitudeMax: r(longitudeMax)
	};
}

function medianStep(values: number[]): number {
	const unique = [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
	const steps: number[] = [];
	for (let i = 1; i < unique.length; i++) steps.push(unique[i] - unique[i - 1]);
	steps.sort((a, b) => a - b);
	return steps.length ? steps[Math.floor(steps.length / 2)] : 0.5;
}

export function parseRegionalMonthly(
	body: PowerJsonResponse,
	code: string,
	bounds: PowerBounds
): RegionalGrid {
	const fill = body.header?.fill_value;
	const cells: RegionalCell[] = [];
	for (const feature of body.features ?? []) {
		const coords = feature.geometry?.coordinates ?? [];
		const values = feature.properties?.parameter?.[code] as Record<string, unknown> | undefined;
		if (!values || coords.length < 2) continue;
		const points: TimePoint[] = [];
		for (const [key, value] of Object.entries(values)) {
			if (!/^\d{6}$/.test(key)) continue;
			const month = +key.slice(4, 6);
			if (month < 1 || month > 12) continue;
			if (numericPowerValue(value, fill)) {
				points.push({ time: Date.UTC(+key.slice(0, 4), month - 1, 15), value });
			}
		}
		points.sort((a, b) => a.time - b.time);
		cells.push({ longitude: Number(coords[0]), latitude: Number(coords[1]), points });
	}
	const meta = body.parameters?.[code];
	return {
		code,
		unit: String(meta?.units ?? ''),
		bounds,
		latStep: medianStep(cells.map((c) => c.latitude)),
		lonStep: medianStep(cells.map((c) => c.longitude)),
		cells
	};
}

export function fetchPowerRegionalMonthly(
	community: PowerCommunity,
	code: string,
	bounds: PowerBounds,
	startYear: number,
	endYear: number
): Promise<RegionalGrid> {
	const key = [community, code, JSON.stringify(bounds), startYear, endYear].join('|');
	let hit = regionalCache.get(key);
	if (!hit) {
		const url = buildPowerTemporalUrl({
			temporal: 'monthly',
			spatial: 'regional',
			community,
			parameters: [code],
			bounds,
			start: String(startYear),
			end: String(endYear),
			format: 'json',
			units: 'metric'
		});
		hit = fetchPowerJson(url).then((body) => parseRegionalMonthly(body, code, bounds));
		hit.catch(() => regionalCache.delete(key));
		regionalCache.set(key, hit);
	}
	return hit;
}

// ---------------------------------------------------------------------------
// Open-Meteo adapter
// ---------------------------------------------------------------------------

/** Aggregation semantics of the Open-Meteo series the panel requests. */
export function openMeteoAggregateKind(
	variableName: string,
	resolution: SampleResolution
): AggregateKind {
	if (variableName.startsWith('wind_direction')) return 'circular';
	const daily = dailyAggregateFor(variableName);
	if (resolution === 'daily' && daily?.aggregate === 'sum') {
		// Daily shortwave sums are compared and displayed as MJ/m²/day means.
		return variableName === 'shortwave_radiation' ? 'mean' : 'rate';
	}
	if (resolution === 'hourly' && ['precipitation', 'rain', 'snowfall'].includes(variableName)) {
		return 'rate';
	}
	return 'mean';
}

export async function fetchOpenMeteoAnalysisSeries(
	variableName: string,
	model: ArchiveModel,
	latitude: number,
	longitude: number,
	startYear: number,
	endYear: number
): Promise<AnalysisSeries> {
	const variable = getArchiveVariable(variableName);
	if (!variable) throw new Error(`Unknown variable "${variableName}"`);
	const result = await fetchArchiveSeriesCached(
		variable,
		model,
		latitude,
		longitude,
		startYear,
		endYear
	);
	const daily = result.resolution === 'daily' ? dailyAggregateFor(variable.name) : undefined;
	const modelInfo = variable.endpoint === 'archive' ? getArchiveModel(model) : undefined;
	const notes: string[] = [];
	if (modelInfo?.note) notes.push(modelInfo.note);
	if (variable.note) notes.push(variable.note);
	if (daily?.aggregate === 'max')
		notes.push(`Daily ${daily.name.replace(/_/g, ' ')} values (daily maximum).`);
	return {
		id: [
			'om',
			variable.name,
			model,
			result.resolution,
			latitude.toFixed(3),
			longitude.toFixed(3),
			startYear,
			endYear
		].join('|'),
		source: 'open-meteo',
		sourceLabel: `${modelInfo?.label ?? (variable.endpoint === 'marine' ? 'Marine' : 'CAMS')} · Open-Meteo`,
		code: daily?.name ?? variable.name,
		label: variable.label,
		unit: result.unit,
		resolution: result.resolution,
		aggregate: openMeteoAggregateKind(variable.name, result.resolution),
		points: result.points,
		totalCount: result.totalCount,
		missingCount: result.missingCount,
		latitude: result.latitude,
		longitude: result.longitude,
		elevation: result.elevation,
		notes,
		category: variable.group
	};
}

// ---------------------------------------------------------------------------
// POWER ↔ ERA5 comparison pairs
// ---------------------------------------------------------------------------

export interface ComparePair {
	power: string;
	/** Open-Meteo daily parameter (ERA5). */
	openMeteo: string;
	/**
	 * Factor that converts the Open-Meteo value to POWER units, given the POWER
	 * unit string (community-dependent for radiation).
	 */
	toPower: (powerUnit: string) => number;
	note?: string;
}

const one = () => 1;

/** Verified live: every Open-Meteo name below returns ERA5 daily data. */
export const COMPARE_PAIRS: ComparePair[] = [
	{ power: 'T2M', openMeteo: 'temperature_2m_mean', toPower: one },
	{ power: 'T2M_MAX', openMeteo: 'temperature_2m_max', toPower: one },
	{ power: 'T2M_MIN', openMeteo: 'temperature_2m_min', toPower: one },
	{ power: 'T2MDEW', openMeteo: 'dew_point_2m_mean', toPower: one },
	{ power: 'T2MWET', openMeteo: 'wet_bulb_temperature_2m_mean', toPower: one },
	{ power: 'RH2M', openMeteo: 'relative_humidity_2m_mean', toPower: one },
	{ power: 'PRECTOTCORR', openMeteo: 'precipitation_sum', toPower: one },
	{
		power: 'IMERG_PRECTOT',
		openMeteo: 'precipitation_sum',
		toPower: one,
		note: 'Satellite (IMERG) vs reanalysis (ERA5) precipitation.'
	},
	{
		power: 'WS10M',
		openMeteo: 'wind_speed_10m_mean',
		toPower: () => 1 / 3.6,
		note: 'ERA5 km/h converted to m/s.'
	},
	{
		power: 'WS10M_MAX',
		openMeteo: 'wind_speed_10m_max',
		toPower: () => 1 / 3.6,
		note: 'ERA5 hourly maximum vs MERRA-2 hourly maximum, km/h → m/s.'
	},
	{ power: 'WD10M', openMeteo: 'wind_direction_10m_dominant', toPower: one },
	{ power: 'PS', openMeteo: 'surface_pressure_mean', toPower: () => 0.1, note: 'hPa → kPa.' },
	{ power: 'SLP', openMeteo: 'pressure_msl_mean', toPower: () => 0.1, note: 'hPa → kPa.' },
	{ power: 'CLOUD_AMT', openMeteo: 'cloud_cover_mean', toPower: one },
	{
		power: 'ALLSKY_SFC_SW_DWN',
		openMeteo: 'shortwave_radiation_sum',
		toPower: (unit) => (/kW-?hr/i.test(unit) ? 1 / 3.6 : 1),
		note: 'Satellite (SRB/CERES) vs reanalysis radiation.'
	},
	{
		power: 'GWETTOP',
		openMeteo: 'soil_moisture_0_to_7cm_mean',
		toPower: one,
		note: 'Not the same quantity: GWETTOP is a 0–1 wetness index, ERA5 is volumetric m³/m³ — compare shape, not level.'
	}
];

export function comparePairForPower(code: string): ComparePair | undefined {
	return COMPARE_PAIRS.find((p) => p.power === code);
}

/** Pair for the daily Open-Meteo parameter a panel variable resolves to. */
export function comparePairForOpenMeteo(dailyName: string): ComparePair | undefined {
	const preferred: Record<string, string> = { precipitation_sum: 'PRECTOTCORR' };
	const code = preferred[dailyName];
	if (code) return comparePairForPower(code);
	return COMPARE_PAIRS.find((p) => p.openMeteo === dailyName && p.power !== 'GWETTOP');
}

interface OpenMeteoDailyResponse {
	latitude: number;
	longitude: number;
	elevation?: number;
	daily?: Record<string, (number | null)[] | string[]>;
	daily_units?: Record<string, string>;
	reason?: string;
}

/** ERA5 daily series for an arbitrary daily parameter, via the shared queue. */
export function fetchEra5Daily(
	param: string,
	latitude: number,
	longitude: number,
	startYear: number,
	endYear: number
): Promise<{ points: TimePoint[]; unit: string; latitude: number; longitude: number }> {
	const key = ['era5d', param, latitude.toFixed(3), longitude.toFixed(3), startYear, endYear].join(
		'|'
	);
	return cached(key, async () => {
		const params = new URLSearchParams({
			latitude: latitude.toFixed(4),
			longitude: longitude.toFixed(4),
			start_date: `${startYear}-01-01`,
			end_date: `${endYear}-12-31`,
			daily: param,
			timezone: 'UTC',
			models: 'era5'
		});
		const response = await scheduleArchiveRequest(() =>
			fetch(`${OPEN_METEO_ARCHIVE_BASE}?${params}`)
		);
		if (response.status === 429) {
			throw new ArchiveError('Rate limited by the archive API. Wait a moment and try again.', 429);
		}
		const body = (await response.json()) as OpenMeteoDailyResponse;
		if (!response.ok)
			throw new ArchiveError(body.reason ?? `ERA5 request failed (${response.status})`);
		const times = (body.daily?.time ?? []) as string[];
		const raw = (body.daily?.[param] ?? []) as (number | null)[];
		const points: TimePoint[] = [];
		for (let i = 0; i < times.length; i++) {
			const v = raw[i];
			if (typeof v === 'number' && Number.isFinite(v))
				points.push({ time: Date.parse(times[i]), value: v });
		}
		return {
			id: key,
			source: 'open-meteo',
			sourceLabel: 'ERA5 · Open-Meteo',
			code: param,
			label: param,
			unit: body.daily_units?.[param] ?? '',
			resolution: 'daily',
			aggregate: 'mean',
			points,
			totalCount: times.length,
			missingCount: times.length - points.length,
			latitude: body.latitude,
			longitude: body.longitude,
			elevation: body.elevation,
			notes: []
		} satisfies AnalysisSeries;
	});
}
