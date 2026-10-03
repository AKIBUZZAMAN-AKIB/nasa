/**
 * State for the NASA GIBS satellite history the timeline browses past the end
 * of the forecast archive.
 *
 * The forecast side of the app serves roughly seven days of history; older
 * days simply have no `.om` files. Instead of clamping those dates to a week
 * ago — which put a wrong day on the clock and nothing on the map — the bottom
 * timeline switches into a browse mode over the GIBS archive: the same control,
 * but the day it shows is the day the imagery really is.
 *
 * Holds the selection (which layer, which day, how opaque), the availability
 * window fetched per layer, and the actions the timeline shares with the map
 * wiring. Date resolution — snapping to a layer's cadence and clamping to the
 * days that really exist — happens here, so the clock, the URL and the map can
 * never disagree.
 */
import { get, writable } from 'svelte/store';

import { persisted } from 'svelte-persisted-store';
import { toast } from 'svelte-sonner';

import { browser } from '$app/environment';

import {
	GIBS_LAYERS,
	GIBS_URL_DATE_PARAM,
	GIBS_URL_LAYER_PARAM,
	GIBS_URL_TIME_PARAM,
	type GibsAvailabilityRange,
	type GibsLayerDef,
	type GibsTimeRange,
	gibsAvailabilityUrl,
	gibsLayerById,
	gibsPeriodMilliseconds,
	gibsTimeRangesToDayRanges,
	gibsUrlParams,
	isSubdailyGibsLayer,
	isoDayAtNoon,
	latestAvailableDay,
	latestAvailableTime,
	normalizeGibsTimestamp,
	parseGibsAvailability,
	parseGibsTimeAvailability,
	parseGibsUrl,
	resolveAvailableDay,
	resolveAvailableTime,
	shiftGibsTimestamp,
	shiftIsoDay,
	shiftIsoMonth
} from '$lib/gibs';
import { formatISOWithoutTimezone } from '$lib/time-format';

import { updateUrl } from '../url';
import { time } from './time';

/** Layer shown when the user has not picked another one. */
export const DEFAULT_GIBS_LAYER = 'MODIS_Terra_CorrectedReflectance_TrueColor';

/**
 * Browsing the satellite archive instead of the forecast. Entered by walking
 * the timeline further back than the forecast goes (or by opening a link that
 * asks for such a day), left again with the timeline's Forecast button.
 */
export const gibsBrowse = writable(false);

/** Selected layer; persisted so a reload returns to the same imagery. */
export const gibsLayerId = persisted<string>('gibs-layer', DEFAULT_GIBS_LAYER);

/** Raster opacity in percent. */
export const gibsOpacity = persisted<number>('gibs-opacity', 85);

/** Day the user asked for; may sit in a gap or outside the archive. */
export const gibsRequestedDate = writable<string | undefined>(undefined);

/** Day actually drawn after snapping and clamping. */
export const gibsResolvedDate = writable<string | undefined>(undefined);

/** Exact UTC frame for sub-daily layers; undefined for date-only imagery. */
export const gibsRequestedTime = writable<string | undefined>(undefined);
export const gibsResolvedTime = writable<string | undefined>(undefined);

export interface GibsAvailabilityState {
	status: 'idle' | 'loading' | 'ready' | 'error';
	/** Day-level projection used by the archive rail and date navigation. */
	ranges: GibsAvailabilityRange[];
	/** Compact exact timestamp ranges for a sub-daily GIBS dimension. */
	timeRanges: GibsTimeRange[];
	/** Set when the availability request failed (offline, proxy, …). */
	error?: string;
}

/** Availability of the selected layer, as published by GIBS. */
export const gibsAvailability = writable<GibsAvailabilityState>({
	status: 'idle',
	ranges: [],
	timeRanges: []
});

/** Last day and exact timestamp with imagery for the selected layer. */
export const gibsLatestDate = writable<string | undefined>(undefined);
export const gibsLatestTime = writable<string | undefined>(undefined);

interface GibsAvailabilityData {
	ranges: GibsAvailabilityRange[];
	timeRanges: GibsTimeRange[];
}

interface CachedAvailability {
	fetchedAt: number;
	ranges: GibsAvailabilityRange[];
	timeRanges?: GibsTimeRange[];
}

const availabilityCache = new Map<string, { fetchedAt: number; data: GibsAvailabilityData }>();
const inflight = new Map<string, Promise<GibsAvailabilityData>>();

