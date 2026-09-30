/**
 * MapLibre wiring for the NASA GIBS satellite imagery, built so that playing
 * the archive through the timeline does not flicker.
 *
 * Two things learned from the service and from MapLibre decide this design:
 *
 *  1. GIBS sends `cache-control: no-store`, so warming an image cache ahead of
 *     time buys nothing — the bytes have to be fetched and decoded by the map
 *     itself. What does help is giving the next frame a head start.
 *  2. `setTiles()` reloads the source while keeping its loaded tiles renderable,
 *     but the swap then happens tile by tile, which shows up as a patchwork
 *     while scrubbing quickly.
 *
 * So the imagery lives on two layers — one shown, one hidden at zero opacity
 * (still visible to MapLibre, so its tiles load) — and a frame change fetches
 * into the hidden layer and cross-fades once its tiles are in. During replay
 * the hidden layer is already holding the *following* day, so most frames
 * appear without a wait at all.
 *
 * The imagery is inserted above the basemap and below the weather rasters, and
 * survives basemap style reloads (theme switch, globe/water-clip toggles),
 * which wipe every source and layer.
 */
import { type Unsubscriber, get, writable } from 'svelte/store';

import { toast } from 'svelte-sonner';

import { gibsBrowse, gibsLayerId, gibsOpacity, gibsResolvedDate } from '$lib/stores/gibs';
import { map as mapStore } from '$lib/stores/map';
import { preferences } from '$lib/stores/preferences';

import { BEFORE_LAYER_RASTER, HILLSHADE_LAYER } from '$lib/constants';
import { GIBS_ATTRIBUTION, type GibsLayerDef, gibsLayerById, gibsTileUrl } from '$lib/gibs';

import type * as maplibregl from 'maplibre-gl';

const SOURCE_IDS = ['gibs-imagery-a', 'gibs-imagery-b'] as const;
const LAYER_IDS = ['gibs-imagery-a', 'gibs-imagery-b'] as const;

/** How long a frame may take before it is shown half-loaded. */
const FRAME_TIMEOUT_MS = 3500;
/** Cross-fade length; short enough for a 0.5 s cadence, long enough to hide the seam. */
const FADE_MS = 180;

export interface GibsImageryState {
	status: 'idle' | 'loading' | 'ready' | 'slow' | 'error';
	/** Day currently on screen (the one that is really drawn). */
	day?: string;
}

/** Whether the frame on screen is in: lets the replay bar show a buffer chip. */
export const gibsImagery = writable<GibsImageryState>({ status: 'idle' });

interface Slot {
	sourceId: string;
	layerId: string;
	/** Day the slot's tiles point at. */
	day?: string;
	/** Catalogue entry the slot was built for (its zoom limit differs). */
	forLayerId?: string;
	awaitingRender: boolean;
	errored: boolean;
	/** The pump is filling this slot right now; a preload must leave it alone. */
	busy: boolean;
}

const slots: [Slot, Slot] = [
	{
		sourceId: SOURCE_IDS[0],
		layerId: LAYER_IDS[0],
		awaitingRender: false,
		errored: false,
		busy: false
	},
	{
		sourceId: SOURCE_IDS[1],
		layerId: LAYER_IDS[1],
		awaitingRender: false,
		errored: false,
		busy: false
	}
];

let map: maplibregl.Map | undefined;
let unsubscribers: Unsubscriber[] = [];
let initialized = false;
/** Slot the user is looking at. */
let visibleIndex: 0 | 1 = 0;
/** Guards the render pipeline so only one frame is ever being fetched. */
let pumping = false;
/** A store change that arrived mid-render has to be served afterwards. */
let dirty = false;
/** Last seen hillshade preference, the anchor the layers are inserted before. */
let hillshadeOn = false;

const visible = (): Slot => slots[visibleIndex];
const hidden = (): Slot => slots[visibleIndex === 0 ? 1 : 0];

/** `GoogleMapsCompatible_Level9` → 9, the deepest zoom the layer really has. */
const levelOf = (tileMatrixSet: string): number => {
	const match = /_Level(\d+)$/.exec(tileMatrixSet);
	return match ? Number(match[1]) : 9;
};

/** Layer to insert before: the hillshade when it is drawn, else the basemap anchor. */
const anchorLayer = (): string | undefined => {
	if (!map) return undefined;
	if (hillshadeOn && map.getLayer(HILLSHADE_LAYER)) return HILLSHADE_LAYER;
	return map.getLayer(BEFORE_LAYER_RASTER) ? BEFORE_LAYER_RASTER : undefined;
};

const targetOpacity = (): number => get(gibsOpacity) / 100;

/** Remove one slot's layer and source, if either is still on the style. */
const removeSlot = (slot: Slot): void => {
	if (!map) return;
	try {
		if (map.getLayer(slot.layerId)) map.removeLayer(slot.layerId);
		if (map.getSource(slot.sourceId)) map.removeSource(slot.sourceId);
	} catch {
		// A concurrent style reload may have removed them already.
	}
	slot.day = undefined;
	slot.forLayerId = undefined;
	slot.awaitingRender = false;
	slot.errored = false;
	slot.busy = false;
};

