import { get } from 'svelte/store';

import {
	type Domain,
	GridFactory,
	domainOptions,
	omProtocol,
	updateCurrentBounds
} from '@openmeteo/weather-map-layer';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { mode } from 'mode-watcher';
import { toast } from 'svelte-sonner';

import { map as m } from '$lib/stores/map';
import { omProtocolSettings } from '$lib/stores/om-protocol-settings';
import { defaultPreferences, preferences as p } from '$lib/stores/preferences';
import { domain as d } from '$lib/stores/variables';

import {
	BEFORE_LAYER_RASTER,
	BEFORE_LAYER_VECTOR,
	BEFORE_LAYER_VECTOR_WATER_CLIP,
	HILLSHADE_LAYER
} from '$lib/constants';

import { addOmFileLayers } from './layers';
import { shouldCancelPendingTilesWhileZooming } from './runtime-performance';
import { updateUrl } from './url';

import type { AddProtocolAction, RequestParameters } from 'maplibre-gl';

export const createMap = async (container: HTMLElement) => {
	// MapLibre 6 loads its worker from a URL relative to its own module, which a
	// bundled app cannot serve (404, blank map). Use the worker bundled by Vite.
	maplibregl.setWorkerUrl(maplibreWorkerUrl);

	// MapLibre 6.11 narrowed `AddProtocolAction` so its response data no longer
	// allows the `null` that `omProtocol` reports for cancelled or empty tiles.
	// MapLibre still handles a null payload at runtime (it resolves an empty
	// response), so keep the behaviour and only align the type here.
	maplibregl.addProtocol('om', ((params: RequestParameters, abortController: AbortController) =>
		omProtocol(params, abortController, get(omProtocolSettings))) as AddProtocolAction);

	const style = await getStyle();

	const domainObject = domainOptions.find(({ value }: Domain) => value === get(d));
	if (!domainObject) {
		throw new Error('Domain not found');
	}
	const grid = GridFactory.create(domainObject.grid);

	const map = new maplibregl.Map({
		container,
		style,
		center: grid.getCenter(),
		zoom: domainObject.grid.zoom,
		keyboard: false,
		hash: true,
		maxPitch: 85,
		// On constrained/slow connections, drop obsolete lower-zoom tiles while
		// zooming instead of spending time and bandwidth on pixels the user left.
		cancelPendingTileRequestsWhileZooming: shouldCancelPendingTilesWhileZooming()
	});
	m.set(map);

	setMapControlSettings();

	// update bounds when new tiles are requested, to trigger new data ranges loading if necessary
	map.on('dataloading', () => {
		const bounds = map.getBounds();
		const [minLng, minLat] = bounds.getSouthWest().toArray();
		const [maxLng, maxLat] = bounds.getNorthEast().toArray();
		updateCurrentBounds([minLng, minLat, maxLng, maxLat]);
	});

	return map;
};

export const setMapControlSettings = () => {
	const map = get(m);
	if (!map) return;

	map.touchZoomRotate.disableRotation();
	map.addControl(
		new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true })
	);
	// Geolocation is only available in secure contexts (HTTPS or localhost).
	// Skip the control on raw IP/HTTP previews rather than logging a warning.
	if (window.isSecureContext && 'geolocation' in navigator) {
		map.addControl(
			new maplibregl.GeolocateControl({
				fitBoundsOptions: { maxZoom: 13.5 },
				positionOptions: { enableHighAccuracy: true },
				trackUserLocation: true
			})
		);
	}

	const globeControl = new maplibregl.GlobeControl();
	map.addControl(globeControl);
	globeControl._globeButton.addEventListener('click', () => globeHandler());

	map.scrollZoom.setZoomRate(1 / 85);
	map.scrollZoom.setWheelZoomRate(1 / 85);
};

export const addTerrainSource = (map: maplibregl.Map, name: string = 'terrainSource') => {
	map.setSky({
		'sky-color': '#000000',
		'sky-horizon-blend': 0.8,
		'horizon-color': '#80C1FF',
		'horizon-fog-blend': 0.6,
		'fog-color': '#D6EAFF',
		'fog-ground-blend': 0
	});

	// Register DEM sources on demand. The old eager setup fetched TileJSON for
	// both terrain sources on every visit, even when neither control was used.
	if (!map.getSource(name)) {
		map.addSource(name, {
			type: 'raster-dem',
			url: 'https://tiles.mapterhorn.com/tilejson.json'
		});
	}
};

export const addHillshadeLayer = () => {
	const map = get(m);
	if (!map) return;

	if (!map.getSource('terrainSource')) addTerrainSource(map);
	if (map.getLayer(HILLSHADE_LAYER)) return;

	map.addLayer(
		{
			source: 'terrainSource',
			id: HILLSHADE_LAYER,
			type: 'hillshade',
			paint: {
				'hillshade-method': 'igor',
				'hillshade-shadow-color': 'rgba(0,0,0,0.4)',
				'hillshade-highlight-color': 'rgba(255,255,255,0.35)'
			}
		},
		BEFORE_LAYER_RASTER
	);
};