/** Daily layers change roughly once a day; IMERG availability is refreshed hourly. */
const DAILY_AVAILABILITY_TTL_MS = 6 * 60 * 60 * 1000;
const SUBDAILY_AVAILABILITY_TTL_MS = 15 * 60 * 1000;
const cacheTtl = (layer: GibsLayerDef): number =>
	isSubdailyGibsLayer(layer) ? SUBDAILY_AVAILABILITY_TTL_MS : DAILY_AVAILABILITY_TTL_MS;

const storageKey = (layerId: string): string => `gibs-availability:${layerId}`;

/** A still-fresh availability copy from an earlier visit, if there is one. */
const readCachedAvailability = (layer: GibsLayerDef): CachedAvailability | undefined => {
	if (!browser) return undefined;
	try {
		const raw = localStorage.getItem(storageKey(layer.id));
		if (!raw) return undefined;
		const cached = JSON.parse(raw) as CachedAvailability;
		if (!cached || Date.now() - cached.fetchedAt > cacheTtl(layer)) return undefined;
		if (!Array.isArray(cached.ranges) || cached.ranges.length === 0) return undefined;
		if (
			isSubdailyGibsLayer(layer) &&
			(!Array.isArray(cached.timeRanges) || !cached.timeRanges.length)
		)
			return undefined;
		return cached;
	} catch {
		// Blocked storage, private mode or a stale format: just fetch instead.
		return undefined;
	}
};

const writeCachedAvailability = (layerId: string, data: GibsAvailabilityData): void => {
	if (!browser || (!data.ranges.length && !data.timeRanges.length)) return;
	try {
		const payload: CachedAvailability = {
			fetchedAt: Date.now(),
			ranges: data.ranges,
			timeRanges: data.timeRanges
		};
		localStorage.setItem(storageKey(layerId), JSON.stringify(payload));
	} catch {
		// A full or blocked localStorage must not break the layer.
	}
};

/** Today in UTC, the upper bound of the availability window. */
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const timeOfDay = (timestamp?: string): string => timestamp?.slice(11, 19) ?? '12:00:00';

/** A real `YYYY-MM-DD` day, rejecting shapes that merely look like one. */
const isDay = (value: string | undefined): value is string =>
	!!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftIsoDay(value, 0) === value;

/**
 * Fetch one compact DescribeDomains response. Sub-daily archives stay
 * compressed as exact timestamp ranges; static catalogue products need no
 * request, and date-only layers keep their compact availability spans.
 */
export const loadGibsAvailability = async (layer: GibsLayerDef): Promise<GibsAvailabilityData> => {
	if (layer.period === 'static') return { ranges: [], timeRanges: [] };

	const cached = availabilityCache.get(layer.id);
	if (cached && Date.now() - cached.fetchedAt < cacheTtl(layer)) return cached.data;
	const pending = inflight.get(layer.id);
	if (pending) return pending;

	const stored = readCachedAvailability(layer);
	if (stored) {
		const data = { ranges: stored.ranges, timeRanges: stored.timeRanges ?? [] };
		availabilityCache.set(layer.id, { fetchedAt: stored.fetchedAt, data });
		return data;
	}

	const request = (async () => {
		const url = gibsAvailabilityUrl(
			layer,
			layer.availabilityStart ?? layer.coverageStart ?? '0001-01-01',
			todayIso()
		);
		const response = await fetch(
			url,
			isSubdailyGibsLayer(layer) ? { cache: 'no-store' } : undefined
		);
		if (!response.ok) throw new Error(`GIBS availability request failed (${response.status})`);
		const xml = await response.text();
		let data: GibsAvailabilityData = isSubdailyGibsLayer(layer)
			? (() => {
					const timeRanges = parseGibsTimeAvailability(xml);
					return { ranges: gibsTimeRangesToDayRanges(timeRanges), timeRanges };
				})()
			: { ranges: parseGibsAvailability(xml), timeRanges: [] };

		// Some fixed, long-period layers expose a Time dimension in Capabilities
		// but DescribeDomains returns an empty domain. Use the official default
		// frame rather than inventing a date or leaving a valid layer blank.
		if (!data.ranges.length && layer.timeDimension) {
			const fallback = layer.defaultTime ?? layer.coverageStart;
			if (isSubdailyGibsLayer(layer)) {
				const frame = normalizeGibsTimestamp(fallback);
				if (frame) {
					const timeRanges = [
						{
							start: frame,
							end: frame,
							stepMs: gibsPeriodMilliseconds(layer.period) ?? 60_000
						}
					];
					data = { ranges: gibsTimeRangesToDayRanges(timeRanges), timeRanges };
				}
			} else if (fallback) {
				const day = fallback.slice(0, 10);
				if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
					const dayStep = /^P(\d+)D$/.exec(layer.period);
					data = {
						ranges: [
							{
								start: day,
								end: day,
								stepDays: dayStep ? Number(dayStep[1]) : 1,
								step: layer.period
							}
						],
						timeRanges: []
					};
				}
			}
		}

		if (!data.ranges.length) throw new Error('GIBS returned no parseable availability ranges');
		const fetchedAt = Date.now();
		availabilityCache.set(layer.id, { fetchedAt, data });
		writeCachedAvailability(layer.id, data);
		return data;
	})();

	inflight.set(layer.id, request);
	try {
		return await request;
	} finally {
		inflight.delete(layer.id);
	}
};

