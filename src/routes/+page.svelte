<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';

	import { variableOptions } from '@openmeteo/weather-map-layer';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { mode, userPrefersMode } from 'mode-watcher';
	import { toast } from 'svelte-sonner';

	import { activeChart } from '$lib/stores/chart';
	import { gibsBrowse, initGibsState } from '$lib/stores/gibs';
	import { map } from '$lib/stores/map';
	import { initStoredState, loading, url } from '$lib/stores/preferences';
	import { initReplayState } from '$lib/stores/replay';
	import { installRequestCounter } from '$lib/stores/request-counter';
	import { modelRun } from '$lib/stores/time';
	import { domain, selectedDomain } from '$lib/stores/variables';

	import {
		ClippingButton,
		DarkModeButton,
		HelpButton,
		HillshadeButton,
		SettingsButton
	} from '$lib/components/buttons';
	import { HistoryButton } from '$lib/components/buttons/history-button';
	import ClippingPanel from '$lib/components/clipping/clipping-panel.svelte';
	import Dropzone from '$lib/components/dropzone/dropzone.svelte';
	import HelpDialog from '$lib/components/help/help-dialog.svelte';
	import HistoricalPanel from '$lib/components/history/historical-panel.svelte';
	import KeyboardHandler from '$lib/components/keyboard/keyboard-handler.svelte';
	import Spinner from '$lib/components/loading/spinner.svelte';
	import Scale from '$lib/components/scale/scale.svelte';
	import SelectionPanel from '$lib/components/selection/selection-panel.svelte';
	import Settings from '$lib/components/settings/settings.svelte';
	import TimeSelector from '$lib/components/time/time-selector.svelte';

	import { unwatchAttributionOverlap, watchAttributionOverlap } from '$lib/attribution';
	import { getChartPreset } from '$lib/chart-presets';
	import { postEmbedderReady, startEmbedderBridge, stopEmbedderBridge } from '$lib/embed';
	import { destroyGibsLayers, initGibsLayers } from '$lib/gibs-layers';
	import { addOmFileLayers, changeOMfileURL, setWeatherLayersSuppressed } from '$lib/layers';
	import { createMap, getAppliedStyleMode, reloadStyles } from '$lib/map-controls';
	import { loadDomainMetaData } from '$lib/metadata';
	import { addPopup } from '$lib/popup';
	import { syncChartToUrl, updateUrl, urlParamsToPreferences } from '$lib/url';

	import '../styles.css';

	import type { ChartState } from '$lib/chart-types';

	let clippingPanel: ReturnType<typeof ClippingPanel>;

	let mapContainer: HTMLElement | null;

	const darkModeButton = new DarkModeButton();

	// Before any data access: every request to the data API counts against the
	// daily limit, and the wrapper also reroutes them once it is exhausted.
	installRequestCounter();

	// The timeline browses the satellite archive for days the forecast files do
	// not exist for; while it does, the forecast frames are hidden rather than
	// left on screen under the wrong date.
	const gibsBrowseSubscription = gibsBrowse.subscribe(setWeatherLayersSuppressed);

	// The single place that keeps the basemap in sync with the RESOLVED theme:
	// covers the button cycle, an OS light/dark switch while the theme is
	// 'system', and an embedder propagating its colour scheme into ours. The
	// style only reloads when the resolved mode actually drifts from what the
	// map has applied, so redundant transitions (e.g. picking 'system' on a
	// dark OS while already dark) reload nothing.
	$effect(() => {
		const resolved = mode.current === 'dark' ? 'dark' : 'light';
		void userPrefersMode.current; // icon shows the preference, not the resolved mode
		if (!$map) return;
		darkModeButton.refresh();
		if (resolved !== getAppliedStyleMode()) {
			reloadStyles();
		}
	});

	onMount(async () => {
		$url = new URL(document.location.href);
		urlParamsToPreferences();
		await initStoredState();

		initGibsState();
		initReplayState();
		await createMap(mapContainer as HTMLElement);
		startEmbedderBridge();

		$map.on('load', async () => {
			$map.addControl(darkModeButton);
			$map.addControl(new SettingsButton());
			$map.addControl(new HistoryButton());
			$map.addControl(new HelpButton());
			$map.addControl(new ClippingButton());

			if (getInitialMetaDataPromise) await getInitialMetaDataPromise;
			// Initial URL-driven setup is finished; from now on domain changes are
			// user-initiated and should reset the selected model run.
			initialLoadComplete = true;

			// Terrain DEM sources are registered only when the hillshade/terrain
			// controls are enabled, avoiding unused terrain-source work on startup.
			$map.addControl(new HillshadeButton());
			clippingPanel?.initTerraDraw();

			addOmFileLayers();
			// Satellite history comes from a different provider (NASA GIBS) and
			// lives below the forecast rasters; it survives style reloads on its own.
			initGibsLayers();
			addPopup();
			changeOMfileURL();

			watchAttributionOverlap();
			postEmbedderReady();
		});
	});

	let getInitialMetaDataPromise: Promise<void> | undefined;
	// Guards the domain subscription so the very first domain change (driven by the
	// URL on page load) does not discard a model_run/time that was just parsed from
	// the URL. Only genuine, user-initiated domain switches should reset the run.
	let initialLoadComplete = false;
	const domainSubscription = domain.subscribe(async (newDomain) => {
		if ($domain !== newDomain) {
			await tick(); // await the selectedDomain to be set
			updateUrl('domain', newDomain);
			if (initialLoadComplete) {
				$modelRun = undefined;
				toast('Domain set to: ' + $selectedDomain.label);
			}
		}

		getInitialMetaDataPromise = loadDomainMetaData(newDomain);
		await getInitialMetaDataPromise;
		changeOMfileURL();
	});

	const chartToastMessage = (chart: ChartState): string => {
		if (chart.presetId) {
			return 'Chart set to: ' + (getChartPreset(chart.presetId)?.label ?? chart.presetId);
		}
		if (chart.name) return 'Chart set to: ' + chart.name;
		if (chart.sources.length === 1) {
			const variable = chart.sources[0].variable;
			const label = variableOptions.find(({ value }) => value === variable)?.label ?? variable;
			return 'Variable set to: ' + label;
		}
		return 'Custom chart applied';
	};

	// Serialized sources of the last seen chart. Undefined only before the
	// subscription's initial synchronous call, which must not toast or touch
	// the URL (urlParamsToPreferences just parsed it).
	let lastChartSources: string | undefined;
	const chartSubscription = activeChart.subscribe(async (chart) => {
		const serialized = JSON.stringify(chart.sources);
		const changed = lastChartSources !== undefined && serialized !== lastChartSources;
		lastChartSources = serialized;

		if (changed) {
			await tick();
			syncChartToUrl(chart);
			toast(chartToastMessage(chart));
		}

		changeOMfileURL();
	});

	onDestroy(() => {
		gibsBrowseSubscription();
		destroyGibsLayers();
		stopEmbedderBridge();
		unwatchAttributionOverlap();
		if ($map) {
			$map.remove();
		}
		domainSubscription(); // unsubscribe
		chartSubscription(); // unsubscribe
	});
</script>

<svelte:head>
	<title>Open-Meteo Maps</title>
</svelte:head>

{#if $loading}
	<Spinner />
{/if}

<div class="map maplibregl-map" id="#map_container" bind:this={mapContainer}></div>

<Scale />
<SelectionPanel />
<ClippingPanel bind:this={clippingPanel} />
<HistoricalPanel />
<TimeSelector />
<Settings />
<HelpDialog />
<KeyboardHandler />
<Dropzone
	ondrop={(features) => {
		clippingPanel?.addImportedFeatures(features);
	}}
/>