// Mode the currently applied basemap style was fetched for. Can drift from
// mode.current: when an embedding page's color-scheme propagates into our
// prefers-color-scheme, mode-watcher flips the UI mode without any style
// reload happening.
let appliedStyleMode: 'light' | 'dark' = 'light';

export const getAppliedStyleMode = () => appliedStyleMode;

let warnedBasemapFallback = false;

const OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles';

type StyleSourceJson = {
	type?: string;
	url?: string;
	tiles?: string[];
	bounds?: number[];
	minzoom?: number;
	maxzoom?: number;
	attribution?: string;
	[key: string]: unknown;
};

type StyleLayerJson = {
	id: string;
	type: string;
	source?: string;
	'source-layer'?: string;
	[key: string]: unknown;
};

type StyleJson = {
	version: 8;
	sources: Record<string, StyleSourceJson>;
	layers: StyleLayerJson[];
	[key: string]: unknown;
};

type OpenFreeMapTileJson = {
	tiles?: string[];
	vector_layers?: { id: string }[];
	bounds?: number[];
	minzoom?: number;
	maxzoom?: number;
	attribution?: string;
};

/**
 * Use OpenFreeMap's public CORS-enabled vector tiles with the current style.
 * As of 2026-10-01, `tiles.open-meteo.com/planet_minimal.json` and its MVT
 * responses omit Access-Control-Allow-Origin, so browser fetches fail even
 * though the style JSON itself is readable. The style uses standard
 * OpenMapTiles source-layer ids; verify those ids before switching providers.
 */
const useOpenFreeMapVectorTiles = async (
	style: StyleJson,
	sourceName: string
): Promise<StyleJson> => {
	const source = style.sources[sourceName];
	if (!source || source.type !== 'vector') {
		throw new Error(`Basemap source ${sourceName} is not a vector source.`);
	}

	const response = await fetch(OPENFREEMAP_TILEJSON_URL);
	if (!response.ok) throw new Error(`OpenFreeMap TileJSON HTTP ${response.status}`);
	const tileJson = (await response.json()) as OpenFreeMapTileJson;
	if (
		!Array.isArray(tileJson.tiles) ||
		tileJson.tiles.length === 0 ||
		!Array.isArray(tileJson.vector_layers)
	) {
		throw new Error('Invalid OpenFreeMap TileJSON response.');
	}

	const requiredLayers = new Set<string>(
		style.layers.flatMap((layer) =>
			layer.source === sourceName && typeof layer['source-layer'] === 'string'
				? [layer['source-layer']]
				: []
		)
	);
	const availableLayers = new Set(tileJson.vector_layers.map((layer) => layer.id));
	const missingLayers = [...requiredLayers].filter((layer) => !availableLayers.has(layer));
	if (missingLayers.length > 0) {
		throw new Error(`OpenFreeMap is missing required source layers: ${missingLayers.join(', ')}`);
	}

	// Inline TileJSON into the style: this avoids a duplicate fetch on map load
	// and carries over the provider's own required attribution.
	delete source.url;
	source.tiles = tileJson.tiles;
	if (tileJson.bounds !== undefined) source.bounds = tileJson.bounds;
	if (tileJson.minzoom !== undefined) source.minzoom = tileJson.minzoom;
	if (tileJson.maxzoom !== undefined) source.maxzoom = tileJson.maxzoom;
	if (tileJson.attribution) source.attribution = tileJson.attribution;
	return style;
};

const addHiddenAnchor = (style: StyleJson, id: string, beforeId?: string): void => {
	if (style.layers.some((layer) => layer.id === id)) return;
	const anchor = {
		id,
		type: 'background',
		layout: { visibility: 'none' },
		paint: { 'background-color': 'rgba(0,0,0,0)', 'background-opacity': 0 }
	};
	const index = beforeId ? style.layers.findIndex((layer) => layer.id === beforeId) : -1;
	if (index < 0) style.layers.push(anchor);
	else style.layers.splice(index, 0, anchor);
};