/**
 * Mirror the selection into the address bar with `replaceState` — the same
 * approach the rest of the app uses — so a satellite day can be shared without
 * filling the back button with dates.
 *
 * Defaults are omitted: the layer stays out of the URL while the default one is
 * shown, and so does the day while the newest day is shown, which keeps a shared
 * link following the archive instead of freezing on the day it was copied.
 */
const syncGibsUrl = (): void => {
	if (!browser) return;
	const url = new URL(window.location.href);
	const params = gibsUrlParams({
		browsing: get(gibsBrowse),
		layerId: get(gibsLayerId),
		day: get(gibsResolvedDate),
		latest: get(gibsLatestDate),
		timestamp: get(gibsResolvedTime),
		latestTimestamp: get(gibsLatestTime),
		defaultLayerId: DEFAULT_GIBS_LAYER
	});

	for (const key of [GIBS_URL_LAYER_PARAM, GIBS_URL_DATE_PARAM, GIBS_URL_TIME_PARAM]) {
		const value = params[key];
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
	}

	const next = `${url.pathname}${url.search}${url.hash}`;
	const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
	if (next !== current) window.history.replaceState(window.history.state, '', next);
};

/**
 * Point the app's clock at the day the imagery really is. The clock drives the
 * address bar and every local-time label, so writing the resolved day here is
 * what makes the timeline show the truth rather than the day that was asked
 * for.
 */
const syncClock = (): void => {
	const day = get(gibsResolvedDate);
	if (!get(gibsBrowse) || !day) return;
	const at = get(gibsResolvedTime) ? new Date(get(gibsResolvedTime)!) : isoDayAtNoon(day);
	time.set(at);
	void updateUrl('time', formatISOWithoutTimezone(at));
};

/** Read a shared link: `?gibs=<layer>&gibs-date=<day>` restores the day. */
const applyGibsUrlParams = (): void => {
	if (!browser) return;
	const { layerId, day, timestamp } = parseGibsUrl(window.location.search);
	if (layerId) gibsLayerId.set(layerId);
	if (day) {
		gibsRequestedDate.set(day);
		if (timestamp) gibsRequestedTime.set(timestamp);
		gibsBrowse.set(true);
	}
};

/** Recompute the drawn day from the requested day and the known availability. */
const resolve = (announce: boolean): void => {
	const layer = gibsLayerById(get(gibsLayerId));
	const { ranges, timeRanges } = get(gibsAvailability);
	if (!layer) {
		gibsResolvedDate.set(undefined);
		gibsResolvedTime.set(undefined);
		gibsLatestDate.set(undefined);
		gibsLatestTime.set(undefined);
		syncClock();
		syncGibsUrl();
		return;
	}

	if (layer.period === 'static') {
		gibsResolvedDate.set(undefined);
		gibsResolvedTime.set(undefined);
		gibsLatestDate.set(undefined);
		gibsLatestTime.set(undefined);
		syncGibsUrl();
		return;
	}

	if (!ranges.length) {
		gibsResolvedDate.set(undefined);
		gibsResolvedTime.set(undefined);
		gibsLatestDate.set(undefined);
		gibsLatestTime.set(undefined);
		syncClock();
		syncGibsUrl();
		return;
	}

	if (isSubdailyGibsLayer(layer)) {
		const latest = latestAvailableTime(timeRanges);
		const requested =
			normalizeGibsTimestamp(get(gibsRequestedTime)) ??
			(get(gibsRequestedDate) ? `${get(gibsRequestedDate)}T12:00:00Z` : latest);
		if (!requested || !latest) {
			gibsResolvedDate.set(undefined);
			gibsResolvedTime.set(undefined);
			gibsLatestDate.set(undefined);
			gibsLatestTime.set(undefined);
			syncClock();
			syncGibsUrl();
			return;
		}
		gibsRequestedTime.set(requested);
		const resolved = resolveAvailableTime(timeRanges, requested);
		gibsResolvedTime.set(resolved);
		gibsResolvedDate.set(resolved?.slice(0, 10));
		gibsLatestTime.set(latest);
		gibsLatestDate.set(latest.slice(0, 10));

		if (announce && resolved && requested !== resolved) {
			toast.info(
				`No IMERG frame at ${requested.slice(0, 16)}Z — showing ${resolved.slice(0, 16)}Z`,
				{
					id: 'gibs-time'
				}
			);
		}
	} else {
		const requested = get(gibsRequestedDate) ?? latestAvailableDay(ranges) ?? todayIso();
		const resolved = resolveAvailableDay(layer, requested, ranges);
		gibsResolvedTime.set(undefined);
		gibsResolvedDate.set(resolved);
		gibsLatestDate.set(latestAvailableDay(ranges));
		gibsLatestTime.set(undefined);

		if (announce && resolved && requested !== resolved) {
			toast.info(`No imagery on ${requested} — showing ${resolved}`, { id: 'gibs-date' });
		}
	}

	syncClock();
	syncGibsUrl();
};

