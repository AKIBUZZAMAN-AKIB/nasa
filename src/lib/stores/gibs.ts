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
	type GibsAvailabilityRange,
	type GibsLayerDef,
	gibsAvailabilityUrl,
	gibsLayerById,
	gibsUrlParams,
	isoDayAtNoon,
	latestAvailableDay,
	parseGibsAvailability,
	parseGibsUrl,
	resolveAvailableDay,
	shiftIsoDay
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

export interface GibsAvailabilityState {
	status: 'idle' | 'loading' | 'ready' | 'error';
	ranges: GibsAvailabilityRange[];
	/** Set when the availability request failed (offline, proxy, …). */
	error?: string;
}

/** Availability of the selected layer, as published by GIBS. */
export const gibsAvailability = writable<GibsAvailabilityState>({ status: 'idle', ranges: [] });

/** Last day with imagery for the selected layer. */
export const gibsLatestDate = writable<string | undefined>(undefined);

const availabilityCache = new Map<string, GibsAvailabilityRange[]>();
const inflight = new Map<string, Promise<GibsAvailabilityRange[]>>();

/**
 * Availability only moves when a new day is processed, so a copy from earlier
 * in the day is good enough and makes the panel open instantly on a reload.
 */
const AVAILABILITY_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedAvailability {
	fetchedAt: number;
	ranges: GibsAvailabilityRange[];
}

const storageKey = (layerId: string): string => `gibs-availability:${layerId}`;

/** A still-fresh availability copy from an earlier visit, if there is one. */
const readCachedAvailability = (layerId: string): GibsAvailabilityRange[] | undefined => {
	if (!browser) return undefined;
	try {
		const raw = localStorage.getItem(storageKey(layerId));
		if (!raw) return undefined;
		const cached = JSON.parse(raw) as CachedAvailability;
		if (!cached || Date.now() - cached.fetchedAt > AVAILABILITY_TTL_MS) return undefined;
		if (!Array.isArray(cached.ranges) || cached.ranges.length === 0) return undefined;
		return cached.ranges;
	} catch {
		// Blocked storage, private mode or a stale format: just fetch instead.
		return undefined;
	}
};

const writeCachedAvailability = (layerId: string, ranges: GibsAvailabilityRange[]): void => {
	if (!browser || !ranges.length) return;
	try {
		const payload: CachedAvailability = { fetchedAt: Date.now(), ranges };
		localStorage.setItem(storageKey(layerId), JSON.stringify(payload));
	} catch {
		// A full or blocked localStorage must not break the layer.
	}
};

/** Today in UTC, the upper bound of the availability window. */
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** A real `YYYY-MM-DD` day, rejecting shapes that merely look like one. */
const isDay = (value: string | undefined): value is string =>
	!!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftIsoDay(value, 0) === value;

/**
 * Fetch the available dates of a layer, from its first day of coverage to
 * today. GIBS answers with compact ranges (a full 26-year daily layer is a few
 * hundred bytes), so one request per layer is enough; results are cached for
 * the session.
 */
export const loadGibsAvailability = async (
	layer: GibsLayerDef
): Promise<GibsAvailabilityRange[]> => {
	const cached = availabilityCache.get(layer.id);
	if (cached) return cached;
	const pending = inflight.get(layer.id);
	if (pending) return pending;

	// A copy cached earlier today keeps the timeline instant on a reload; the
	// request below then only runs when storage is empty, stale or blocked.
	const stored = readCachedAvailability(layer.id);
	if (stored) {
		availabilityCache.set(layer.id, stored);
		return stored;
	}

	const request = (async () => {
		const url = gibsAvailabilityUrl(layer, layer.coverageStart, todayIso());
		const response = await fetch(url);
		if (!response.ok) throw new Error(`GIBS availability request failed (${response.status})`);
		const ranges = parseGibsAvailability(await response.text());
		availabilityCache.set(layer.id, ranges);
		writeCachedAvailability(layer.id, ranges);
		return ranges;
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
		defaultLayerId: DEFAULT_GIBS_LAYER
	});

	for (const key of [GIBS_URL_LAYER_PARAM, GIBS_URL_DATE_PARAM]) {
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
	const at = isoDayAtNoon(day);
	time.set(at);
	void updateUrl('time', formatISOWithoutTimezone(at));
};

/** Read a shared link: `?gibs=<layer>&gibs-date=<day>` restores the day. */
const applyGibsUrlParams = (): void => {
	if (!browser) return;
	const { layerId, day } = parseGibsUrl(window.location.search);
	if (layerId) gibsLayerId.set(layerId);
	if (day) {
		gibsRequestedDate.set(day);
		gibsBrowse.set(true);
	}
};

/** Recompute the drawn day from the requested day and the known availability. */
const resolve = (announce: boolean): void => {
	const layer = gibsLayerById(get(gibsLayerId));
	const { ranges } = get(gibsAvailability);
	if (!layer || !ranges.length) {
		gibsResolvedDate.set(undefined);
		return;
	}
	const requested = get(gibsRequestedDate) ?? latestAvailableDay(ranges) ?? todayIso();
	const resolved = resolveAvailableDay(layer, requested, ranges);
	gibsResolvedDate.set(resolved);
	gibsLatestDate.set(latestAvailableDay(ranges));

	if (announce && resolved && requested !== resolved) {
		toast.info(`No imagery on ${requested} — showing ${resolved}`, { id: 'gibs-date' });
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
	gibsAvailability.set({ status: 'loading', ranges: get(gibsAvailability).ranges });
	try {
		const ranges = await loadGibsAvailability(layer);
		if (get(gibsLayerId) !== layer.id) return; // switched away meanwhile
		gibsAvailability.set({ status: 'ready', ranges });
		resolve(announce);
	} catch (error) {
		if (get(gibsLayerId) !== layer.id) return;
		gibsAvailability.set({
			status: 'error',
			ranges: get(gibsAvailability).ranges,
			error: error instanceof Error ? error.message : 'Availability lookup failed'
		});
		// Without availability there is nothing honest to draw for this layer.
		gibsResolvedDate.set(undefined);
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
	if (isDay(requestedDay)) gibsRequestedDate.set(requestedDay);

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
	gibsRequestedDate.set(day);
	if (get(gibsAvailability).status !== 'ready') {
		void activateGibsLayer(undefined, announce);
		return;
	}
	resolve(announce);
};

/** Move the drawn day by whole days (negative is older). */
export const shiftGibsDate = (days: number): void => {
	const current = get(gibsResolvedDate) ?? get(gibsRequestedDate) ?? todayIso();
	const layer = gibsLayerById(get(gibsLayerId));
	// A monthly/16-day layer moves by its own cadence so the imagery changes
	// with the label instead of repeating the same composite.
	const step = layer?.period === 'P1M' ? 30 : layer?.period === 'P16D' ? 16 : 1;
	setGibsDate(shiftIsoDay(current, days * step));
};

/** Show the most recent day that has imagery for the selected layer. */
export const goToLatestGibs = async (): Promise<void> => {
	if (get(gibsAvailability).status !== 'ready') await activateGibsLayer();
	const latest = latestAvailableDay(get(gibsAvailability).ranges);
	if (latest) setGibsDate(latest, false);
};

/** Switch to another catalogue entry, keeping the requested day. */
export const selectGibsLayer = (layerId: string): void => {
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