/** OpenFreeMap style as a CORS-enabled fallback if the Open-Meteo style host is unavailable. */
const fallbackBasemapStyle = async (clipWater: boolean): Promise<StyleJson> => {
	const fallbackUrl = `${OPENFREEMAP_STYLE_URL}/${appliedStyleMode === 'dark' ? 'dark' : 'positron'}`;
	const response = await fetch(fallbackUrl);
	if (!response.ok) throw new Error(`OpenFreeMap style HTTP ${response.status}`);
	const style = (await response.json()) as StyleJson;
	if (style?.version !== 8 || !style?.sources || !Array.isArray(style.layers)) {
		throw new Error('Invalid OpenFreeMap style response.');
	}

	const vectorSource = Object.entries(style.sources).find(
		([, source]) => source?.type === 'vector'
	);
	if (!vectorSource) throw new Error('OpenFreeMap style has no vector source.');
	const [sourceName] = vectorSource;
	await useOpenFreeMapVectorTiles(style, sourceName);

	// Preserve weather-layer insertion order: raster below roads, vector
	// contours/arrows above roads but below labels, and a water mask when the
	// user has enabled Clip Water.
	const firstLine = style.layers.find((layer) => layer.type === 'line')?.id;
	const firstSymbol = style.layers.find((layer) => layer.type === 'symbol')?.id;
	addHiddenAnchor(style, BEFORE_LAYER_RASTER, firstLine);
	addHiddenAnchor(style, BEFORE_LAYER_VECTOR, firstSymbol);
	if (clipWater && !style.layers.some((layer) => layer.id === BEFORE_LAYER_VECTOR_WATER_CLIP)) {
		const waterFill = style.layers.find(
			(layer) =>
				layer.type === 'fill' && layer.source === sourceName && layer['source-layer'] === 'water'
		);
		if (waterFill) {
			const index = style.layers.findIndex((layer) => layer.id === BEFORE_LAYER_VECTOR);
			style.layers.splice(index + 1, 0, { ...waterFill, id: BEFORE_LAYER_VECTOR_WATER_CLIP });
		} else {
			addHiddenAnchor(style, BEFORE_LAYER_VECTOR_WATER_CLIP, firstSymbol);
		}
	}
	return style;
};

export const getStyle = async () => {
	const preferences = get(p);
	appliedStyleMode = mode.current === 'dark' ? 'dark' : 'light';
	const styleUrl = `https://static-assets.open-meteo.com/map-assets/styles/minimal-planet-maps${appliedStyleMode === 'dark' ? '-dark' : ''}${preferences.clipWater ? '-water-clip' : ''}.json`;
	let style: StyleJson;

	try {
		const response = await fetch(styleUrl);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		style = (await response.json()) as StyleJson;
		if (style?.version !== 8 || !style?.sources || !Array.isArray(style.layers)) {
			throw new Error('Invalid basemap style response');
		}

		const tileJsonSource = Object.entries(style.sources).find(
			([, source]) => typeof source.url === 'string' && source.type === 'vector'
		);
		if (tileJsonSource) {
			const [sourceName, source] = tileJsonSource;
			const sourceUrlValue = source.url;
			if (typeof sourceUrlValue !== 'string') {
				throw new Error('Basemap vector source has no TileJSON URL.');
			}
			const sourceUrl = new URL(sourceUrlValue);
			if (sourceUrl.hostname === 'tiles.open-meteo.com') {
				style = await useOpenFreeMapVectorTiles(style, sourceName);
				console.info(
					'Using OpenFreeMap CORS-enabled vector tiles with the Open-Meteo basemap style.'
				);
			} else {
				const sourceResponse = await fetch(sourceUrlValue);
				if (!sourceResponse.ok) throw new Error(`Basemap TileJSON HTTP ${sourceResponse.status}`);
			}
		}
	} catch (error) {
		if (!warnedBasemapFallback) {
			warnedBasemapFallback = true;
			toast.warning('Open-Meteo basemap unavailable; using OpenFreeMap instead.', {
				id: 'basemap-fallback'
			});
		}
		console.warn('Basemap style request failed; using the OpenFreeMap fallback.', error);
		style = await fallbackBasemapStyle(preferences.clipWater);
	}

	return (
		preferences.globe ? { ...style, projection: { type: 'globe' } } : style
	) as maplibregl.StyleSpecification;
};

export const terrainHandler = () => {
	const preferences = get(p);
	preferences.terrain = !preferences.terrain;
	p.set(preferences);
	updateUrl('terrain', String(preferences.terrain), String(defaultPreferences.terrain));
};

export const globeHandler = () => {
	const preferences = get(p);
	preferences.globe = !preferences.globe;
	p.set(preferences);
	updateUrl('globe', String(preferences.globe), String(defaultPreferences.globe));
};

export const reloadStyles = () => {
	getStyle().then((style) => {
		const map = get(m);
		if (!map) return;
		map.setStyle(style);
		map.once('styledata', () => {
			setTimeout(() => {
				const preferences = get(p);
				if (preferences.hillshade) {
					addHillshadeLayer();
					addTerrainSource(map, 'terrainSource2');
					if (preferences.terrain) {
						map.setTerrain({ source: 'terrainSource2' });
					}
				}
				addOmFileLayers();
			}, 50);
		});
	});
};
