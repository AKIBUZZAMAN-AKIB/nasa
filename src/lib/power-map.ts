import type { PowerGridOverlay } from '$lib/stores/power';
import type * as maplibregl from 'maplibre-gl';

const SOURCE_ID = 'nasa-power-regional-source';
const LAYER_ID = 'nasa-power-regional-cells';

const COLOR_STOPS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] as const;
const appliedOverlays = new WeakMap<maplibregl.Map, PowerGridOverlay | undefined>();

function colorExpression(min: number, max: number): maplibregl.ExpressionSpecification {
	if (min === max) return ['literal', COLOR_STOPS[2]];
	const span = max - min;
	return [
		'interpolate',
		['linear'],
		['get', 'value'],
		min,
		COLOR_STOPS[0],
		min + span * 0.25,
		COLOR_STOPS[1],
		min + span * 0.5,
		COLOR_STOPS[2],
		min + span * 0.75,
		COLOR_STOPS[3],
		max,
		COLOR_STOPS[4]
	];
}

function asFeatureCollection(
	overlay: PowerGridOverlay
): GeoJSON.FeatureCollection<
	GeoJSON.Point,
	{ value: number; key: string; latitude: number; longitude: number }
> {
	return {
		type: 'FeatureCollection',
		features: overlay.features
	};
}

/** Render POWER regional GeoJSON as native-grid sample points on the map. */
export function syncPowerGridLayer(
	map: maplibregl.Map | undefined,
	overlay: PowerGridOverlay | undefined,
	visible: boolean
): void {
	if (!map || !map.isStyleLoaded()) return;

	const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
	if (!overlay || overlay.features.length === 0) {
		if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
		appliedOverlays.delete(map);
		return;
	}

	if (source) {
		// styledata fires in response to setData as well; only send new data when
		// the store publishes a new overlay to avoid a render/event feedback loop.
		if (appliedOverlays.get(map) !== overlay) {
			source.setData(asFeatureCollection(overlay));
			appliedOverlays.set(map, overlay);
		}
	} else {
		map.addSource(SOURCE_ID, {
			type: 'geojson',
			data: asFeatureCollection(overlay)
		});
		appliedOverlays.set(map, overlay);
	}

	const color = colorExpression(overlay.min, overlay.max);
	if (map.getLayer(LAYER_ID)) {
		map.setPaintProperty(LAYER_ID, 'circle-color', color);
		map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
		return;
	}

	map.addLayer({
		id: LAYER_ID,
		type: 'circle',
		source: SOURCE_ID,
		paint: {
			'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 3.5, 5, 6, 9, 9],
			'circle-color': color,
			'circle-opacity': 0.88,
			'circle-stroke-color': '#ffffff',
			'circle-stroke-width': 1,
			'circle-stroke-opacity': 0.9
		},
		layout: { visibility: visible ? 'visible' : 'none' }
	});
}
