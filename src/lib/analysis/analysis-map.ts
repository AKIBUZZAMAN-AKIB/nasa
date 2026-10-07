/**
 * Draws the Spatial tab's per-cell statistic on the MapLibre map as filled
 * grid-cell polygons. Colours are computed by the same D3 scale as the panel
 * chart and passed as a feature property, so map and chart always agree.
 */
import type * as maplibregl from 'maplibre-gl';

const SOURCE_ID = 'analysis-spatial-source';
const FILL_ID = 'analysis-spatial-fill';
const LINE_ID = 'analysis-spatial-outline';

export interface AnalysisGridCell {
	latitude: number;
	longitude: number;
	color: string;
	value: number;
	label: string;
}

export interface AnalysisGridOverlay {
	latStep: number;
	lonStep: number;
	cells: AnalysisGridCell[];
}

export function overlayToGeoJson(
	overlay: AnalysisGridOverlay
): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
	const hy = overlay.latStep / 2;
	const hx = overlay.lonStep / 2;
	return {
		type: 'FeatureCollection',
		features: overlay.cells.map((c) => ({
			type: 'Feature',
			properties: { color: c.color, value: c.value, label: c.label },
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[c.longitude - hx, c.latitude - hy],
						[c.longitude + hx, c.latitude - hy],
						[c.longitude + hx, c.latitude + hy],
						[c.longitude - hx, c.latitude + hy],
						[c.longitude - hx, c.latitude - hy]
					]
				]
			}
		}))
	};
}

export function syncAnalysisGridLayer(
	map: maplibregl.Map | undefined,
	overlay: AnalysisGridOverlay | undefined
): void {
	if (!map || !map.isStyleLoaded()) return;
	if (!overlay || overlay.cells.length === 0) {
		if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
		if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
		if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
		return;
	}
	const data = overlayToGeoJson(overlay);
	const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
	if (source) source.setData(data);
	else map.addSource(SOURCE_ID, { type: 'geojson', data });
	if (!map.getLayer(FILL_ID)) {
		map.addLayer({
			id: FILL_ID,
			type: 'fill',
			source: SOURCE_ID,
			paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.62 }
		});
	}
	if (!map.getLayer(LINE_ID)) {
		map.addLayer({
			id: LINE_ID,
			type: 'line',
			source: SOURCE_ID,
			paint: { 'line-color': '#000000', 'line-opacity': 0.15, 'line-width': 0.5 }
		});
	}
}
