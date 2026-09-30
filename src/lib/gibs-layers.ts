/**
 * MapLibre wiring for the NASA GIBS satellite history layer.
 *
 * GIBS tiles are plain XYZ rasters with the acquisition date embedded in the
 * URL, so changing the date is a `source.setTiles()` call — no reload, no
 * flicker — and switching layer rebuilds the source because the
 * TileMatrixSet (and therefore the maximum zoom) changes with it.
 *
 * The imagery is inserted below the weather rasters and above the basemap, so
 * the forecast overlay still draws on top of it. It also has to survive
 * basemap style reloads (theme switch, globe/water-clip toggles), which wipe
 * every source and layer: a `style.load` listener re-adds it.
 */
import { type Unsubscriber, get } from 'svelte/store';

import { toast } from 'svelte-sonner';

import { gibsEnabled, gibsLayerId, gibsOpacity, gibsResolvedDate } from '$lib/stores/gibs';
import { map as mapStore } from '$lib/stores/map';
import { preferences } from '$lib/stores/preferences';

import { BEFORE_LAYER_RASTER, HILLSHADE_LAYER } from '$lib/constants';
import { GIBS_ATTRIBUTION, gibsLayerById, gibsTileUrl } from '$lib/gibs';

import type * as maplibregl from 'maplibre-gl';

const SOURCE_ID = 'gibs-imagery';
const LAYER_ID = 'gibs-imagery';

/** `GoogleMapsCompatible_Level9` → 9, the deepest zoom the layer really has. */
const levelOf = (tileMatrixSet: string): number => {
	const match = /_Level(\d+)$/.exec(tileMatrixSet);
	return match ? Number(match[1]) : 9;
};

let map: maplibregl.Map | undefined;
let unsubscribers: Unsubscriber[] = [];
let initialized = false;
/** URL of the tiles currently loaded, so a date change can be a no-op. */
let currentUrl: string | undefined;
/** Layer the current source was built for; a switch needs a fresh source. */
let currentLayerId: string | undefined;
/** Last seen hillshade preference, the anchor the layer is inserted before. */
let hillshadeOn = false;

/** Layer to insert before: the hillshade when it is drawn, else the basemap anchor. */
const anchorLayer = (map: maplibregl.Map): string | undefined => {
	if (hillshadeOn && map.getLayer(HILLSHADE_LAYER)) return HILLSHADE_LAYER;
	return map.getLayer(BEFORE_LAYER_RASTER) ? BEFORE_LAYER_RASTER : undefined;
};

/** Remove the imagery layer and its source, if either is still on the style. */
const removeGibs = (): void => {
	if (!map) return;
	try {
		if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
	} catch {
		// A concurrent style reload may have removed them already.
	}
	currentUrl = undefined;
	currentLayerId = undefined;
};

/** Add source and layer for the selected entry, or refresh their tiles in place. */
const syncGibs = (): void => {
	if (!map || !map.isStyleLoaded()) return;
	const layer = gibsLayerById(get(gibsLayerId));
	const day = get(gibsResolvedDate);
	const enabled = get(gibsEnabled);

	if (!enabled || !layer || !day) {
		removeGibs();
		return;
	}

	const url = gibsTileUrl(layer, day);
	const opacity = get(gibsOpacity) / 100;

	// Same layer, new date: retarget the existing source — this keeps the
	// previous tiles on screen until the new ones arrive.
	const source = map.getSource(SOURCE_ID) as maplibregl.RasterTileSource | undefined;
	if (source && currentLayerId === layer.id) {
		if (currentUrl !== url) {
			source.setTiles([url]);
			currentUrl = url;
		}
		if (map.getLayer(LAYER_ID)) {
			map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
			map.moveLayer(LAYER_ID, anchorLayer(map));
		}
		return;
	}

	removeGibs();
	map.addSource(SOURCE_ID, {
		type: 'raster',
		tiles: [url],
		// GIBS publishes 256 px tiles; MapLibre would otherwise assume 512.
		tileSize: 256,
		minzoom: 0,
		maxzoom: levelOf(layer.tileMatrixSet),
		attribution: `${GIBS_ATTRIBUTION} — ${layer.title} (${layer.subtitle})`
	});
	map.addLayer(
		{
			id: LAYER_ID,
			type: 'raster',
			source: SOURCE_ID,
			paint: {
				'raster-opacity': opacity,
				'raster-opacity-transition': { duration: 250, delay: 0 },
				// A short dissolve hides the seam when scrubbing through dates.
				'raster-fade-duration': 150
			}
		},
		anchorLayer(map)
	);
	currentUrl = url;
	currentLayerId = layer.id;
};

/** Basemap style reloads wipe every overlay: rebuild from the stores. */
const onStyleLoad = (): void => {
	currentUrl = undefined;
	currentLayerId = undefined;
	syncGibs();
};

/**
 * A tile that is not on the server (a day with no imagery, a sensor outage)
 * makes MapLibre emit a source-scoped error; surface it once per attempt
 * instead of leaving an unexplained hole in the map.
 */
const onMapError = (event: maplibregl.ErrorEvent & { sourceId?: string }): void => {
	if (event.sourceId !== SOURCE_ID) return;
	toast.error('No satellite imagery for this date', {
		id: 'gibs-tile-error',
		description: 'GIBS has a gap here — step to another day or use “Latest”.'
	});
};

/** Start following the GIBS stores; call once after the map has loaded. */
export const initGibsLayers = (): void => {
	const instance = get(mapStore);
	if (!instance || initialized) return;
	initialized = true;
	map = instance;

	hillshadeOn = get(preferences).hillshade;
	unsubscribers = [
		gibsLayerId.subscribe(syncGibs),
		gibsResolvedDate.subscribe(syncGibs),
		gibsOpacity.subscribe(syncGibs),
		gibsEnabled.subscribe(syncGibs),
		preferences.subscribe((value) => {
			if (value.hillshade === hillshadeOn) return;
			hillshadeOn = value.hillshade;
			syncGibs();
		})
	];
	map.on('style.load', onStyleLoad);
	map.on('error', onMapError);
	syncGibs();
};

/** Detach listeners and remove the imagery (page teardown). */
export const destroyGibsLayers = (): void => {
	for (const unsubscribe of unsubscribers) unsubscribe();
	unsubscribers = [];
	if (map) {
		map.off('style.load', onStyleLoad);
		map.off('error', onMapError);
	}
	removeGibs();
	map = undefined;
	initialized = false;
};