const removeAll = (): void => {
	removeSlot(slots[0]);
	removeSlot(slots[1]);
};

/**
 * Point a slot at a day, adding its source and layer when they are missing.
 * The slot is left visible at zero opacity: MapLibre only fetches tiles for
 * layers that are visible, so a hidden slot has to be "visible but clear" to
 * preload into.
 */
const retarget = (slot: Slot, layer: GibsLayerDef, day: string): void => {
	if (!map) return;
	const url = gibsTileUrl(layer, day);
	const source = map.getSource(slot.sourceId) as maplibregl.RasterTileSource | undefined;

	if (source && slot.forLayerId === layer.id) {
		source.setTiles([url]);
		map.setLayoutProperty(slot.layerId, 'visibility', 'visible');
		return;
	}

	// Different catalogue entry (its TileMatrixSet and therefore maxzoom differ):
	// the source has to be rebuilt rather than retargeted.
	removeSlot(slot);
	map.addSource(slot.sourceId, {
		type: 'raster',
		tiles: [url],
		// GIBS publishes 256 px tiles; MapLibre would otherwise assume 512.
		tileSize: 256,
		minzoom: 0,
		maxzoom: levelOf(layer.tileMatrixSet),
		// One credit is enough: the attribution control lists every source, and
		// both slots serve the same imagery.
		attribution:
			slot === slots[0] ? `${GIBS_ATTRIBUTION} — ${layer.title} (${layer.subtitle})` : undefined
	});
	map.addLayer(
		{
			id: slot.layerId,
			type: 'raster',
			source: slot.sourceId,
			layout: { visibility: 'visible' },
			paint: {
				'raster-opacity': 0,
				'raster-opacity-transition': { duration: FADE_MS, delay: 0 },
				'raster-fade-duration': FADE_MS
			}
		},
		anchorLayer()
	);
	slot.day = day;
	slot.forLayerId = layer.id;
	slot.awaitingRender = false;
	slot.errored = false;

	// MapLibre reports a source whose layers just became visible as loaded before
	// it has re-collected its tiles, so wait for one render pass before judging.
	map.once('render', () => {
		slot.awaitingRender = false;
	});
	slot.awaitingRender = true;
	map.triggerRepaint();
};

/** Is a slot's frame fully in? Same rule the weather frame manager uses. */
const isSlotLoaded = (slot: Slot): boolean => {
	if (!map) return false;
	if (slot.errored || slot.awaitingRender) return false;
	return !!map.getSource(slot.sourceId) && map.isSourceLoaded(slot.sourceId);
};

/**
 * Resolve when the slot's tiles are in, or when the wait ran out: a slow server
 * must not stall the replay, and a half-loaded frame is still that day's frame.
 */
const waitForSlot = (slot: Slot, timeoutMs = FRAME_TIMEOUT_MS): Promise<boolean> => {
	if (!map) return Promise.resolve(false);
	if (isSlotLoaded(slot)) return Promise.resolve(true);

	return new Promise((resolve) => {
		const instance = map;
		if (!instance) return resolve(false);
		const finish = (loaded: boolean) => {
			instance.off('sourcedata', check);
			instance.off('idle', check);
			clearTimeout(timer);
			resolve(loaded);
		};
		const timer = setTimeout(() => finish(isSlotLoaded(slot)), timeoutMs);
		const check = () => {
			if (slot.errored) finish(false);
			else if (isSlotLoaded(slot)) finish(true);
		};

		instance.on('sourcedata', check);
		instance.on('idle', check);
	});
};

/** Cross-fade to a slot whose frame is in, and mark it as the visible one. */
const swap = (slot: Slot): void => {
	if (!map || slot === visible()) return;
	const from = visible();
	const opacity = targetOpacity();

	map.setPaintProperty(slot.layerId, 'raster-opacity-transition', {
		duration: FADE_MS,
		delay: 0
	});
	map.setPaintProperty(from.layerId, 'raster-opacity-transition', {
		duration: FADE_MS,
		delay: 0
	});
	map.setPaintProperty(slot.layerId, 'raster-opacity', opacity);
	map.setPaintProperty(from.layerId, 'raster-opacity', 0);

	const previous = from;
	visibleIndex = visibleIndex === 0 ? 1 : 0;
	slot.busy = false;
	gibsImagery.set({ status: 'ready', day: slot.day });

	setTimeout(() => {
		// Still not the visible one (a newer frame came in meanwhile): leave it.
		if (!map || previous === visible()) return;
		map.setLayoutProperty(previous.layerId, 'visibility', 'none');
	}, FADE_MS + 40);
};

