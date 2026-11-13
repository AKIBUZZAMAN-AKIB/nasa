<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import { mode } from 'mode-watcher';

	import {
		BANGLADESH_OUTLINE,
		REGIONS,
		type Region,
		inRegion,
		pointRegionId
	} from '$lib/trend/regions';

	import type { GibsOverlay } from '$lib/trend/catalog';
	import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

	interface Props {
		region: Region;
		/** Regions the selected variable can be analysed for. */
		allowed: Set<string>;
		sites?: { id: string; lat: number; lon: number }[];
		overlay?: GibsOverlay;
		onselect: (id: string) => void;
	}

	let { region, allowed, sites = [], overlay, onselect }: Props = $props();

	let container: HTMLDivElement;
	let map: MapLibreMap | undefined;
	let loaded = $state(false);
	let failed = $state(false);
	let pointMode = $state(false);
	let showOverlay = $state(false);

	const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
	const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

	function boxPolygon([w, s, e, n]: [number, number, number, number]): [number, number][] {
		return [
			[w, s],
			[e, s],
			[e, n],
			[w, n],
			[w, s]
		];
	}

	function regionsGeoJson(selectedId: string, allowedIds: Set<string>) {
		const features = REGIONS.filter((r) => r.domain !== 'arctic').map((r) => ({
			type: 'Feature' as const,
			properties: {
				id: r.id,
				name: r.name,
				selected: r.id === selectedId,
				allowed: allowedIds.has(r.id),
				country: r.id === 'bangladesh'
			},
			geometry: {
				type: 'Polygon' as const,
				coordinates: [r.polygon ?? boxPolygon(r.bbox)]
			}
		}));
		if (selectedId.startsWith('point:')) {
			const custom = region;
			features.push({
				type: 'Feature',
				properties: {
					id: custom.id,
					name: custom.name,
					selected: true,
					allowed: true,
					country: false
				},
				geometry: { type: 'Polygon', coordinates: [boxPolygon(custom.bbox)] }
			});
		}
		return { type: 'FeatureCollection' as const, features };
	}

	function sitesGeoJson(list: { id: string; lat: number; lon: number }[]) {
		return {
			type: 'FeatureCollection' as const,
			features: list.map((s) => ({
				type: 'Feature' as const,
				properties: { id: s.id },
				geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] }
			}))
		};
	}

	function addLayers() {
		if (!map) return;
		if (!map.getSource('regions')) {
			map.addSource('regions', { type: 'geojson', data: regionsGeoJson(region.id, allowed) });
			map.addLayer({
				id: 'regions-fill',
				type: 'fill',
				source: 'regions',
				paint: {
					'fill-color': [
						'case',
						['get', 'selected'],
						'#2563eb',
						['get', 'allowed'],
						'#64748b',
						'#94a3b8'
					],
					'fill-opacity': ['case', ['get', 'selected'], 0.22, ['get', 'country'], 0.0, 0.06]
				}
			});
			map.addLayer({
				id: 'regions-line',
				type: 'line',
				source: 'regions',
				paint: {
					'line-color': ['case', ['get', 'selected'], '#1d4ed8', '#64748b'],
					'line-width': ['case', ['get', 'selected'], 2.5, ['get', 'country'], 1.4, 0.8],
					'line-dasharray': ['case', ['get', 'allowed'], ['literal', [1, 0]], ['literal', [2, 2]]]
				}
			});
		}
		if (!map.getSource('sites')) {
			map.addSource('sites', { type: 'geojson', data: sitesGeoJson(sites) });
			map.addLayer({
				id: 'sites',
				type: 'circle',
				source: 'sites',
				paint: {
					'circle-radius': 5,
					'circle-color': '#f59e0b',
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 1.5
				}
			});
		}
		syncOverlay();
	}

	function syncOverlay() {
		if (!map || !loaded) return;
		if (map.getLayer('gibs')) map.removeLayer('gibs');
		if (map.getSource('gibs')) map.removeSource('gibs');
		if (!overlay || !showOverlay) return;
		map.addSource('gibs', {
			type: 'raster',
			tiles: [
				`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${overlay.layer}/default/default/GoogleMapsCompatible_Level${overlay.level}/{z}/{y}/{x}.${overlay.extension}`
			],
			tileSize: 256,
			maxzoom: overlay.level,
			attribution: 'NASA GIBS / Worldview'
		});
		map.addLayer(
			{ id: 'gibs', type: 'raster', source: 'gibs', paint: { 'raster-opacity': 0.75 } },
			'regions-fill'
		);
	}

	function fitRegion(r: Region) {
		if (!map || r.domain === 'arctic') return;
		const [w, s, e, n] = r.bbox;
		const pad = r.id === 'bangladesh' ? 0.3 : Math.max(0.6, (e - w) * 0.6);
		map.fitBounds(
			[
				[w - pad, s - pad],
				[e + pad, n + pad]
			],
			{ duration: 600, maxZoom: 8 }
		);
	}

	onMount(async () => {
		try {
			const maplibregl = await import('maplibre-gl');
			await import('maplibre-gl/dist/maplibre-gl.css');
			const workerUrl = (await import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'))
				.default;
			maplibregl.setWorkerUrl(workerUrl);
			const bounds: [[number, number], [number, number]] = [
				[85.5, 19.5],
				[94.5, 28.5]
			];
			map = new maplibregl.Map({
				container,
				style: mode.current === 'dark' ? STYLE_DARK : STYLE_LIGHT,
				bounds,
				cooperativeGestures: true,
				attributionControl: { compact: true },
				dragRotate: false,
				pitchWithRotate: false,
				touchPitch: false
			});
			map.touchZoomRotate.disableRotation();
			map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
			map.on('load', () => {
				loaded = true;
				addLayers();
				fitRegion(region);
			});
			map.on('error', (e) => {
				// Tile errors from the overlay are expected for empty tiles; only a
				// failed style load leaves the map unusable.
				if (!loaded && /style/i.test(String(e.error?.message))) failed = true;
			});
			map.on('click', (e) => {
				const { lng, lat } = e.lngLat;
				if (pointMode) {
					onselect(pointRegionId(lat, lng));
					return;
				}
				const hits = REGIONS.filter((r) => r.domain !== 'arctic' && inRegion(r, lng, lat));
				const usable = hits.filter((r) => allowed.has(r.id));
				const pool = usable.length ? usable : hits;
				if (!pool.length) {
					onselect(pointRegionId(lat, lng));
					return;
				}
				const area = (r: Region) => (r.bbox[2] - r.bbox[0]) * (r.bbox[3] - r.bbox[1]);
				onselect(pool.sort((a, b) => area(a) - area(b))[0].id);
			});
		} catch (e) {
			console.error(e);
			failed = true;
		}
	});

	onDestroy(() => map?.remove());

	let lastRegion = '';
	$effect(() => {
		const data = regionsGeoJson(region.id, allowed);
		if (!loaded || !map) return;
		(map.getSource('regions') as GeoJSONSource | undefined)?.setData(data);
		if (region.id !== lastRegion) {
			lastRegion = region.id;
			fitRegion(region);
		}
	});
	$effect(() => {
		const data = sitesGeoJson(sites);
		if (!loaded || !map) return;
		(map.getSource('sites') as GeoJSONSource | undefined)?.setData(data);
	});
	$effect(() => {
		void overlay;
		void showOverlay;
		syncOverlay();
	});

	const outlineNote = BANGLADESH_OUTLINE.length > 0;
</script>

<div class="relative overflow-hidden rounded-lg border">
	<div
		bind:this={container}
		class="h-[260px] w-full sm:h-[340px]"
		aria-label="Map for choosing a region"
	></div>
	{#if failed}
		<div
			class="bg-muted text-muted-foreground absolute inset-0 grid place-items-center p-4 text-center text-sm"
		>
			The map could not load. You can still choose a region from the list.
		</div>
	{/if}
	<div class="absolute top-2 left-2 flex flex-wrap gap-1.5">
		<button
			type="button"
			class="bg-background/95 min-h-9 rounded-md border px-2.5 text-xs font-medium shadow-sm {pointMode
				? 'border-primary text-primary'
				: ''}"
			aria-pressed={pointMode}
			onclick={() => (pointMode = !pointMode)}
		>
			{pointMode ? 'Tap: exact point' : 'Tap: region'}
		</button>
		{#if overlay}
			<button
				type="button"
				class="bg-background/95 min-h-9 rounded-md border px-2.5 text-xs font-medium shadow-sm {showOverlay
					? 'border-primary text-primary'
					: ''}"
				aria-pressed={showOverlay}
				onclick={() => (showOverlay = !showOverlay)}
			>
				{showOverlay ? 'Hide' : 'Show'} satellite layer
			</button>
		{/if}
	</div>
</div>
<p class="text-muted-foreground mt-1.5 text-xs">
	{#if region.domain === 'arctic'}
		Arctic sea ice is analysed as one basin-wide total, so the map stays on Bangladesh.
	{:else if pointMode}
		Tap anywhere to analyse the grid cell at that point.
	{:else}
		Tap a box to pick a region, or switch to “exact point”.{outlineNote
			? ' Dashed boxes do not fit the chosen variable.'
			: ''}
	{/if}
	{#if overlay && showOverlay}
		Satellite layer: {overlay.title}, latest image from NASA GIBS (picture only, not used in the
		statistics).
	{/if}
	{#if sites.length}
		Orange dots: bundled sample sites.
	{/if}
</p>
