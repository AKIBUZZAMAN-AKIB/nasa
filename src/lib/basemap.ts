/**
 * Basemap provider chain: pure helpers (no map instance, no stores) so the
 * layering rules, the attribution settings and the failover logic can be unit
 * tested. `map-controls.ts` wires them to the real map.
 *
 * Preference order, first provider that loads wins:
 *   1. Maptoolkit community vector tiles (styles.maptoolkit.org)
 *   2. The Open-Meteo style on OpenFreeMap tiles (the previous default)
 *   3. The plain OpenFreeMap Positron / Dark style
 *
 * The weather layers are inserted relative to three hidden anchor layers
 * (`BEFORE_LAYER_RASTER`, `BEFORE_LAYER_VECTOR`, `BEFORE_LAYER_VECTOR_WATER_CLIP`),
 * so every provider only has to make those anchors exist in the right place.
 */
import {
	BEFORE_LAYER_RASTER,
	BEFORE_LAYER_VECTOR,
	BEFORE_LAYER_VECTOR_WATER_CLIP
} from '$lib/constants';

import type { AttributionControlOptions } from 'maplibre-gl';

// ---------------------------------------------------------------------------
// Style JSON shapes (loose on purpose: we only touch ids, types and sources)
// ---------------------------------------------------------------------------

export type StyleSourceJson = {
	type?: string;
	url?: string;
	tiles?: string[];
	bounds?: number[];
	minzoom?: number;
	maxzoom?: number;
	attribution?: string;
	[key: string]: unknown;
};

export type StyleLayerJson = {
	id: string;
	type: string;
	source?: string;
	'source-layer'?: string;
	[key: string]: unknown;
};