/** Hide both slots (imagery off, or no day to draw). */
const hideAll = (): void => {
	if (!map) return;
	for (const slot of slots) {
		if (map.getLayer(slot.layerId)) {
			map.setPaintProperty(slot.layerId, 'raster-opacity', 0);
			map.setLayoutProperty(slot.layerId, 'visibility', 'none');
		}
	}
	gibsImagery.set({ status: 'idle' });
};

/**
 * Follow the stores: keep the visible frame equal to the resolved day, fetch a
 * changed day into the hidden slot first, and cross-fade when it is in.
 */
const pump = async (): Promise<void> => {
	if (!map || !map.isStyleLoaded()) return;
	if (pumping) {
		dirty = true;
		return;
	}
	pumping = true;
	try {
		for (;;) {
			const layer = gibsLayerById(get(gibsLayerId));
			const day = get(gibsResolvedDate);
			const browsing = get(gibsBrowse);

			if (!browsing || !layer || !day) {
				hideAll();
				return;
			}

			if (visible().day === day && visible().forLayerId === layer.id) {
				map.setPaintProperty(visible().layerId, 'raster-opacity', targetOpacity());
				map.moveLayer(visible().layerId, anchorLayer());
				gibsImagery.set({ status: 'ready', day });
				return;
			}

			const target = hidden();
			if (target.day !== day || target.forLayerId !== layer.id) {
				gibsImagery.set({ status: 'loading', day });
				// Claimed before the fetch: a preload arriving meanwhile must not
				// retarget the slot out from under this frame.
				target.busy = true;
				retarget(target, layer, day);
			} else {
				target.busy = true;
			}

			const loaded = await waitForSlot(target);
			target.busy = false;

			// A newer request landed while this frame was loading: start over.
			if (
				get(gibsResolvedDate) !== day ||
				gibsLayerById(get(gibsLayerId))?.id !== layer.id ||
				!get(gibsBrowse)
			) {
				continue;
			}

			swap(target);
			if (!loaded) gibsImagery.set({ status: 'slow', day });
			return;
		}
	} catch {
		// A style reload mid-flight can make MapLibre throw; the style.load
		// listener rebuilds and pumps again.
	} finally {
		pumping = false;
		if (dirty) {
			dirty = false;
			void pump();
		}
	}
};

/**
 * Fetch a day into the hidden slot before it is needed — what makes a replay
 * look smooth: by the time the frame comes up, its tiles are usually already
 * decoded.
 */
export const preloadGibsDay = (day: string | undefined): void => {
	if (!map || !day || !get(gibsBrowse)) return;
	const layer = gibsLayerById(get(gibsLayerId));
	if (!layer) return;
	const slot = hidden();
	if (slot.day === day && slot.forLayerId === layer.id) return;
	// Never disturb the slot the pump is filling, or one that is becoming visible.
	if (slot.busy || slot.awaitingRender) return;
	retarget(slot, layer, day);
};

/** Basemap style reloads wipe every overlay: rebuild from the stores. */
const onStyleLoad = (): void => {
	slots[0].day = undefined;
	slots[1].day = undefined;
	gibsImagery.set({ status: 'idle' });
	void pump();
};

/**
 * A tile that is not on the server (a day with no imagery, a sensor outage)
 * makes MapLibre emit a source-scoped error; surface it once per attempt
 * instead of leaving an unexplained hole in the map.
 */
const onMapError = (event: maplibregl.ErrorEvent & { sourceId?: string }): void => {
	if (!event.sourceId || !SOURCE_IDS.includes(event.sourceId as (typeof SOURCE_IDS)[number]))
		return;
	const slot = slots.find((entry) => entry.sourceId === event.sourceId);
	if (slot) slot.errored = true;
	gibsImagery.set({ status: 'error', day: get(gibsResolvedDate) });
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
		gibsLayerId.subscribe(() => void pump()),
		gibsResolvedDate.subscribe(() => void pump()),
		gibsBrowse.subscribe(() => void pump()),
		gibsOpacity.subscribe(() => {
			if (map?.getLayer(visible().layerId) && visible().day !== undefined) {
				map.setPaintProperty(visible().layerId, 'raster-opacity', targetOpacity());
			}
		}),
		preferences.subscribe((value) => {
			if (value.hillshade === hillshadeOn) return;
			hillshadeOn = value.hillshade;
			// Both slots sit at the same anchor; keep them together.
			for (const slot of slots) {
				if (map?.getLayer(slot.layerId)) map.moveLayer(slot.layerId, anchorLayer());
			}
		})
	];
	map.on('style.load', onStyleLoad);
	map.on('error', onMapError);
	void pump();
};

/** Detach listeners and remove the imagery (page teardown). */
export const destroyGibsLayers = (): void => {
	for (const unsubscribe of unsubscribers) unsubscribe();
	unsubscribers = [];
	if (map) {
		map.off('style.load', onStyleLoad);
		map.off('error', onMapError);
	}
	removeAll();
	map = undefined;
	initialized = false;
	gibsImagery.set({ status: 'idle' });
};