/**
 * Load availability for a layer and pick a day: the requested one when it can
 * be served, otherwise the latest day in the archive.
 */
export const activateGibsLayer = async (layerId?: string, announce = false): Promise<void> => {
	const layer = gibsLayerById(layerId ?? get(gibsLayerId)) ?? GIBS_LAYERS[0];
	gibsLayerId.set(layer.id);
	const previous = get(gibsAvailability);
	gibsAvailability.set({
		status: 'loading',
		ranges: previous.ranges,
		timeRanges: previous.timeRanges
	});
	try {
		const data = await loadGibsAvailability(layer);
		if (get(gibsLayerId) !== layer.id) return; // switched away meanwhile
		gibsAvailability.set({ status: 'ready', ...data });
		resolve(announce);
	} catch (error) {
		if (get(gibsLayerId) !== layer.id) return;
		gibsAvailability.set({
			status: 'error',
			ranges: [],
			timeRanges: [],
			error: error instanceof Error ? error.message : 'Availability lookup failed'
		});
		// Without availability there is nothing honest to draw for this layer.
		gibsResolvedDate.set(undefined);
		gibsResolvedTime.set(undefined);
		gibsLatestDate.set(undefined);
		gibsLatestTime.set(undefined);
		syncGibsUrl();
	}
};

/**
 * Walk the timeline into the satellite archive: the forecast has nothing for
 * this day, so the imagery takes over and the clock follows the day that is
 * actually on screen.
 */
export const enterGibsBrowse = async (requestedDay?: string): Promise<void> => {
	if (!browser) return;
	const fromForecast = !get(gibsBrowse);
	gibsBrowse.set(true);
	if (isDay(requestedDay)) {
		gibsRequestedDate.set(requestedDay);
		if (isSubdailyGibsLayer(gibsLayerById(get(gibsLayerId)))) {
			const clock = timeOfDay(get(gibsResolvedTime));
			gibsRequestedTime.set(`${requestedDay}T${clock}Z`);
		}
	}

	if (fromForecast) {
		toast.info('Past the end of the forecast archive — showing NASA satellite imagery.', {
			id: 'gibs-browse'
		});
	}

	if (get(gibsAvailability).status !== 'ready') await activateGibsLayer();
	else resolve(true);
};

/** Hand the timeline back to the forecast. The imagery hides, the day stays. */
export const exitGibsBrowse = (): void => {
	gibsBrowse.set(false);
	syncGibsUrl();
};

/** Jump to a specific day (the timeline's date input and slider). */
export const setGibsDate = (day: string, announce = true): void => {
	const layer = gibsLayerById(get(gibsLayerId));
	if (!layer || layer.period === 'static') return;
	if (isSubdailyGibsLayer(layer)) {
		const clock = timeOfDay(get(gibsResolvedTime) ?? get(gibsRequestedTime));
		setGibsTime(`${day}T${clock}Z`, announce);
		return;
	}
	gibsRequestedDate.set(day);
	if (get(gibsAvailability).status !== 'ready') {
		void activateGibsLayer(undefined, announce);
		return;
	}
	resolve(announce);
};

/** Select a 30-minute frame by its UTC timestamp. */
export const setGibsTime = (value: string, announce = true): void => {
	const timestamp = normalizeGibsTimestamp(value);
	if (!timestamp) return;
	gibsRequestedTime.set(timestamp);
	gibsRequestedDate.set(timestamp.slice(0, 10));
	if (get(gibsAvailability).status !== 'ready') {
		void activateGibsLayer(undefined, announce);
		return;
	}
	resolve(announce);
};

