<script lang="ts">
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { fly } from 'svelte/transition';

	import {
		CalendarRange,
		ChartArea,
		ChartColumn,
		ChartLine,
		Crosshair,
		Download,
		GitCompareArrows,
		LayoutDashboard,
		Map as MapIcon,
		MapPin,
		Maximize2,
		Minimize2,
		MousePointer2,
		X
	} from '@lucide/svelte';
	import * as d3 from 'd3';

	import {
		analysisState,
		closeAnalysis,
		comparePairFor,
		loadAnalysis,
		loadCompare,
		loadSpatial,
		selectedCatalogEntry,
		setBaseline,
		setLocation,
		setOmModel,
		setOmVariable,
		setPeriod,
		setPowerCommunity,
		setPowerParameter,
		setPowerTemporal,
		setSource,
		spatialKey,
		toggleExpanded,
		yearBounds
	} from '$lib/stores/analysis';
	import {
		ARCHIVE_MODELS,
		ARCHIVE_VARIABLES,
		type ArchiveModel,
		modelSupportsPressureLevels
	} from '$lib/stores/archive';
	import { map } from '$lib/stores/map';

	import AnnualChart from '$lib/components/analysis/annual-chart.svelte';
	import AnomalyChart from '$lib/components/analysis/anomaly-chart.svelte';
	import ChartCard from '$lib/components/analysis/chart-card.svelte';
	import {
		COLORS,
		divergingInterpolator,
		downloadCsv,
		fmt,
		pValueText,
		sequentialInterpolator,
		signed,
		symmetricDiverging
	} from '$lib/components/analysis/d3-utils';
	import DistributionChart from '$lib/components/analysis/distribution-chart.svelte';
	import HeatmapChart from '$lib/components/analysis/heatmap-chart.svelte';
	import ParameterPicker from '$lib/components/analysis/parameter-picker.svelte';
	import ScatterChart from '$lib/components/analysis/scatter-chart.svelte';
	import SeasonalChart from '$lib/components/analysis/seasonal-chart.svelte';
	import SeriesChart from '$lib/components/analysis/series-chart.svelte';
	import SpatialChart from '$lib/components/analysis/spatial-chart.svelte';
	import StatTile from '$lib/components/analysis/stat-tile.svelte';
	import StripesStrip from '$lib/components/analysis/stripes-strip.svelte';

	import { type AnalysisGridOverlay, syncAnalysisGridLayer } from '$lib/analysis/analysis-map';
	import {
		aggregateAnnual,
		aggregateMonthly,
		aggregateUnits,
		annualAnomalies,
		annualTrend,
		compareSources,
		distributionSplit,
		exceedanceCounts,
		meanOf,
		monthMatrix,
		monthlyClimatology,
		pettitt,
		sampleSummary,
		senTrend,
		sliceYears,
		stdOf
	} from '$lib/analysis/analysis-stats';
	import { POWER_QUICK_PICKS, powerParameterNotes } from '$lib/analysis/sources';
	import {
		type SpatialMetric,
		cellStatistics,
		metricValue,
		shareWithChangePoint
	} from '$lib/analysis/spatial';

	import type { PowerCommunity } from '$lib/nasa-power';
	import type * as maplibregl from 'maplibre-gl';

	type Tab = 'overview' | 'series' | 'seasonal' | 'anomaly' | 'extremes' | 'compare' | 'spatial';

	let tab: Tab = $state('overview');
	let smoothing = $state(30);
	let heatmapMode: 'anomaly' | 'value' = $state('anomaly');
	let highlightYear: number | undefined = $state();
	let spatialMetric: SpatialMetric = $state('sen');
	let showOnMap = $state(false);

	const panel = $derived($analysisState);
	const bounds = $derived(yearBounds(panel));
	const catalogEntry = $derived(selectedCatalogEntry(panel));
	const series = $derived(panel.series);
	const kind = $derived(series?.aggregate ?? 'mean');
	const units = $derived(aggregateUnits(series?.unit, kind));
	const pair = $derived(comparePairFor(panel));

	const COMMUNITIES: { value: PowerCommunity; label: string }[] = [
		{ value: 'AG', label: 'AG · Agro' },
		{ value: 'RE', label: 'RE · Energy' },
		{ value: 'SB', label: 'SB · Building' }
	];

	// Shared control styles (one place, consistent look).
	const SECTION =
		'flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-wide opacity-75';
	const STEP =
		'grid size-3.5 place-items-center rounded-full bg-sky-600 text-[0.5rem] font-bold text-white';
	const INPUT =
		'w-full rounded-md border border-black/15 bg-white px-1.5 py-1 text-xs shadow-sm dark:border-white/15 dark:bg-neutral-900';
	const BUTTON =
		'flex items-center justify-center gap-1 rounded-md border border-black/15 bg-white px-2 py-1 text-[0.68rem] shadow-sm hover:border-sky-500/60 hover:bg-sky-50 dark:border-white/15 dark:bg-neutral-900 dark:hover:bg-neutral-800';

	const BADGE = 'rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10';

	const BASELINES = [
		{ label: '1991–2020 (WMO normal)', start: 1991, end: 2020 },
		{ label: '1981–2010', start: 1981, end: 2010 },
		{ label: '2001–2020 (POWER default)', start: 2001, end: 2020 },
		{ label: '1961–1990', start: 1961, end: 1990 }
	];

	const periodPresets = $derived.by(() => {
		const list = [{ label: 'Full record', start: bounds.min, end: bounds.max }];
		if (bounds.max - bounds.min >= 35)
			list.push({ label: 'Last 30 yrs', start: bounds.max - 29, end: bounds.max });
		if (bounds.min <= 1991 && bounds.max >= 2020)
			list.push({ label: '1991–2020', start: 1991, end: 2020 });
		if (bounds.min <= 2001) list.push({ label: '2001–now', start: 2001, end: bounds.max });
		return list;
	});

	const tabs = $derived.by(() => {
		const list: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
			{ key: 'overview', label: 'Overview', icon: LayoutDashboard },
			{ key: 'series', label: 'Series', icon: ChartLine },
			{ key: 'seasonal', label: 'Seasonal', icon: CalendarRange },
			{ key: 'anomaly', label: 'Anomaly', icon: ChartColumn },
			{ key: 'extremes', label: 'Distribution', icon: ChartArea },
			{ key: 'compare', label: 'Compare', icon: GitCompareArrows }
		];
		if (panel.source === 'nasa-power')
			list.push({ key: 'spatial', label: 'Spatial', icon: MapIcon });
		return list;
	});

	/** WAI-ARIA tabs: Left/Right/Home/End move between tabs (automatic activation). */
	function onTabKey(e: KeyboardEvent) {
		const i = tabs.findIndex((t) => t.key === tab);
		let next = i;
		if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = tabs.length - 1;
		else return;
		e.preventDefault();
		tab = tabs[next].key;
		const nav = (e.currentTarget as HTMLElement).closest('[role=tablist]');
		nav?.querySelector<HTMLElement>(`#tab-${tab}`)?.focus();
	}

	$effect(() => {
		if (tab === 'spatial' && panel.source !== 'nasa-power') tab = 'overview';
	});

	const quickPicks = $derived(
		POWER_QUICK_PICKS.filter((code) => panel.catalog.some((c) => c.code === code))
	);

	const omVariables = $derived(
		ARCHIVE_VARIABLES.filter(
			(v) => v.group !== 'pressure-level' || modelSupportsPressureLevels(panel.omModel)
		)
	);
	const omVariable = $derived(ARCHIVE_VARIABLES.find((v) => v.name === panel.omVariable));

	// --- Core statistics (lazy: computed only when a tab reads them) ----------
	const months = $derived(series ? aggregateMonthly(series.points, series.resolution, kind) : []);
	const annualAll = $derived(aggregateAnnual(months, kind));
	const annualPeriod = $derived(
		annualAll.filter((a) => a.year >= panel.startYear && a.year <= panel.endYear)
	);
	const completeAnnual = $derived(annualPeriod.filter((a) => a.complete));
	const incompleteAnnual = $derived(annualPeriod.filter((a) => !a.complete));
	const years = $derived(completeAnnual.map((a) => a.year));
	const values = $derived(completeAnnual.map((a) => a.value));
	const isCircular = $derived(kind === 'circular');

	const trend = $derived(isCircular ? undefined : annualTrend(years, values));
	const sen = $derived(isCircular ? undefined : senTrend(years, values));
	const changePoint = $derived.by(() => {
		if (isCircular) return undefined;
		const result = pettitt(values);
		if (!result || result.index + 1 >= years.length) return undefined;
		return { ...result, year: years[result.index + 1] };
	});
	const summary = $derived.by(() => {
		if (values.length < 3) return undefined;
		const third = Math.max(1, Math.floor(values.length / 3));
		return {
			mean: meanOf(values),
			sd: stdOf(values),
			firstThird: meanOf(values.slice(0, third)),
			lastThird: meanOf(values.slice(-third)),
			firstLabel: `${years[0]}–${years[third - 1]}`,
			lastLabel: `${years[years.length - third]}–${years[years.length - 1]}`
		};
	});

	const periodPoints = $derived(
		series ? sliceYears(series.points, panel.startYear, panel.endYear) : []
	);
	const samples = $derived(sampleSummary(periodPoints));

	const climatology = $derived(
		monthlyClimatology(months, panel.baselineStart, panel.baselineEnd, kind)
	);
	const climatologyUsesBaseline = $derived(climatology.every((c) => c.n >= 10));
	const effectiveClimatology = $derived(
		climatologyUsesBaseline
			? climatology
			: monthlyClimatology(months, panel.startYear, panel.endYear, kind)
	);
	const climatologyLabel = $derived(
		climatologyUsesBaseline
			? `${panel.baselineStart}–${panel.baselineEnd}`
			: `${panel.startYear}–${panel.endYear}`
	);
	const matrix = $derived(
		monthMatrix(months, effectiveClimatology, panel.startYear, panel.endYear, kind)
	);
	const anomalies = $derived(
		annualAnomalies(
			annualAll,
			panel.baselineStart,
			panel.baselineEnd,
			kind,
			panel.startYear,
			panel.endYear
		)
	);
	const highlight = $derived.by(() => {
		const year = highlightYear ?? years[years.length - 1];
		if (year === undefined) return undefined;
		const vals: (number | undefined)[] = new Array(12).fill(undefined);
		for (const m of months) if (m.year === year && m.complete) vals[m.month] = m.value;
		return { year, values: vals };
	});

	const exceedance = $derived(
		series
			? exceedanceCounts(
					series.points,
					series.resolution,
					kind,
					panel.baselineStart,
					panel.baselineEnd,
					new Set(years)
				)
			: undefined
	);
	const exceedanceSen = $derived(
		exceedance ? senTrend(exceedance.years, exceedance.high) : undefined
	);
	const exceedanceLowSen = $derived(
		exceedance?.low ? senTrend(exceedance.years, exceedance.low) : undefined
	);
	const distribution = $derived(distributionSplit(periodPoints, years, kind));

	// --- Headline KPIs ("summary first, detail later") --------------------------
	const stripeInterpolator = $derived(divergingInterpolator(series?.code ?? '', kind));
	const latest = $derived.by(() => {
		if (!years.length) return undefined;
		const year = years[years.length - 1];
		const value = values[values.length - 1];
		// Rank 1 = highest value, as in NOAA Climate at a Glance rankings.
		const rank = 1 + values.filter((v) => v > value).length;
		const idx = anomalies?.years.indexOf(year) ?? -1;
		return {
			year,
			value,
			rank,
			of: values.length,
			anomaly: idx >= 0 ? anomalies?.anomalies[idx] : undefined
		};
	});
	const trendSignificant = $derived(
		sen !== undefined && sen.pValue < 0.05 && (trend?.pValueAdjusted ?? 1) < 0.05
	);
	const trendDirection = $derived(
		!sen || !trendSignificant
			? 'flat'
			: sen.senSlopePerDecade > 0
				? 'up'
				: sen.senSlopePerDecade < 0
					? 'down'
					: 'flat'
	) as 'up' | 'down' | 'flat';
	const hasStep = $derived(changePoint !== undefined && changePoint.pValue < 0.05);
	const sparkTrend = $derived(
		sen && years.length
			? ([
					sen.intercept + sen.senSlopePerYear * years[0],
					sen.intercept + sen.senSlopePerYear * years[years.length - 1]
				] as [number, number])
			: undefined
	);
	const ordinal = (n: number) => {
		const v = n % 100;
		if (v >= 11 && v <= 13) return `${n}th`;
		return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
	};
	const rankWords = $derived(
		kind === 'rate'
			? ['wettest', 'driest']
			: /^T|temp/i.test(series?.code ?? '')
				? ['warmest', 'coolest']
				: ['highest', 'lowest']
	);

	/** One-sentence plain-language finding, used as the Overview headline. */
	const insight = $derived.by(() => {
		if (!series || !sen || !trend || years.length < 10) return undefined;
		const per = `${signed(sen.senSlopePerDecade)} ${units.annual}/decade`;
		const span = `${years[0]}–${years[years.length - 1]}`;
		const verb = sen.senSlopePerDecade > 0 ? 'increased' : 'decreased';
		const lead = trendSignificant
			? `${series.label} has ${verb} by ${per} over ${span}`
			: `No significant trend in ${series.label} over ${span} (${per})`;
		const sig = trendSignificant
			? ` (Mann-Kendall ${pLabel(sen.pValue)}, autocorrelation-adjusted ${pLabel(trend.pValueAdjusted)})`
			: '';
		const step = hasStep
			? ` A step change in ${changePoint!.year} (${signed(changePoint!.shift)} ${units.annual}) suggests part of this may be a data artefact; verify in Compare.`
			: '';
		return { lead, sig, step };
	});

	// --- Compare ----------------------------------------------------------------
	const compareSeries = $derived(
		panel.compare.forId === series?.id ? panel.compare.series : undefined
	);
	const comparison = $derived.by(() => {
		if (!series || !compareSeries) return undefined;
		const secondaryMonths = aggregateMonthly(compareSeries.points, 'daily', kind);
		return compareSources(
			months,
			secondaryMonths,
			kind,
			panel.startYear,
			panel.endYear,
			series.resolution === 'daily' ? series.points : undefined,
			compareSeries.points
		);
	});
	const comparisonChange = $derived.by(() => {
		const cp = comparison?.differencePettitt;
		if (!comparison || !cp || cp.index + 1 >= comparison.years.length) return undefined;
		return { ...cp, year: comparison.years[cp.index + 1] };
	});

	$effect(() => {
		if (
			tab === 'compare' &&
			series &&
			pair &&
			panel.compare.forId !== series.id &&
			panel.compare.status !== 'loading'
		) {
			void loadCompare();
		}
	});

	// --- Spatial ----------------------------------------------------------------
	const currentSpatialKey = $derived(spatialKey(panel));
	const spatialGrid = $derived(
		panel.spatial.forKey === currentSpatialKey ? panel.spatial.grid : undefined
	);
	const spatialCells = $derived(
		spatialGrid ? cellStatistics(spatialGrid, kind, panel.startYear, panel.endYear) : []
	);
	const spatialChangeShare = $derived(shareWithChangePoint(spatialCells));
	const spatialSummary = $derived.by(() => {
		const sens = spatialCells.map((c) => c.senPerDecade).filter(Number.isFinite);
		if (!sens.length) return undefined;
		const yearCounts: Record<number, number> = {};
		for (const c of spatialCells)
			if (c.changeYear !== undefined && (c.changePValue ?? 1) < 0.05)
				yearCounts[c.changeYear] = (yearCounts[c.changeYear] ?? 0) + 1;
		const mode = Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0];
		return {
			upSig: spatialCells.filter((c) => c.mkPValue < 0.05 && c.senPerDecade > 0).length,
			downSig: spatialCells.filter((c) => c.mkPValue < 0.05 && c.senPerDecade < 0).length,
			medianSen: d3.median(sens) ?? NaN,
			minSen: d3.min(sens) ?? NaN,
			maxSen: d3.max(sens) ?? NaN,
			modeYear: mode ? Number(mode[0]) : undefined,
			modeCount: mode ? mode[1] : 0
		};
	});

	const mapOverlay = $derived.by((): AnalysisGridOverlay | undefined => {
		if (!showOnMap || !spatialGrid || !spatialCells.length || !panel.open) return undefined;
		const vals = spatialCells.map((c) => metricValue(c, spatialMetric));
		let color: (v: number) => string;
		if (spatialMetric === 'sen' || spatialMetric === 'shift') {
			const s = symmetricDiverging(vals, divergingInterpolator(series?.code ?? '', kind));
			color = (v) => s(v);
		} else {
			const ext = d3.extent(vals.filter(Number.isFinite)) as [number, number];
			const s = d3
				.scaleSequential(
					spatialMetric === 'changeYear'
						? d3.interpolateViridis
						: sequentialInterpolator(series?.code ?? '', kind)
				)
				.domain(ext);
			color = (v) => s(v);
		}
		return {
			latStep: spatialGrid.latStep,
			lonStep: spatialGrid.lonStep,
			cells: spatialCells
				.filter((_, i) => Number.isFinite(vals[i]))
				.map((c) => {
					const v = metricValue(c, spatialMetric);
					return {
						latitude: c.latitude,
						longitude: c.longitude,
						value: v,
						color: color(v),
						label: fmt(v)
					};
				})
		};
	});

	let currentMap: maplibregl.Map | undefined;
	let latestOverlay: AnalysisGridOverlay | undefined;
	const styleListener = () => syncAnalysisGridLayer(currentMap, latestOverlay);
	const unsubscribeMap = map.subscribe((value) => {
		currentMap?.off('styledata', styleListener);
		currentMap = value;
		currentMap?.on('styledata', styleListener);
		syncAnalysisGridLayer(currentMap, latestOverlay);
	});
	$effect(() => {
		latestOverlay = mapOverlay;
		syncAnalysisGridLayer(currentMap, mapOverlay);
	});

	// --- Map picking --------------------------------------------------------
	let pickHandler: ((e: maplibregl.MapMouseEvent) => void) | undefined;
	function cancelPick() {
		if (currentMap && pickHandler) {
			currentMap.off('click', pickHandler);
			currentMap.getCanvas().style.cursor = '';
		}
		pickHandler = undefined;
		analysisState.update((s) => ({ ...s, picking: false }));
	}
	function startPick() {
		if (!currentMap) return;
		cancelPick();
		currentMap.getCanvas().style.cursor = 'crosshair';
		pickHandler = (e) => {
			cancelPick();
			setLocation(e.lngLat.lat, e.lngLat.lng);
		};
		currentMap.once('click', pickHandler);
		analysisState.update((s) => ({ ...s, picking: true }));
	}
	function analyseMapCentre() {
		const centre = get(map)?.getCenter();
		if (centre) setLocation(centre.lat, centre.lng);
	}
	$effect(() => {
		if (!panel.open && pickHandler) cancelPick();
	});

	onDestroy(() => {
		cancelPick();
		unsubscribeMap();
		currentMap?.off('styledata', styleListener);
		syncAnalysisGridLayer(currentMap, undefined);
	});

	// --- Helpers ----------------------------------------------------------------
	function formatCoordinate(value: number, axis: 'latitude' | 'longitude'): string {
		const hemisphere = axis === 'latitude' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
		return `${Math.abs(value).toFixed(3)}°${hemisphere}`;
	}

	const smoothingOptions = $derived(
		series?.resolution === 'monthly'
			? [
					{ value: 1, label: 'Raw' },
					{ value: 12, label: '12-month mean' }
				]
			: series?.resolution === 'hourly'
				? [
						{ value: 1, label: 'Raw' },
						{ value: 24 * 30, label: '30-day mean' },
						{ value: 24 * 365, label: '365-day mean' }
					]
				: [
						{ value: 1, label: 'Raw' },
						{ value: 30, label: '30-day mean' },
						{ value: 365, label: '365-day mean' }
					]
	);
	$effect(() => {
		if (!smoothingOptions.some((o) => o.value === smoothing))
			smoothing = smoothingOptions[1]?.value ?? 1;
	});

	const caveats = $derived.by(() => {
		if (!series) return [] as string[];
		const list = [...series.notes];
		if (series.source === 'nasa-power') {
			list.push(
				...powerParameterNotes(
					series.code,
					catalogEntry?.type,
					panel.startYear,
					panel.endYear,
					series.latitude,
					series.longitude
				)
			);
		}
		return [...new Set(list)];
	});

	const fileBase = $derived(
		series
			? `${series.source}-${series.code}-${series.latitude.toFixed(2)}_${series.longitude.toFixed(2)}-${panel.startYear}-${panel.endYear}`
			: 'analysis'
	);

	function exportAnnualCsv() {
		if (!series) return;
		const anomalyByYear = new Map(
			anomalies?.years.map((y, i) => [y, anomalies.anomalies[i]]) ?? []
		);
		const rows: (string | number)[][] = [
			['# source', series.sourceLabel],
			['# parameter', `${series.code} (${series.label})`],
			['# location', `${series.latitude}, ${series.longitude}`],
			['# aggregation', kind],
			[
				'year',
				`value (${units.annual})`,
				'months_complete',
				'complete',
				`anomaly vs ${anomalies?.baselineLabel ?? ''}`
			]
		];
		for (const a of annualPeriod) {
			rows.push([
				a.year,
				a.value.toFixed(4),
				Math.round(a.coverage * 12),
				a.complete ? 'yes' : 'no',
				anomalyByYear.get(a.year)?.toFixed(4) ?? ''
			]);
		}
		downloadCsv(rows, `${fileBase}-annual.csv`);
	}

	function exportMonthlyCsv() {
		if (!series) return;
		const rows: (string | number)[][] = [['year', 'month', `value (${units.monthly})`, 'coverage']];
		for (const m of months) {
			if (m.year < panel.startYear || m.year > panel.endYear) continue;
			rows.push([m.year, m.month + 1, m.value.toFixed(4), m.coverage.toFixed(3)]);
		}
		downloadCsv(rows, `${fileBase}-monthly.csv`);
	}

	const pLabel = (p: number) => {
		const text = pValueText(p);
		return text.startsWith('<') ? `p ${text}` : `p = ${text}`;
	};

	const significance = (p: number | undefined) =>
		p !== undefined && Number.isFinite(p) && p < 0.05 ? 'significant' : 'not significant';
