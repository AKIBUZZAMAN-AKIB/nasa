/**
 * State for the NASA GIBS satellite history layer.
 *
 * Holds the selection (which layer, which day, how opaque), the availability
 * window fetched per layer from GIBS, and the actions the panel and the map
 * wiring share. Date resolution — snapping to a layer's cadence and clamping
 * to the days that really exist — happens here, so both the map and the UI
 * always agree on what is on screen.
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
	latestAvailableDay,
	parseGibsAvailability,
	parseGibsUrl,
	resolveAvailableDay,
	shiftIsoDay
} from '$lib/gibs';

/** Layer shown when the user has not picked another one. */
export const DEFAULT_GIBS_LAYER = 'MODIS_Terra_CorrectedReflectance_TrueColor';

/** Whether the satellite history panel is open. */
export const gibsPanelOpen = writable(false);

/** Selected layer; persisted so a reload returns to the same imagery. */
export const gibsLayerId = persisted<string>('gibs-layer', DEFAULT_GIBS_LAYER);

/**
 * Draw the imagery on the map at all (keeps the selection when off). Off by
 * default so the weather map looks unchanged until the user opts in from the
 * panel — the button opens the panel, ticking the box shows the imagery.
 */
export const gibsEnabled = persisted<boolean>('gibs-enabled', false);

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

	// A copy cached earlier today keeps the panel instant on a reload; the
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
 * approach the rest of the app uses — so a satellite view can be shared
 * without filling the back button with dates.
 *
 * Defaults are omitted: the layer stays out of the URL while the default one is
 * shown, and so does the day while the newest day is shown, which keeps a shared
 * link following the archive instead of freezing on today's date.
 */
const syncGibsUrl = (): void => {
	if (!browser) return;
	const url = new URL(window.location.href);
	const params = gibsUrlParams({
		enabled: get(gibsEnabled),
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

/** Read a shared link: `?gibs=<layer>&gibs-date=<day>` restores the view. */
const applyGibsUrlParams = (): void => {
	if (!browser) return;
	const { layerId, day } = parseGibsUrl(window.location.search);
	if (layerId) gibsLayerId.set(layerId);
	if (day) gibsRequestedDate.set(day);
	// Either parameter means the sender had the imagery on screen.
	if (layerId || day) gibsEnabled.set(true);
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

/** Jump to a specific day (the panel's date input and slider). */
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

/** Turn the imagery on or off (the panel's checkbox and shared links). */
export const setGibsEnabled = (enabled: boolean): void => {
	gibsEnabled.set(enabled);
	syncGibsUrl();
};

/** Switch to another catalogue entry, keeping the requested day. */
export const selectGibsLayer = (layerId: string): void => {
	void activateGibsLayer(layerId, true);
	syncGibsUrl();
};

/** Toggle the panel (the tool button and the panel header both use this). */
export const toggleGibsPanel = (): void => {
	const open = !get(gibsPanelOpen);
	gibsPanelOpen.set(open);
	if (open && get(gibsAvailability).status === 'idle') void activateGibsLayer();
};

/**
 * Load availability once on startup. Runs even while the imagery is hidden so
 * the panel opens on a ready date instead of "checking…".
 */
export const initGibsState = (): void => {
	if (!browser) return;
	applyGibsUrlParams();
	void activateGibsLayer();
};