export type StyleJson = {
	version: 8;
	sources: Record<string, StyleSourceJson>;
	layers: StyleLayerJson[];
	[key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Provider list
// ---------------------------------------------------------------------------

export const BASEMAP_PROVIDERS = ['maptoolkit', 'open-meteo', 'openfreemap'] as const;
export type BasemapProvider = (typeof BASEMAP_PROVIDERS)[number];

export const BASEMAP_LABELS: Record<BasemapProvider, string> = {
	maptoolkit: 'Maptoolkit',
	'open-meteo': 'Open-Meteo',
	openfreemap: 'OpenFreeMap'
};

/**
 * Parse the comma separated `VITE_BASEMAP_PROVIDERS` list. Unknown names and
 * duplicates are dropped; an empty or fully invalid value gives the default
 * order. A shorter list disables the providers that are left out, e.g.
 * `open-meteo,openfreemap` switches Maptoolkit off.
 */
export const parseProviderOrder = (raw: string | null | undefined): BasemapProvider[] => {
	const order: BasemapProvider[] = [];
	for (const part of (raw ?? '').split(',')) {
		const id = part.trim().toLowerCase();
		const provider = BASEMAP_PROVIDERS.find((known) => known === id);
		if (provider && !order.includes(provider)) order.push(provider);
	}
	return order.length > 0 ? order : [...BASEMAP_PROVIDERS];
};

/** The provider to fall back to after `current`, if the order has one. */
export const nextProvider = (
	order: readonly BasemapProvider[],
	current: BasemapProvider
): BasemapProvider | undefined => {
	const index = order.indexOf(current);
	return index < 0 ? undefined : order[index + 1];
};

// ---------------------------------------------------------------------------
// Maptoolkit
// ---------------------------------------------------------------------------

export const MAPTOOLKIT_STYLES_URL = 'https://styles.maptoolkit.org';

/** Label languages offered by Maptoolkit's `{style}-{lang}.json` variants. */
export const MAPTOOLKIT_LANGUAGES = [
	'ar',
	'cs',
	'de',
	'en',
	'es',
	'fr',
	'hi',
	'hu',
	'it',
	'ja',
	'ko',
	'pl',
	'zh'
] as const;
export type MaptoolkitLanguage = (typeof MAPTOOLKIT_LANGUAGES)[number];
export const DEFAULT_MAPTOOLKIT_LANGUAGE: MaptoolkitLanguage = 'en';

/**
 * Maptoolkit's own default: every place in the local language of its country
 * (Bengali in Bangladesh) plus a Latin subtitle where that name is not Latin.
 * It is the plain `light.json` / `dark.json`; there is no `light-local.json`.
 */
export const MAPTOOLKIT_LOCAL_LABELS = 'local';
export type MaptoolkitLabels = MaptoolkitLanguage | typeof MAPTOOLKIT_LOCAL_LABELS;

export const resolveMaptoolkitLanguage = (raw: string | null | undefined): MaptoolkitLabels => {
	const value = (raw ?? '').trim().toLowerCase();
	if (value === MAPTOOLKIT_LOCAL_LABELS) return MAPTOOLKIT_LOCAL_LABELS;
	return MAPTOOLKIT_LANGUAGES.find((language) => language === value) ?? DEFAULT_MAPTOOLKIT_LANGUAGE;
};

/**
 * Light or dark style URL. The language variants (`light-en`) label every
 * place once, in that language; the plain style (`local`) shows local names
 * with a Latin subtitle, which doubles the labels on a map that is already busy.
 */
export const maptoolkitStyleUrl = (
	dark: boolean,
	language: MaptoolkitLabels = DEFAULT_MAPTOOLKIT_LANGUAGE
): string =>
	`${MAPTOOLKIT_STYLES_URL}/${dark ? 'dark' : 'light'}${
		language === MAPTOOLKIT_LOCAL_LABELS ? '' : `-${language}`
	}.json`;

/** True for maptoolkit.org and its sub-domains (styles, tiles, fonts, icons). */
export const isMaptoolkitUrl = (value: unknown): boolean => {
	if (typeof value !== 'string') return false;
	try {
		const { protocol, hostname } = new URL(value.replace(/\{[a-z-]+\}/g, '0'));
		return (
			protocol === 'https:' &&
			(hostname === 'maptoolkit.org' || hostname.endsWith('.maptoolkit.org'))
		);
	} catch {
		return false;
	}
};

/**
 * Ground layers: everything that paints a whole area (water, land cover,
 * relief). The weather raster has to sit above all of them, otherwise an
 * opaque fill hides it.
 */
const GROUND_SOURCE_LAYERS = new Set([
	'water',
	'bathymetry',
	'landuse',
	'landcover',
	'natural',
	'park'
]);
const SURFACE_LAYER_TYPES = new Set(['background', 'hillshade', 'color-relief', 'raster']);

const isGroundLayer = (layer: StyleLayerJson): boolean =>
	SURFACE_LAYER_TYPES.has(layer.type) ||
	(layer.type === 'fill' && GROUND_SOURCE_LAYERS.has(layer['source-layer'] ?? ''));

const isAdminLayer = (layer: StyleLayerJson): boolean => layer['source-layer'] === 'admin';

/** Hidden, transparent layer used as an insertion point for weather layers. */
export const hiddenAnchor = (id: string): StyleLayerJson => ({
	id,
	type: 'background',
	layout: { visibility: 'none' },
	paint: { 'background-color': 'rgba(0,0,0,0)', 'background-opacity': 0 }
});

/** Insert a hidden anchor before `beforeId`, or on top if that id is missing. */
export const addHiddenAnchor = (style: StyleJson, id: string, beforeId?: string): void => {
	if (style.layers.some((layer) => layer.id === id)) return;
	const anchor = hiddenAnchor(id);
	const index = beforeId ? style.layers.findIndex((layer) => layer.id === beforeId) : -1;
	if (index < 0) style.layers.push(anchor);
	else style.layers.splice(index, 0, anchor);
};

/** Id of the n-th Clip Water layer; the first one is the vector anchor itself. */
export const waterClipLayerId = (index: number): string =>
	index === 0 ? BEFORE_LAYER_VECTOR_WATER_CLIP : `${BEFORE_LAYER_VECTOR_WATER_CLIP}-${index + 1}`;

export type PreparedMaptoolkitStyle = {
	style: StyleJson;
	/** Id of the vector source that carries the basemap data. */
	vectorSource: string;
	/** Source layers the style reads from that vector source. */
	sourceLayers: string[];
};

/**
 * Validate a Maptoolkit style and insert the weather anchors:
 *
 *  - raster anchor: directly under the first administrative boundary. In the
 *    Maptoolkit styles every water, land and relief fill (and the bathymetry
 *    shading) comes before the borders, so the raster covers all of them, while
 *    borders, roads, buildings and labels stay readable on top. The "first line
 *    layer" rule of the other providers would put the raster under opaque
 *    water instead.
 *  - vector anchor: directly under the first label layer.
 *  - Clip Water: copies of the water fills of the Maptoolkit vector source,
 *    placed above the vector anchor. Copies on the official source are what the
 *    terms allow; the style itself is otherwise used unchanged.
 *
 * Throws when the style does not look like the version this layering was built
 * for, so the caller falls back to the next provider instead of drawing a map
 * with weather data hidden behind the basemap.
 */
export const prepareMaptoolkitStyle = (
	input: unknown,
	options: { clipWater: boolean }
): PreparedMaptoolkitStyle => {
	const candidate = input as Partial<StyleJson> | null;
	if (
		!candidate ||
		candidate.version !== 8 ||
		typeof candidate.sources !== 'object' ||
		candidate.sources === null ||
		!Array.isArray(candidate.layers) ||
		!candidate.layers.every((layer) => layer && typeof layer.id === 'string')
	) {
		throw new Error('Maptoolkit style is not a valid version 8 style.');
	}
	const style = candidate as StyleJson;
	const layers = style.layers;

	const reserved = [BEFORE_LAYER_RASTER, BEFORE_LAYER_VECTOR, BEFORE_LAYER_VECTOR_WATER_CLIP];
	const clash = layers.find((layer) => reserved.includes(layer.id));
	if (clash) throw new Error(`Maptoolkit style already uses the reserved layer id "${clash.id}".`);

	const adminIndex = layers.findIndex(isAdminLayer);
	if (adminIndex < 0) throw new Error('Maptoolkit style has no administrative boundary layer.');

	const vectorSource = layers[adminIndex].source;
	const source = vectorSource ? style.sources[vectorSource] : undefined;
	if (!vectorSource || source?.type !== 'vector' || !isMaptoolkitUrl(source.url)) {
		throw new Error('Maptoolkit style does not read from the official Maptoolkit vector tiles.');
	}

	const symbolIndex = layers.findIndex(
		(layer, index) => index > adminIndex && layer.type === 'symbol'
	);
	if (symbolIndex < 0) throw new Error('Maptoolkit style has no label layer above the borders.');

	const occluder = layers.slice(adminIndex).find(isGroundLayer);
	if (occluder) {
		throw new Error(`Maptoolkit layer "${occluder.id}" would be drawn above the weather raster.`);
	}

	const sourceLayers = [
		...new Set(
			layers.flatMap((layer) =>
				layer.source === vectorSource && typeof layer['source-layer'] === 'string'
					? [layer['source-layer']]
					: []
			)
		)
	];

	let clipLayers: StyleLayerJson[] = [];
	if (options.clipWater) {
		const waterFills = layers.filter(
			(layer) =>
				layer.type === 'fill' && layer.source === vectorSource && layer['source-layer'] === 'water'
		);
		clipLayers =
			waterFills.length > 0
				? waterFills.map((layer, index) => ({
						...structuredClone(layer),
						id: waterClipLayerId(index)
					}))
				: [hiddenAnchor(BEFORE_LAYER_VECTOR_WATER_CLIP)];
	}

	// Insert the later position first so the earlier index stays valid.
	const next = [...layers];
	next.splice(symbolIndex, 0, hiddenAnchor(BEFORE_LAYER_VECTOR), ...clipLayers);
	next.splice(adminIndex, 0, hiddenAnchor(BEFORE_LAYER_RASTER));

	return { style: { ...style, layers: next }, vectorSource, sourceLayers };
};

export type MaptoolkitTileJson = {
	tiles?: unknown;
	vector_layers?: { id?: unknown }[];
	attribution?: unknown;
};

/**
 * Check the vector TileJSON before the style is used: it must serve tiles from
 * Maptoolkit, offer every source layer the style reads, and carry the
 * copyright text the terms require on the map. Returns that attribution.
 */
export const checkMaptoolkitTileJson = (value: unknown, sourceLayers: string[]): string => {
	const tileJson = value as MaptoolkitTileJson | null;
	if (
		!tileJson ||
		!Array.isArray(tileJson.tiles) ||
		tileJson.tiles.length === 0 ||
		!tileJson.tiles.every(isMaptoolkitUrl)
	) {
		throw new Error('Maptoolkit TileJSON does not point at Maptoolkit tiles.');
	}
	const available = new Set((tileJson.vector_layers ?? []).map((layer) => layer?.id));
	const missing = sourceLayers.filter((layer) => !available.has(layer));
	if (missing.length > 0) {
		throw new Error(`Maptoolkit tiles are missing source layers: ${missing.join(', ')}`);
	}
	const attribution = typeof tileJson.attribution === 'string' ? tileJson.attribution : '';
	const text = attribution.toLowerCase();
	if (!text.includes('maptoolkit') || !text.includes('openstreetmap')) {
		throw new Error('Maptoolkit TileJSON has no Maptoolkit / OpenStreetMap attribution.');
	}
	return attribution;
};

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export const MAPLIBRE_CREDIT = '<a href="https://maplibre.org/" target="_blank">MapLibre</a>';

/**
 * Maptoolkit's terms (section 8) require "© Maptoolkit © Openstreetmap" to stay
 * visible at every size, orientation and zoom, so its control is never
 * compact: `compact: false` must be explicit, because an options object
 * without it still collapses on maps narrower than 640 px. The credit text is
 * also passed in directly, so it is on screen from the first frame instead of
 * after the TileJSON request; MapLibre drops the duplicate once the source
 * reports the same string.
 *
 * The other providers keep MapLibre's own defaults (collapsible).
 */
export const attributionOptionsFor = (
	provider: BasemapProvider,
	sourceAttribution?: string
): AttributionControlOptions =>
	provider === 'maptoolkit'
		? {
				compact: false,
				customAttribution: sourceAttribution
					? [MAPLIBRE_CREDIT, sourceAttribution]
					: [MAPLIBRE_CREDIT]
			}
		: { compact: true, customAttribution: MAPLIBRE_CREDIT };

// ---------------------------------------------------------------------------
// Failover state
// ---------------------------------------------------------------------------

/** How long a provider that failed is skipped before it is tried again. */
export const PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;

/** Consecutive tile failures, with no tile loading in between, that make an outage suspect. */
export const OUTAGE_FAILURE_THRESHOLD = 5;

/**
 * How long a suspect streak has to last before it counts as an outage. Failed
 * requests report back at once while the good ones are still on their way, so
 * a service that is only partly failing shows a burst of failures first.
 */
export const OUTAGE_GRACE_MS = 4000;

/**
 * Remembers providers that failed so a theme switch or a Clip Water toggle does
 * not wait for them again. Memory only: a page reload tries every provider.
 */
export class ProviderCooldown {
	private readonly until = new Map<BasemapProvider, number>();

	constructor(
		private readonly ttlMs: number = PROVIDER_COOLDOWN_MS,
		private readonly now: () => number = Date.now
	) {}

	markFailed(provider: BasemapProvider): void {
		this.until.set(provider, this.now() + this.ttlMs);
	}

	isCoolingDown(provider: BasemapProvider): boolean {
		const until = this.until.get(provider);
		if (until === undefined) return false;
		if (this.now() >= until) {
			this.until.delete(provider);
			return false;
		}
		return true;
	}
}

/**
 * Providers to try, in order. Providers that failed recently are skipped, but
 * if that would leave nothing, every provider is tried again.
 */
export const candidateProviders = (
	order: readonly BasemapProvider[],
	cooldown: ProviderCooldown
): BasemapProvider[] => {
	const ready = order.filter((provider) => !cooldown.isCoolingDown(provider));
	return ready.length > 0 ? ready : [...order];
};

/**
 * The vector source that carries the basemap itself: the one most layers read
 * from. A style can have small secondary vector sources next to it (Maptoolkit
 * has one for water depth), and those must not be watched with it: while they
 * keep loading, every success would cancel the outage streak of the main
 * source, so a basemap whose tiles all fail (a rate limit on its tile path)
 * would never be given up on. Ties go to the source that comes first.
 */
export const primaryVectorSource = (style: StyleJson): string | undefined => {
	const layersPerSource = new Map<string, number>();
	for (const [id, source] of Object.entries(style.sources ?? {})) {
		if (source?.type === 'vector') layersPerSource.set(id, 0);
	}
	for (const layer of style.layers ?? []) {
		if (layer.source !== undefined && layersPerSource.has(layer.source)) {
			layersPerSource.set(layer.source, (layersPerSource.get(layer.source) ?? 0) + 1);
		}
	}
	let primary: string | undefined;
	let most = -1;
	for (const [id, count] of layersPerSource) {
		if (count > most) {
			primary = id;
			most = count;
		}
	}
	return primary;
};

/**
 * Decides when a basemap that loaded its style is down after all. Feed it the
 * outcome of every tile request: after `threshold` failures in a row it waits
 * `graceMs`, and calls `onOutage` once if no tile loaded in the meantime. A
 * single bad tile, or a service that is only partly failing, never trips it.
 */
export class OutageDetector {
	private failures = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private finished = false;

	constructor(
		private readonly onOutage: () => void,
		private readonly threshold: number = OUTAGE_FAILURE_THRESHOLD,
		private readonly graceMs: number = OUTAGE_GRACE_MS
	) {}

	/** A tile loaded: the provider is serving, so the streak is over. */
	success(): void {
		this.failures = 0;
		this.cancelTimer();
	}

	failure(): void {
		if (this.finished) return;
		this.failures += 1;
		if (this.failures < this.threshold || this.timer !== undefined) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (this.finished || this.failures < this.threshold) return;
			this.finished = true;
			this.onOutage();
		}, this.graceMs);
	}

	/** Stop for good, e.g. because the style was replaced. */
	dispose(): void {
		this.finished = true;
		this.cancelTimer();
	}

	private cancelTimer(): void {
		if (this.timer === undefined) return;
		clearTimeout(this.timer);
		this.timer = undefined;
	}
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export const BASEMAP_REQUEST_TIMEOUT_MS = 6000;

/** `fetch` + JSON with a deadline, so a hanging provider falls back quickly. */
export const fetchJson = async <T>(
	url: string,
	timeoutMs: number = BASEMAP_REQUEST_TIMEOUT_MS
): Promise<T> => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
		return (await response.json()) as T;
	} catch (error) {
		if (controller.signal.aborted) throw new Error(`${url} did not answer within ${timeoutMs} ms`);
		throw error;
	} finally {
		clearTimeout(timer);
	}
};