/** Set the UTC wall-clock time while retaining the day shown on the map. */
export const setGibsTimeOfDay = (value: string, announce = true): void => {
	if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) return;
	const day = get(gibsResolvedDate) ?? get(gibsRequestedDate) ?? todayIso();
	const clock = value.length === 5 ? `${value}:00` : value;
	setGibsTime(`${day}T${clock}Z`, announce);
};

/** Replay frame dispatcher: date-only for ordinary layers, UTC timestamp for IMERG. */
export const setGibsFrame = (frame: string, announce = false): void => {
	if (isSubdailyGibsLayer(gibsLayerById(get(gibsLayerId)))) setGibsTime(frame, announce);
	else setGibsDate(frame.slice(0, 10), announce);
};

/** Move the archive selection by one layer-native step. */
export const shiftGibsDate = (steps: number): void => {
	const layer = gibsLayerById(get(gibsLayerId));
	if (!layer || layer.period === 'static') return;
	if (isSubdailyGibsLayer(layer)) {
		const current = get(gibsResolvedTime) ?? get(gibsLatestTime);
		if (!current) return;
		const targetMs = Date.parse(current);
		const ranges = get(gibsAvailability).timeRanges;
		const range = ranges.find(
			(entry) => Date.parse(entry.start) <= targetMs && targetMs <= Date.parse(entry.end)
		);
		const interval = range?.stepMs ?? gibsPeriodMilliseconds(layer.period) ?? 30 * 60_000;
		const shifted = shiftGibsTimestamp(current, (steps * interval) / 60_000);
		if (shifted) setGibsTime(shifted);
		return;
	}

	const current = get(gibsResolvedDate) ?? get(gibsRequestedDate) ?? todayIso();
	const range = get(gibsAvailability).ranges.find(
		(entry) => entry.start <= current && current <= entry.end
	);
	const period = range?.step ?? layer.period;
	const dayStep = /^P(\d+)D$/.exec(period);
	if (dayStep) {
		setGibsDate(shiftIsoDay(current, steps * Number(dayStep[1])));
		return;
	}
	const monthStep = /^P(\d+)(M|Y)$/.exec(period);
	if (monthStep) {
		const months = Number(monthStep[1]) * (monthStep[2] === 'Y' ? 12 : 1);
		setGibsDate(shiftIsoMonth(current, steps * months));
		return;
	}
	setGibsDate(shiftIsoDay(current, steps));
};

/** Show the most recent available day or exact sub-daily frame. */
export const goToLatestGibs = async (): Promise<void> => {
	const layer = gibsLayerById(get(gibsLayerId));
	if (!layer || layer.period === 'static') return;
	const cached = availabilityCache.get(layer.id);
	if (
		get(gibsAvailability).status !== 'ready' ||
		!layer ||
		!cached ||
		Date.now() - cached.fetchedAt >= cacheTtl(layer)
	)
		await activateGibsLayer(undefined, false);
	if (isSubdailyGibsLayer(gibsLayerById(get(gibsLayerId)))) {
		const latest = latestAvailableTime(get(gibsAvailability).timeRanges);
		if (latest) setGibsTime(latest, false);
		return;
	}
	const latest = latestAvailableDay(get(gibsAvailability).ranges);
	if (latest) setGibsDate(latest, false);
};

/** Switch layers while keeping the visible UTC day/time where meaningful. */
export const selectGibsLayer = (layerId: string): void => {
	const nextLayer = gibsLayerById(layerId);
	const currentLayer = gibsLayerById(get(gibsLayerId));
	if (isSubdailyGibsLayer(currentLayer) && !isSubdailyGibsLayer(nextLayer)) {
		gibsRequestedDate.set(get(gibsResolvedDate) ?? get(gibsRequestedDate));
		gibsRequestedTime.set(undefined);
	} else if (isSubdailyGibsLayer(nextLayer) && !get(gibsRequestedTime)) {
		const day = get(gibsRequestedDate) ?? get(gibsResolvedDate);
		if (day) {
			const clock = timeOfDay(get(gibsResolvedTime));
			gibsRequestedTime.set(`${day}T${clock}Z`);
		}
	}
	void activateGibsLayer(layerId, true);
	syncGibsUrl();
};

/**
 * Load availability once on startup and restore a shared satellite link, so
 * the timeline can open straight on the day the link asked for.
 */
export const initGibsState = (): void => {
	if (!browser) return;
	applyGibsUrlParams();
	void activateGibsLayer();
};