</script>

{#if panel.open}
	<aside
		transition:fly={{ y: 12, duration: 200 }}
		class="absolute right-2 z-50 flex flex-col overflow-hidden rounded-xl border border-black/10 bg-glass/95 tabular-nums dark:border-white/10 shadow-lg backdrop-blur-md {panel.expanded
			? 'max-h-[86dvh] w-[min(97vw,64rem)]'
			: 'max-h-[74dvh] w-[min(94vw,28rem)]'}"
		style:bottom="max(7.5rem, calc(var(--om-credit-bottom) + var(--om-credit-height) + 0.5rem))"
		aria-label="Historical analysis"
	>
		<!-- Header -->
		<header class="flex items-center justify-between gap-2 border-b px-3 py-2">
			<div class="min-w-0">
				<h2 class="flex items-center gap-1.5 text-sm font-semibold">
					Historical analysis
					<span
						class="rounded bg-sky-500/15 px-1.5 py-0.5 text-[0.6rem] font-medium text-sky-700 dark:text-sky-300"
					>
						{panel.source === 'nasa-power' ? 'NASA POWER' : 'Open-Meteo'}
					</span>
				</h2>
				{#if series}
					<p class="truncate text-[0.68rem] opacity-70">
						{formatCoordinate(series.latitude, 'latitude')}, {formatCoordinate(
							series.longitude,
							'longitude'
						)}
						{#if series.elevation !== undefined}· {Math.round(series.elevation)} m{/if}
						· {series.sourceLabel}
					</p>
				{:else if panel.latitude !== undefined && panel.longitude !== undefined}
					<p class="truncate text-[0.68rem] opacity-70">
						{formatCoordinate(panel.latitude, 'latitude')}, {formatCoordinate(
							panel.longitude,
							'longitude'
						)}
					</p>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-0.5">
				<button
					onclick={toggleExpanded}
					class="rounded p-1 hover:bg-black/10 dark:hover:bg-white/15"
					title={panel.expanded ? 'Compact panel' : 'Expand panel'}
					aria-label={panel.expanded ? 'Compact panel' : 'Expand panel'}
				>
					{#if panel.expanded}<Minimize2 size={15} />{:else}<Maximize2 size={15} />{/if}
				</button>
				<button
					onclick={closeAnalysis}
					class="rounded p-1 hover:bg-black/10 dark:hover:bg-white/15"
					aria-label="Close historical analysis"
				>
					<X size={16} />
				</button>
			</div>
		</header>

		{#if panel.picking}
			<div
				class="flex items-center justify-between gap-2 border-b bg-sky-500/10 px-3 py-1.5 text-xs"
				role="status"
			>
				<span class="flex items-center gap-1.5"
					><MousePointer2 size={14} /> Click the map to choose a location.</span
				>
				<button class="rounded px-2 py-0.5 underline" onclick={cancelPick}>Cancel</button>
			</div>
		{/if}

		<div
			class="min-h-0 flex-1 {panel.expanded
				? 'md:grid md:grid-cols-[15.5rem_minmax(0,1fr)]'
				: ''} overflow-y-auto md:overflow-hidden"
		>
			<!-- Controls -->
			<div
				class="space-y-3 border-b px-3 py-2.5 md:overflow-y-auto {panel.expanded
					? 'md:border-b-0 md:border-r'
					: ''}"
			>
				<section class="space-y-1.5" aria-labelledby="ha-source">
					<h3 id="ha-source" class={SECTION}>
						<span class={STEP}>1</span> Data source
					</h3>
					<div
						class="grid grid-cols-2 gap-1 rounded-md bg-black/5 p-0.5 text-[0.72rem] dark:bg-white/10"
						role="radiogroup"
						aria-label="Data source"
					>
						{#each [{ v: 'nasa-power', l: 'NASA POWER', d: 'MERRA-2 · CERES · IMERG' }, { v: 'open-meteo', l: 'Open-Meteo', d: 'ERA5 family' }] as option (option.v)}
							<button
								role="radio"
								aria-checked={panel.source === option.v}
								class="rounded px-2 py-1 leading-tight {panel.source === option.v
									? 'bg-white font-semibold shadow-sm dark:bg-neutral-700'
									: 'opacity-70 hover:opacity-100'}"
								onclick={() => setSource(option.v as 'nasa-power' | 'open-meteo')}
							>
								{option.l}
								<span class="block text-[0.56rem] font-normal opacity-60">{option.d}</span>
							</button>
						{/each}
					</div>
					{#if panel.source === 'nasa-power'}
						<div class="grid grid-cols-[1fr_auto] gap-1.5">
							<select
								class={INPUT}
								value={panel.powerCommunity}
								onchange={(e) => setPowerCommunity(e.currentTarget.value as PowerCommunity)}
								aria-label="POWER community (sets radiation units)"
								title="Community sets radiation units: AG = MJ/m²/day, RE = kWh/m²/day"
							>
								{#each COMMUNITIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
							</select>
							<div
								class="grid grid-cols-2 gap-0.5 rounded-md bg-black/5 p-0.5 text-[0.66rem] dark:bg-white/10"
								role="radiogroup"
								aria-label="Temporal resolution"
							>
								{#each ['daily', 'monthly'] as t (t)}
									<button
										role="radio"
										aria-checked={panel.powerTemporal === t}
										class="rounded px-1.5 capitalize {panel.powerTemporal === t
											? 'bg-white font-semibold shadow-sm dark:bg-neutral-700'
											: 'opacity-70 hover:opacity-100'}"
										onclick={() => setPowerTemporal(t as 'daily' | 'monthly')}
									>
										{t}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</section>

				<section class="space-y-1.5" aria-labelledby="ha-param">
					<h3 id="ha-param" class={SECTION}>
						<span class={STEP}>2</span>
						{panel.source === 'nasa-power' ? 'Parameter' : 'Variable'}
						{#if panel.source === 'nasa-power' && panel.catalogStatus === 'ready'}
							<span class="ml-auto font-normal normal-case tracking-normal opacity-60"
								>{panel.catalog.length} available</span
							>
						{/if}
					</h3>
					{#if panel.source === 'nasa-power'}
						{#if panel.catalogStatus === 'loading'}
							<div class="h-11 animate-pulse rounded-md bg-black/10 dark:bg-white/10"></div>
							<p class="text-[0.64rem] opacity-60">Loading live POWER catalog…</p>
						{:else if panel.catalogStatus === 'error'}
							<p class="text-[0.68rem] text-red-600">{panel.catalogError}</p>
						{:else}
							<ParameterPicker
								catalog={panel.catalog}
								value={panel.powerParameter}
								onselect={setPowerParameter}
								listHeight={panel.expanded ? 300 : 220}
							/>
							{#if quickPicks.length}
								<div class="flex flex-wrap gap-1" aria-label="Quick picks">
									{#each quickPicks as code (code)}
										<button
											class="rounded-full border px-1.5 py-px font-mono text-[0.58rem] {panel.powerParameter ===
											code
												? 'border-sky-600 bg-sky-600 text-white'
												: 'border-black/15 opacity-75 hover:opacity-100 dark:border-white/20'}"
											aria-pressed={panel.powerParameter === code}
											onclick={() => setPowerParameter(code)}>{code}</button
										>
									{/each}
								</div>
							{/if}
						{/if}
						{#if catalogEntry}
							<p class="text-[0.64rem] leading-snug opacity-70">{catalogEntry.definition}</p>
						{/if}
					{:else}
						<select
							class={INPUT}
							value={panel.omVariable}
							onchange={(e) => setOmVariable(e.currentTarget.value)}
							aria-label="Variable"
						>
							{#each omVariables as v (v.name)}<option value={v.name}>{v.label}</option>{/each}
						</select>
						{#if omVariable?.endpoint === 'archive'}
							<select
								class={INPUT}
								value={panel.omModel}
								onchange={(e) => setOmModel(e.currentTarget.value as ArchiveModel)}
								aria-label="Reanalysis model"
							>
								{#each ARCHIVE_MODELS as m (m.value)}
									<option value={m.value}
										>{m.label} · from {m.firstAvailableDate ?? m.startYear}</option
									>
								{/each}
							</select>
						{/if}
					{/if}
				</section>

				<section class="space-y-1.5" aria-labelledby="ha-period">
					<h3 id="ha-period" class={SECTION}>
						<span class={STEP}>3</span> Period & baseline
						<span class="ml-auto font-normal normal-case tracking-normal opacity-60"
							>data {bounds.min}–{bounds.max}</span
						>
					</h3>
					<div class="flex items-center gap-1.5">
						<input
							type="number"
							min={bounds.min}
							max={bounds.max}
							class="{INPUT} text-center"
							value={panel.startYear}
							aria-label="Start year"
							onchange={(e) => setPeriod(Number(e.currentTarget.value), panel.endYear)}
						/>
						<span class="text-xs opacity-50">–</span>
						<input
							type="number"
							min={bounds.min}
							max={bounds.max}
							class="{INPUT} text-center"
							value={panel.endYear}
							aria-label="End year"
							onchange={(e) => setPeriod(panel.startYear, Number(e.currentTarget.value))}
						/>
					</div>
					<div class="flex flex-wrap gap-1">
						{#each periodPresets as preset (preset.label)}
							<button
								class="rounded-full border px-1.5 py-px text-[0.6rem] {panel.startYear ===
									preset.start && panel.endYear === preset.end
									? 'border-sky-600 bg-sky-600/10 font-semibold text-sky-800 dark:text-sky-300'
									: 'border-black/15 opacity-75 hover:opacity-100 dark:border-white/20'}"
								onclick={() => setPeriod(preset.start, preset.end)}>{preset.label}</button
							>
						{/each}
					</div>
					<label class="block">
						<span class="text-[0.62rem] opacity-60">Baseline for anomalies & percentiles</span>
						<select
							class="{INPUT} mt-0.5"
							value={`${panel.baselineStart}-${panel.baselineEnd}`}
							onchange={(e) => {
								const [a, b] = e.currentTarget.value.split('-').map(Number);
								setBaseline(a, b);
							}}
						>
							{#each BASELINES as b (b.label)}<option value={`${b.start}-${b.end}`}
									>{b.label}</option
								>{/each}
						</select>
					</label>
				</section>

				<section class="space-y-1.5" aria-labelledby="ha-location">
					<h3 id="ha-location" class={SECTION}>
						<span class={STEP}>4</span> Location
					</h3>
					{#if panel.latitude !== undefined && panel.longitude !== undefined}
						<p class="flex items-center gap-1 text-[0.68rem] tabular-nums">
							<MapPin size={12} class="text-sky-600" />
							{formatCoordinate(panel.latitude, 'latitude')}, {formatCoordinate(
								panel.longitude,
								'longitude'
							)}
						</p>
					{/if}
					<div class="grid grid-cols-2 gap-1.5">
						<button onclick={analyseMapCentre} class={BUTTON}>
							<Crosshair size={12} /> Map centre
						</button>
						<button
							onclick={startPick}
							class="{BUTTON} {panel.picking ? 'border-sky-600 bg-sky-600/10' : ''}"
						>
							<MousePointer2 size={12} /> Pick on map
						</button>
					</div>
				</section>

				{#if series}
					<section class="space-y-1.5" aria-labelledby="ha-export">
						<h3 id="ha-export" class={SECTION}>
							<span class={STEP}>5</span> Export
						</h3>
						<div class="grid grid-cols-2 gap-1.5">
							<button onclick={exportAnnualCsv} class={BUTTON}>
								<Download size={11} /> Annual CSV
							</button>
							<button onclick={exportMonthlyCsv} class={BUTTON}>
								<Download size={11} /> Monthly CSV
							</button>
						</div>
						<p class="text-[0.58rem] opacity-55">Every chart also exports as SVG (↓ icon).</p>
					</section>
				{/if}
				<p
					class="border-t border-black/10 pt-2 text-[0.58rem] leading-snug opacity-55 dark:border-white/10"
				>
					{#if panel.source === 'nasa-power'}
						Data: NASA Langley Research Center (LaRC) POWER Project, funded through the NASA Earth
						Science/Applied Science Program. Charts: D3.js.
					{:else}
						Data: Open-Meteo Historical Weather API (Copernicus ERA5 family, CC BY 4.0). Charts:
						D3.js.
					{/if}
				</p>
			</div>

			<!-- Content -->
			<div class="flex min-h-0 flex-col md:overflow-hidden">
				<div
					class="flex shrink-0 gap-0.5 overflow-x-auto border-b px-1.5 text-[0.7rem]"
					role="tablist"
					aria-label="Analysis views"
					tabindex="-1"
					onkeydown={onTabKey}
				>
					{#each tabs as option (option.key)}
						{@const Icon = option.icon}
						<button
							id="tab-{option.key}"
							role="tab"
							aria-selected={tab === option.key}
							aria-controls="ha-tabpanel"
							tabindex={tab === option.key ? 0 : -1}
							onclick={() => (tab = option.key)}
							class="-mb-px flex shrink-0 items-center gap-1 border-b-2 px-2 py-1.5 transition-colors {tab ===
							option.key
								? 'border-sky-600 font-semibold text-sky-800 dark:text-sky-300'
								: 'border-transparent opacity-65 hover:opacity-100'}"
						>
							<Icon size={13} />
							{option.label}
						</button>
					{/each}
				</div>

				<div
					id="ha-tabpanel"
					role="tabpanel"
					aria-labelledby="tab-{tab}"
					class="min-h-0 flex-1 space-y-2.5 px-3 py-2.5 md:overflow-y-auto"
				>
					{#if panel.status === 'loading'}
						<div class="space-y-2">
							{#each [0, 1, 2, 3, 4] as row (row)}
								<div class="h-3 w-full animate-pulse rounded bg-black/10 dark:bg-white/10"></div>
							{/each}
							<p class="text-[0.7rem] opacity-60">
								Loading {panel.source === 'nasa-power'
									? `NASA POWER ${panel.powerParameter} (full record, one request)`
									: 'reanalysis'}…
							</p>
						</div>
					{:else if panel.status === 'error'}
						<div class="space-y-1.5">
							<p class="rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
								{panel.error}
							</p>
							<button class="rounded border px-2 py-1 text-xs" onclick={() => loadAnalysis()}
								>Retry</button
							>
						</div>
					{:else if !series}
						<p class="text-xs opacity-70">
							Choose a location: use the map centre or pick a point on the map.
						</p>
					{:else}
						<!-- Coverage badges -->
						<div class="flex flex-wrap items-center gap-1 text-[0.62rem]">
							<span
								class="rounded bg-sky-600/10 px-1.5 py-0.5 font-mono font-semibold text-sky-800 dark:text-sky-300"
								>{series.code}</span
							>
							<span class="truncate font-medium">{series.label}</span>
							<span class="ml-auto flex flex-wrap gap-1 opacity-75">
								<span class={BADGE}>{series.resolution}</span>
								<span class={BADGE}
									>{kind === 'rate'
										? 'summed to totals'
										: kind === 'count'
											? 'counts summed'
											: kind === 'circular'
												? 'vector-averaged'
												: 'averaged'}</span
								>
								<span class={BADGE}
									>{years.length} complete yrs{#if incompleteAnnual.length}
										· {incompleteAnnual.length} partial{/if}</span
								>
								<span class={BADGE}>{periodPoints.length.toLocaleString()} samples</span>
								{#if series.missingCount}<span class={BADGE}
										>{series.missingCount.toLocaleString()} fill skipped</span
									>{/if}
							</span>
						</div>

						{#if tab === 'overview'}
							{#if insight}
								<p class="text-[0.8rem] leading-snug">
									<b>{insight.lead}</b><span class="opacity-70">{insight.sig}.</span>
									{#if insight.step}<span class="text-amber-800 dark:text-amber-300"
											>{insight.step}</span
										>{/if}
								</p>
							{/if}
							{#if years.length >= 2 && summary}
								<div
									class="grid gap-2 {panel.expanded ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'}"
								>
									<StatTile
										label="Period mean"
										value={fmt(summary.mean)}
										unit={units.annual}
										detail="±{fmt(summary.sd)} year-to-year SD · {summary.firstLabel}: {fmt(
											summary.firstThird
										)} → {summary.lastLabel}: {fmt(summary.lastThird)}"
										spark={{ values, trend: sparkTrend }}
									/>
									{#if sen && !isCircular}
										<StatTile
											label="Trend / decade"
											value={signed(sen.senSlopePerDecade)}
											unit={units.annual}
											direction={trendDirection}
											accent={trendDirection === 'up'
												? COLORS.positive
												: trendDirection === 'down'
													? COLORS.negative
													: 'currentColor'}
											pill={trendSignificant
												? { text: 'significant', tone: trendDirection === 'up' ? 'up' : 'down' }
												: { text: 'not significant', tone: 'flat' }}
											detail="Sen's slope · MK {pLabel(sen.pValue)}{trend
												? ` · OLS ${signed(trend.slopePerDecade)} ± ${fmt(trend.ci95PerDecade)}, adj. ${pLabel(trend.pValueAdjusted)}`
												: ''}"
											title="Mann-Kendall/Sen's slope on complete annual values; OLS p adjusted for lag-1 autocorrelation (Santer et al. 2000)"
										/>
									{/if}
									{#if latest}
										<StatTile
											label="Year {latest.year}"
											value={fmt(latest.value)}
											unit={units.annual}
											pill={{
												text: `${ordinal(latest.rank)} ${rankWords[0]}`,
												tone:
													latest.rank <= 5 ? 'up' : latest.of - latest.rank < 5 ? 'down' : 'none'
											}}
											detail="{latest.anomaly !== undefined
												? `${signed(latest.anomaly)} ${units.annual} vs ${panel.baselineStart}–${panel.baselineEnd} · `
												: ''}{ordinal(
												latest.of - latest.rank + 1
											)} {rankWords[1]} of {latest.of} complete years"
										/>
									{/if}
									{#if !isCircular}
										<StatTile
											label="Homogeneity"
											value={hasStep ? `Step ${changePoint?.year}` : 'No step'}
											pill={hasStep
												? { text: 'check data', tone: 'warn' }
												: { text: 'consistent', tone: 'ok' }}
											detail={changePoint
												? `Pettitt ${pLabel(changePoint.pValue)} · shift ${signed(changePoint.shift)} ${units.annual}${hasStep ? ' · see Compare' : ''}`
												: 'Pettitt test not available'}
											title="Pettitt (1979) non-parametric change-point test on annual values"
										/>
									{/if}
								</div>
							{/if}
							{#if anomalies && anomalies.years.length >= 5}
								<StripesStrip
									years={anomalies.years}
									anomalies={anomalies.anomalies}
									interpolator={stripeInterpolator}
									unit={units.annual}
									baseline={[panel.baselineStart, panel.baselineEnd]}
								/>
							{/if}
							{#if years.length >= 2}
								<ChartCard
									title="Annual {kind === 'rate' || kind === 'count'
										? 'totals'
										: 'means'} with trend and change-point"
									subtitle="Trends fitted to complete annual values ({panel.startYear}–{panel.endYear}); hollow points are incomplete years (excluded)."
									filename="{fileBase}-annual"
								>
									<AnnualChart
										{years}
										{values}
										unit={units.annual}
										mode={kind === 'rate' || kind === 'count' ? 'bar' : 'line'}
										label={series.code}
										incomplete={incompleteAnnual.map((a) => ({ year: a.year, value: a.value }))}
										ols={trend
											? { slopePerYear: trend.slopePerYear, intercept: trend.intercept }
											: undefined}
										sen={sen
											? { slopePerYear: sen.senSlopePerYear, intercept: sen.intercept }
											: undefined}
										change={changePoint && changePoint.pValue < 0.05
											? {
													year: changePoint.year,
													meanBefore: changePoint.meanBefore,
													meanAfter: changePoint.meanAfter,
													pValue: changePoint.pValue
												}
											: undefined}
										baseline={[panel.baselineStart, panel.baselineEnd]}
										olsLabel={trend ? `OLS ${signed(trend.slopePerDecade)}/dec` : 'OLS'}
										senLabel={sen ? `Sen ${signed(sen.senSlopePerDecade)}/dec` : "Sen's slope"}
										height={panel.expanded ? 260 : 210}
									/>
								</ChartCard>

								{#if changePoint && changePoint.pValue < 0.05}
									<p
										class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[0.68rem] leading-snug"
									>
										<b>⚠ Possible step change in {changePoint.year}</b> (Pettitt {pLabel(
											changePoint.pValue
										)}, shift
										{signed(changePoint.shift)}
										{units.annual}). If it coincides with a data-source change, the linear trend
										below mixes an artefact with climate; check the
										<button class="underline" onclick={() => (tab = 'compare')}>Compare</button> tab.
									</p>
								{/if}

								<h4 class="pt-1 text-[0.6rem] font-semibold uppercase tracking-wide opacity-60">
									Statistical details
								</h4>
								<div class="grid gap-2 {panel.expanded ? 'sm:grid-cols-3' : 'grid-cols-1'}">
									{#if summary}
										<div
											class="rounded-lg border border-black/10 bg-white px-2.5 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-900"
										>
											<h4 class="text-[0.68rem] font-semibold opacity-80">Period summary</h4>
											<dl class="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[0.72rem]">
												<dt class="opacity-60">Mean</dt>
												<dd class="text-right font-medium">{fmt(summary.mean)} {units.annual}</dd>
												<dt class="opacity-60">Year-to-year SD</dt>
												<dd class="text-right">{fmt(summary.sd)}</dd>
												<dt class="opacity-60">{summary.firstLabel}</dt>
												<dd class="text-right">{fmt(summary.firstThird)}</dd>
												<dt class="opacity-60">{summary.lastLabel}</dt>
												<dd class="text-right">{fmt(summary.lastThird)}</dd>
												<dt class="opacity-60">Change</dt>
												<dd class="text-right font-medium">
													{signed(summary.lastThird - summary.firstThird)}
												</dd>
											</dl>
										</div>
									{/if}
									{#if trend}
										<div
											class="rounded-lg border border-black/10 bg-white px-2.5 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-900"
										>
											<h4 class="text-[0.68rem] font-semibold opacity-80">
												OLS trend <span class="font-normal opacity-60">(annual)</span>
											</h4>
											<dl class="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[0.72rem]">
												<dt class="opacity-60">Per decade</dt>
												<dd class="text-right font-medium">
													{signed(trend.slopePerDecade, 3)} ± {fmt(trend.ci95PerDecade, 3)}
												</dd>
												<dt class="opacity-60">R²</dt>
												<dd class="text-right">{trend.r2.toFixed(3)}</dd>
												<dt class="opacity-60">p (naive)</dt>
												<dd class="text-right">{pValueText(trend.pValue)}</dd>
												<dt
													class="opacity-60"
													title="Lag-1 autocorrelation of residuals, Santer et al. 2000"
												>
													p (n_eff {trend.nEff.toFixed(0)}, r₁ {trend.r1.toFixed(2)})
												</dt>
												<dd
													class="text-right font-medium {trend.pValueAdjusted < 0.05
														? 'font-semibold text-sky-700 dark:text-sky-300'
														: ''}"
												>
													{pValueText(trend.pValueAdjusted)}
												</dd>
											</dl>
										</div>
									{/if}
									{#if sen}
										<div
											class="rounded-lg border border-black/10 bg-white px-2.5 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-900"
										>
											<h4 class="text-[0.68rem] font-semibold opacity-80">
												Mann-Kendall · Sen <span class="font-normal opacity-60">(robust)</span>
											</h4>
											<dl class="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[0.72rem]">
												<dt class="opacity-60">Sen / decade</dt>
												<dd class="text-right font-medium">{signed(sen.senSlopePerDecade, 3)}</dd>
												<dt class="opacity-60">z</dt>
												<dd class="text-right">{sen.z.toFixed(2)}</dd>
												<dt class="opacity-60">p</dt>
												<dd class="text-right">{pValueText(sen.pValue)}</dd>
												<dt class="opacity-60">Verdict</dt>
												<dd class="text-right font-medium">{significance(sen.pValue)}</dd>
												{#if changePoint}
													<dt class="opacity-60">Pettitt</dt>
													<dd class="text-right">
														{changePoint.year} (p {pValueText(changePoint.pValue)})
													</dd>
												{/if}
											</dl>
										</div>
									{/if}
								</div>
								{#if isCircular}
									<p class="text-[0.66rem] opacity-70">
										Wind direction is circular: linear trend tests are not defined. Use Seasonal and
										Anomaly (angular differences).
									</p>
								{/if}
							{:else}
								<p class="text-xs opacity-70">
									Need at least two complete years in the selected period.
								</p>
							{/if}

							{#if caveats.length}
								<div
									class="rounded-md bg-black/5 px-2 py-1.5 text-[0.64rem] leading-snug dark:bg-white/5"
								>
									<h4 class="mb-0.5 font-semibold opacity-80">Data provenance</h4>
									<ul class="list-disc space-y-0.5 pl-4 opacity-80">
										{#each caveats as note (note)}<li>{note}</li>{/each}
									</ul>
								</div>
							{/if}
						{:else if tab === 'series'}
							<div class="flex items-center justify-end gap-1 text-[0.66rem]">
								<span class="opacity-60">Smoothing</span>
								{#each smoothingOptions as o (o.value)}
									<button
										class="rounded border px-1.5 py-0.5 {smoothing === o.value
											? 'border-sky-500 bg-sky-500/15'
											: 'opacity-70'}"
										onclick={() => (smoothing = o.value)}>{o.label}</button
									>
								{/each}
							</div>
							<ChartCard
								title="{series.resolution === 'monthly'
									? 'Monthly'
									: series.resolution === 'hourly'
										? 'Hourly'
										: 'Daily'} series"
								subtitle="Brush the overview to zoom; drawn with LTTB downsampling so peaks are kept."
								filename="{fileBase}-series"
							>
								<SeriesChart
									points={periodPoints}
									unit={units.sample}
									label={series.code}
									smooth={smoothing}
									smoothLabel={smoothingOptions.find((o) => o.value === smoothing)?.label ?? ''}
									monthly={series.resolution === 'monthly'}
									height={panel.expanded ? 300 : 250}
								/>
							</ChartCard>
							<div
								class="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[0.68rem] shadow-sm sm:grid-cols-4 dark:border-white/10 dark:bg-neutral-900"
							>
								<span class="opacity-60">Samples</span><span class="text-right"
									>{samples.n.toLocaleString()}</span
								>
								<span class="opacity-60">Mean ± SD</span><span class="text-right"
									>{fmt(samples.mean)} ± {fmt(samples.sd)}</span
								>
								<span class="opacity-60">p5 / p50 / p95</span><span class="text-right"
									>{fmt(samples.p5)} / {fmt(samples.p50)} / {fmt(samples.p95)}</span
								>
								{#if samples.min && samples.max}
									<span class="opacity-60">Min</span><span class="text-right"
										>{fmt(samples.min.value)} ({new Date(samples.min.time)
											.toISOString()
											.slice(0, 10)})</span
									>
									<span class="opacity-60">Max</span><span class="text-right"
										>{fmt(samples.max.value)} ({new Date(samples.max.time)
											.toISOString()
											.slice(0, 10)})</span
									>
								{/if}
							</div>
						{:else if tab === 'seasonal'}
							<div class="flex items-center justify-end gap-1 text-[0.66rem]">
								<label class="flex items-center gap-1">
									<span class="opacity-60">Highlight year</span>
									<select
										class="rounded-md border border-black/15 bg-white px-1.5 py-0.5 shadow-sm dark:border-white/15 dark:bg-neutral-900"
										value={highlight?.year}
										onchange={(e) => (highlightYear = Number(e.currentTarget.value))}
									>
										{#each [...years].reverse() as y (y)}<option value={y}>{y}</option>{/each}
									</select>
								</label>
							</div>
							<ChartCard
								title="Monthly climatology ({units.monthly})"
								subtitle="Distribution of monthly values over {climatologyLabel}; dots outside p10–p90 are coloured red (high) / blue (low)."
								filename="{fileBase}-seasonal"
							>
								<SeasonalChart
									climatology={effectiveClimatology}
									unit={units.monthly}
									baselineLabel={climatologyLabel}
									{highlight}
									height={panel.expanded ? 260 : 230}
								/>
							</ChartCard>
							<div class="flex items-center justify-end gap-1 text-[0.66rem]">
								{#each [{ v: 'anomaly', l: 'Anomaly' }, { v: 'value', l: 'Value' }] as o (o.v)}
									<button
										class="rounded border px-1.5 py-0.5 {heatmapMode === o.v
											? 'border-sky-500 bg-sky-500/15'
											: 'opacity-70'}"
										onclick={() => (heatmapMode = o.v as 'anomaly' | 'value')}>{o.l}</button
									>
								{/each}
							</div>
							<ChartCard
								title="Year × month {heatmapMode === 'anomaly' ? 'anomalies' : 'values'}"
								subtitle="Each cell is one month; anomalies against the {climatologyLabel} monthly mean."
								filename="{fileBase}-heatmap"
							>
								<HeatmapChart
									cells={matrix}
									mode={heatmapMode}
									unit={units.monthly}
									code={series.code}
									{kind}
									baselineLabel={climatologyLabel}
								/>
							</ChartCard>
						{:else if tab === 'anomaly'}
							{#if anomalies}
								<ChartCard
									title="Annual anomalies and climate stripes"
									subtitle="Relative to {anomalies.baselineLabel}{anomalies.usesBaseline
										? ''
										: ' (baseline not fully covered)'}; line = 11-year running mean."
									filename="{fileBase}-anomaly"
								>
									<AnomalyChart
										years={anomalies.years}
										anomalies={anomalies.anomalies}
										unit={units.annual}
										code={series.code}
										{kind}
										baselineLabel={anomalies.baselineLabel}
										height={panel.expanded ? 270 : 240}
									/>
								</ChartCard>
								<div class="grid gap-2 sm:grid-cols-2">
									<div
										class="rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[0.68rem] shadow-sm dark:border-white/10 dark:bg-neutral-900"
									>
										<h4 class="font-semibold opacity-80">Highest</h4>
										<ol class="mt-0.5 space-y-0.5">
											{#each anomalies.ranking.slice(0, 5) as r, i (r.year)}
												<li class="flex justify-between">
													<span>{i + 1}. {r.year}</span><span
														class="font-medium text-red-600 dark:text-red-400"
														>{signed(r.anomaly)} {units.annual}</span
													>
												</li>
											{/each}
										</ol>
									</div>
									<div
										class="rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[0.68rem] shadow-sm dark:border-white/10 dark:bg-neutral-900"
									>
										<h4 class="font-semibold opacity-80">Lowest</h4>
										<ol class="mt-0.5 space-y-0.5">
											{#each anomalies.ranking.slice(-5).reverse() as r, i (r.year)}
												<li class="flex justify-between">
													<span>{i + 1}. {r.year}</span><span
														class="font-medium text-blue-600 dark:text-blue-400"
														>{signed(r.anomaly)} {units.annual}</span
													>
												</li>
											{/each}
										</ol>
									</div>
								</div>
								<p class="text-[0.66rem] opacity-70">
									{anomalies.aboveCount} of {anomalies.years.length} years above the baseline mean ({fmt(
										anomalies.baselineMean
									)}
									{units.annual}).
								</p>
							{:else}
								<p class="text-xs opacity-70">Not enough complete years for anomalies.</p>
							{/if}
						{:else if tab === 'extremes'}
							{#if distribution}
								<ChartCard
									title="Distribution shift: first vs last third"
									subtitle="{series.resolution} values, {units.sample}. {distribution.note ?? ''}"
									filename="{fileBase}-distribution"
								>
									<DistributionChart
										early={distribution.early}
										late={distribution.late}
										earlyLabel={distribution.earlyLabel}
										lateLabel={distribution.lateLabel}
										unit={units.sample}
										height={panel.expanded ? 240 : 210}
									/>
									{#snippet footer()}
										p10 {fmt(distribution.earlyStats.p10)} → {fmt(distribution.lateStats.p10)} ({signed(
											distribution.lateStats.p10 - distribution.earlyStats.p10
										)}) · median {fmt(distribution.earlyStats.p50)} → {fmt(
											distribution.lateStats.p50
										)} ({signed(distribution.lateStats.p50 - distribution.earlyStats.p50)}) · p90 {fmt(
											distribution.earlyStats.p90
										)} → {fmt(distribution.lateStats.p90)} ({signed(
											distribution.lateStats.p90 - distribution.earlyStats.p90
										)})
									{/snippet}
								</ChartCard>
							{:else}
								<p class="text-xs opacity-70">
									Need at least six complete years for the distribution comparison.
								</p>
							{/if}
							{#if exceedance}
								<ChartCard
									title={exceedance.label}
									subtitle={exceedance.thresholdNote}
									filename="{fileBase}-exceedance-high"
								>
									<AnnualChart
										years={exceedance.years}
										values={exceedance.high}
										unit="days/yr"
										mode="bar"
										label="days"
										sen={exceedanceSen
											? {
													slopePerYear: exceedanceSen.senSlopePerYear,
													intercept: exceedanceSen.intercept
												}
											: undefined}
										height={190}
									/>
									{#snippet footer()}
										Sen {signed(exceedanceSen?.senSlopePerDecade)} days/decade (MK p {pValueText(
											exceedanceSen?.pValue
										)})
									{/snippet}
								</ChartCard>
								{#if exceedance.low && exceedance.lowLabel}
									<ChartCard
										title={exceedance.lowLabel}
										subtitle={exceedance.thresholdNote}
										filename="{fileBase}-exceedance-low"
									>
										<AnnualChart
											years={exceedance.years}
											values={exceedance.low}
											unit="days/yr"
											mode="bar"
											label="days"
											sen={exceedanceLowSen
												? {
														slopePerYear: exceedanceLowSen.senSlopePerYear,
														intercept: exceedanceLowSen.intercept
													}
												: undefined}
											height={190}
										/>
										{#snippet footer()}
											Sen {signed(exceedanceLowSen?.senSlopePerDecade)} days/decade (MK p {pValueText(
												exceedanceLowSen?.pValue
											)})
										{/snippet}
									</ChartCard>
								{/if}
							{:else if series.resolution !== 'daily'}
								<p class="text-[0.66rem] opacity-70">
									Percentile-exceedance indices need daily data (switch POWER to Daily).
								</p>
							{/if}
						{:else if tab === 'compare'}
							{#if !pair}
								<p class="text-xs opacity-70">
									No equivalent ERA5 ↔ POWER parameter for {series.code}. Comparable: T2M, T2M_MAX,
									T2M_MIN, T2MDEW, T2MWET, RH2M, PRECTOTCORR, IMERG_PRECTOT, WS10M, WS10M_MAX,
									WD10M, PS, SLP, CLOUD_AMT, ALLSKY_SFC_SW_DWN (and the matching Open-Meteo daily
									variables).
								</p>
							{:else if panel.compare.status === 'loading'}
								<p class="text-xs opacity-70">
									Loading {series.source === 'nasa-power'
										? `ERA5 ${pair.openMeteo}`
										: `NASA POWER ${pair.power}`} for the same point…
								</p>
							{:else if panel.compare.status === 'error'}
								<p class="rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
									{panel.compare.error}
								</p>
								<button class="rounded border px-2 py-1 text-xs" onclick={() => loadCompare()}
									>Retry</button
								>
							{:else if comparison && compareSeries}
								{@const otherLabel = series.source === 'nasa-power' ? 'ERA5' : 'POWER'}
								{@const selfLabel = series.source === 'nasa-power' ? 'POWER' : 'ERA5'}
								{@const sameSign =
									Math.sign(comparison.primaryTrend?.senSlopePerDecade ?? 0) ===
									Math.sign(comparison.secondaryTrend?.senSlopePerDecade ?? 0)}
								<p class="text-[0.66rem] opacity-75">
									{series.code} vs {series.source === 'nasa-power'
										? `ERA5 ${pair.openMeteo}`
										: `POWER ${pair.power}`} at the same point, in {units.sample}.
									{pair.note ?? ''}
								</p>
								<ChartCard
									title="Annual {selfLabel} vs {otherLabel}"
									subtitle="Common complete years {comparison.years[0]}–{comparison.years[
										comparison.years.length - 1
									]}"
									filename="{fileBase}-compare-annual"
								>
									<AnnualChart
										years={comparison.years}
										values={comparison.primary}
										unit={units.annual}
										label={selfLabel}
										compare={{
											years: comparison.years,
											values: comparison.secondary,
											label: otherLabel
										}}
										height={panel.expanded ? 240 : 210}
									/>
								</ChartCard>
								<ChartCard
									title="Difference {selfLabel} − {otherLabel}"
									subtitle="A step in the difference series indicates an inhomogeneity in one source, not climate."
									filename="{fileBase}-compare-diff"
								>
									<AnnualChart
										years={comparison.years}
										values={comparison.difference}
										unit={units.annual}
										mode="bar"
										signColors
										label="difference"
										change={comparisonChange && comparisonChange.pValue < 0.05
											? {
													year: comparisonChange.year,
													meanBefore: comparisonChange.meanBefore,
													meanAfter: comparisonChange.meanAfter,
													pValue: comparisonChange.pValue
												}
											: undefined}
										height={200}
									/>
								</ChartCard>
								<div class="grid gap-2 {panel.expanded ? 'sm:grid-cols-2' : ''}">
									<div
										class="rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[0.68rem] shadow-sm dark:border-white/10 dark:bg-neutral-900"
									>
										<h4 class="font-semibold opacity-80">Agreement</h4>
										<dl class="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
											<dt class="opacity-60">Annual r</dt>
											<dd class="text-right font-medium">{fmt(comparison.annualR, 2)}</dd>
											<dt class="opacity-60">Monthly-anomaly r</dt>
											<dd class="text-right">
												{fmt(comparison.monthlyR, 2)} (n {comparison.monthlyN})
											</dd>
											{#if comparison.dailyN}
												<dt class="opacity-60">Daily r · bias · RMSE</dt>
												<dd class="text-right">
													{fmt(comparison.dailyR, 2)} · {signed(comparison.dailyBias)} · {fmt(
														comparison.dailyRmse
													)}
												</dd>
											{/if}
											<dt class="opacity-60">Annual bias</dt>
											<dd class="text-right">{signed(comparison.annualBias)} {units.annual}</dd>
											<dt class="opacity-60">Annual RMSE</dt>
											<dd class="text-right">{fmt(comparison.annualRmse)}</dd>
										</dl>
									</div>
									<div
										class="rounded-lg border border-black/10 bg-white px-2.5 py-2 text-[0.68rem] shadow-sm dark:border-white/10 dark:bg-neutral-900"
									>
										<h4 class="font-semibold opacity-80">Trends (Sen, per decade)</h4>
										<dl class="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
											<dt class="opacity-60">{selfLabel}</dt>
											<dd class="text-right font-medium">
												{signed(comparison.primaryTrend?.senSlopePerDecade, 3)} (p {pValueText(
													comparison.primaryTrend?.pValue
												)})
											</dd>
											<dt class="opacity-60">{otherLabel}</dt>
											<dd class="text-right font-medium">
												{signed(comparison.secondaryTrend?.senSlopePerDecade, 3)} (p {pValueText(
													comparison.secondaryTrend?.pValue
												)})
											</dd>
											<dt class="opacity-60">Difference</dt>
											<dd class="text-right">
												{signed(comparison.differenceTrend?.senSlopePerDecade, 3)} (p {pValueText(
													comparison.differenceTrend?.pValue
												)})
											</dd>
											{#if comparisonChange}
												<dt class="opacity-60">Difference step</dt>
												<dd class="text-right">
													{comparisonChange.year}, {signed(comparisonChange.shift)} (p {pValueText(
														comparisonChange.pValue
													)})
												</dd>
											{/if}
										</dl>
									</div>
								</div>
								<p
									class="rounded px-2 py-1.5 text-[0.68rem] leading-snug {sameSign &&
									!(comparisonChange && comparisonChange.pValue < 0.05)
										? 'bg-emerald-500/10'
										: 'border border-amber-500/40 bg-amber-500/10'}"
								>
									{#if !sameSign}
										<b>The two sources disagree on the sign of the trend.</b>
									{:else}
										The trend sign agrees.
									{/if}
									{#if comparisonChange && comparisonChange.pValue < 0.05}
										Their difference has a significant step in {comparisonChange.year} ({signed(
											comparisonChange.shift
										)}
										{units.annual}), so at least one record is inhomogeneous here; prefer trends
										from the homogeneous sub-period, or from station data.
									{:else}
										No significant step in the difference series.
									{/if}
								</p>
								<ChartCard
									title="Monthly {selfLabel} vs {otherLabel}"
									subtitle="Colour = year: a drift of colours away from the 1:1 line reveals a time-dependent bias."
									filename="{fileBase}-compare-scatter"
								>
									<ScatterChart
										data={comparison.monthly.map((m) => ({
											x: m.secondary,
											y: m.primary,
											year: m.year,
											label: `${m.year}-${String(m.month + 1).padStart(2, '0')}`
										}))}
										xLabel={otherLabel}
										yLabel={selfLabel}
										unit={units.monthly}
										height={panel.expanded ? 300 : 260}
									/>
								</ChartCard>
								{#if series.resolution === 'daily'}
									<ChartCard
										title="Daily overlay"
										subtitle="Brush to zoom into any period."
										filename="{fileBase}-compare-daily"
									>
										<SeriesChart
											points={periodPoints}
											secondary={sliceYears(compareSeries.points, panel.startYear, panel.endYear)}
											secondaryLabel={otherLabel}
											unit={units.sample}
											label={selfLabel}
											smooth={30}
											smoothLabel="30-day mean"
											height={260}
										/>
									</ChartCard>
								{/if}
							{:else}
								<p class="text-xs opacity-70">Preparing comparison…</p>
							{/if}
						{:else if tab === 'spatial'}
							<div class="flex flex-wrap items-end gap-2 text-[0.68rem]">
								<label>
									<span class="opacity-60">Box</span>
									<select
										class="ml-1 rounded-md border border-black/15 bg-white px-1.5 py-0.5 shadow-sm dark:border-white/15 dark:bg-neutral-900"
										value={panel.spatial.size}
										onchange={(e) => loadSpatial(Number(e.currentTarget.value))}
									>
										{#each [4, 6, 8, 10] as size (size)}<option value={size}
												>{size}° × {size}°</option
											>{/each}
									</select>
								</label>
								<label>
									<span class="opacity-60">Metric</span>
									<select
										class="ml-1 rounded-md border border-black/15 bg-white px-1.5 py-0.5 shadow-sm dark:border-white/15 dark:bg-neutral-900"
										bind:value={spatialMetric}
									>
										<option value="sen">Sen's slope / decade</option>
										<option value="mean">Period mean</option>
										<option value="changeYear">Change-point year</option>
										<option value="shift">Change-point shift</option>
									</select>
								</label>
								<button
									class="rounded-md bg-sky-600 px-2.5 py-0.5 font-medium text-white shadow-sm hover:bg-sky-700"
									onclick={() => loadSpatial()}
								>
									{spatialGrid ? 'Reload' : 'Load grid'}
								</button>
								{#if spatialGrid}
									<label class="flex items-center gap-1"
										><input type="checkbox" bind:checked={showOnMap} /> Show on map</label
									>
								{/if}
							</div>
							{#if panel.spatial.status === 'loading' && panel.spatial.forKey === currentSpatialKey}
								<p class="text-xs opacity-70">
									Requesting POWER regional monthly {panel.powerParameter} ({panel.spatial.size}°
									box, {panel.startYear}–{panel.endYear})…
								</p>
							{:else if panel.spatial.status === 'error' && panel.spatial.forKey === currentSpatialKey}
								<p class="rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
									{panel.spatial.error}
								</p>
							{:else if spatialGrid && spatialCells.length}
								<ChartCard
									title="Regional {spatialMetric === 'sen'
										? 'trend'
										: spatialMetric === 'mean'
											? 'mean'
											: 'change points'} · {spatialCells.length} grid cells"
									subtitle="POWER monthly regional data on the native {spatialGrid.latStep}° × {spatialGrid.lonStep}° grid; dots mark p < 0.05; click a cell to analyse it."
									filename="{fileBase}-spatial-{spatialMetric}"
								>
									<SpatialChart
										cells={spatialCells}
										metric={spatialMetric}
										latStep={spatialGrid.latStep}
										lonStep={spatialGrid.lonStep}
										location={{ latitude: series.latitude, longitude: series.longitude }}
										bounds={spatialGrid.bounds}
										unit={units.sample}
										annualUnit={units.annual}
										code={series.code}
										{kind}
										onpick={(lat, lon) => setLocation(lat, lon)}
									/>
								</ChartCard>
								{#if spatialSummary}
									<div class="grid grid-cols-2 gap-2 {panel.expanded ? 'lg:grid-cols-4' : ''}">
										<StatTile
											label="Rising cells"
											value={fmt(spatialSummary.upSig, 0)}
											unit="of {spatialCells.length}"
											detail="significant positive Sen slope (MK p < 0.05)"
										/>
										<StatTile
											label="Falling cells"
											value={fmt(spatialSummary.downSig, 0)}
											unit="of {spatialCells.length}"
											detail="significant negative Sen slope (MK p < 0.05)"
										/>
										<StatTile
											label="Median trend"
											value={signed(spatialSummary.medianSen)}
											unit="{units.annual}/dec"
											detail="range {signed(spatialSummary.minSen)} … {signed(
												spatialSummary.maxSen
											)}"
										/>
										<StatTile
											label="Steps"
											value="{Math.round(spatialChangeShare * 100)}%"
											pill={spatialChangeShare > 0.5
												? { text: 'region-wide', tone: 'warn' }
												: { text: 'local', tone: 'ok' }}
											detail={spatialSummary.modeYear
												? `most common step year ${spatialSummary.modeYear} (${spatialSummary.modeCount} cells)`
												: 'no significant steps'}
										/>
									</div>
								{/if}
								{#if spatialChangeShare > 0.5}
									<p
										class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[0.7rem] leading-snug"
									>
										<b>⚠ Region-wide step.</b>
										{Math.round(spatialChangeShare * 100)}% of cells change in the same few years:
										this usually reflects a change in the reanalysis inputs, not local climate.
										Treat trends spanning {spatialSummary?.modeYear ?? 'that year'} with caution.
									</p>
								{/if}
							{:else}
								<p class="text-xs opacity-70">
									Load a regional grid (one POWER request, monthly {panel.startYear}–{panel.endYear})
									to map trends and change points around this point. POWER limits regional requests
									to one parameter and 10° per axis.
								</p>
							{/if}
						{/if}
					{/if}
				</div>
			</div>
		</div>
	</aside>
{/if}
