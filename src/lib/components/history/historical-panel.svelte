<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { get } from 'svelte/store';
	import { fade, fly } from 'svelte/transition';

	import { X } from '@lucide/svelte';

	import {
		ARCHIVE_MODELS,
		ARCHIVE_VARIABLES,
		type ArchiveModel,
		archiveState,
		closeArchive,
		fetchArchiveSeriesCached,
		loadArchive,
		maxYearForVariable,
		modelSupportsPressureLevels,
		setArchiveModel,
		setArchivePeriod,
		setArchiveVariable,
		startYearForVariable
	} from '$lib/stores/archive';
	import { map } from '$lib/stores/map';

	import {
		anomalyOf,
		dayOfYearClimatology,
		linearRegression,
		mannKendall,
		mean,
		percentiles,
		summariseAnnual,
		toAnnualMeans
	} from '$lib/archive-stats';

	type View = 'annual' | 'series' | 'anomaly';

	let view: View = $state('annual');

	const panel = $derived($archiveState);

	const variable = $derived(ARCHIVE_VARIABLES.find((v) => v.name === panel.variable));
	const modelInfo = $derived(
		variable?.endpoint === 'archive'
			? ARCHIVE_MODELS.find((m) => m.value === panel.model)
			: undefined
	);

	/** Pressure-level parameters are only offered for forecast models that publish them. */
	const availableVariables = $derived(
		ARCHIVE_VARIABLES.filter(
			(v) => v.group !== 'pressure-level' || modelSupportsPressureLevels(panel.model)
		)
	);

	const minYear = $derived(variable ? startYearForVariable(variable, panel.model) : 1940);
	const maxYear = $derived(
		variable ? maxYearForVariable(variable, panel.model) : new Date().getUTCFullYear() - 1
	);
	const canShowAnomaly = $derived(
		variable !== undefined &&
			minYear <= panel.climatologyStartYear &&
			maxYear >= panel.climatologyEndYear
	);

	// Keep the year-based period inside the selected source's complete coverage.
	$effect(() => {
		if (
			panel.startYear < minYear ||
			panel.startYear > maxYear ||
			panel.endYear < minYear ||
			panel.endYear > maxYear
		) {
			setArchivePeriod(panel.startYear, panel.endYear);
		}
	});

	$effect(() => {
		if (view === 'anomaly' && !canShowAnomaly) view = 'annual';
	});

	const visibleViews = $derived.by(() =>
		canShowAnomaly
			? [
					{ key: 'annual' as View, label: 'Annual' },
					{ key: 'series' as View, label: 'Series' },
					{ key: 'anomaly' as View, label: 'Anomaly' }
				]
			: [
					{ key: 'annual' as View, label: 'Annual' },
					{ key: 'series' as View, label: 'Series' }
				]
	);

	const annual = $derived.by(() => {
		const points = panel.series?.points;
		if (!points || points.length === 0) return undefined;
		const { years, values } = toAnnualMeans(points);
		if (years.length < 2) return undefined;
		return {
			years,
			values,
			regression: linearRegression(points.map((p) => ({ time: p.time, value: p.value }))),
			kendall: mannKendall(years.map((y, i) => ({ time: Date.UTC(y, 0, 1), value: values[i] }))),
			summary: summariseAnnual(years, values)
		};
	});

	/** Downsampled hourly series; a 45-year hourly fetch is ~390k points. */
	const series = $derived.by(() => {
		const points = panel.series?.points;
		if (!points || points.length === 0) return undefined;
		const max = 900;
		const stride = Math.max(1, Math.ceil(points.length / max));
		return points.filter((_, i) => i % stride === 0);
	});

	const statistics = $derived.by(() => {
		const points = panel.series?.points;
		if (!points || points.length === 0) return undefined;
		const values = points.map((p) => p.value);
		const { p5, p50, p95 } = percentiles(values);
		return {
			count: values.length,
			mean: mean(values),
			stdDev: (() => {
				const m = mean(values);
				const acc = values.reduce((a, v) => a + (v - m) ** 2, 0);
				return values.length > 1 ? Math.sqrt(acc / (values.length - 1)) : NaN;
			})(),
			min: Math.min(...values),
			max: Math.max(...values),
			p5,
			p50,
			p95
		};
	});

	/**
	 * Anomaly needs a climatology from the same variable and location. Building
	 * it from the loaded span would make the "normal" drift with the period, so
	 * the baseline comes from a dedicated fetch over the fixed 1991-2020 window.
	 */
	let climatologyPoints: { time: number; value: number }[] | undefined = $state(undefined);
	let climatologyLoading: boolean = $state(false);
	let climatologyError: string | undefined = $state(undefined);
	// Internal request guard only; it is not rendered state, so keep it
	// non-reactive to avoid cancelling the just-started effect on assignment.
	let climatologyKey = '';

	$effect(() => {
		const v = panel.variable;
		const m = panel.model;
		const lat = panel.latitude;
		const lon = panel.longitude;
		if (view !== 'anomaly' || v === undefined || lat === undefined || lon === undefined) return;

		const key = `${v}|${m}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
		// Avoid a duplicate request for the same variable, model and grid cell;
		// the non-reactive key does not itself retrigger or cancel this effect.
		if (climatologyKey === key) return;
		climatologyKey = key;

		let cancelled = false;
		climatologyLoading = true;
		climatologyError = undefined;

		(async () => {
			try {
				const def = ARCHIVE_VARIABLES.find((x) => x.name === v);
				if (def === undefined) return;
				const base = await fetchArchiveSeriesCached(
					def,
					m,
					lat,
					lon,
					panel.climatologyStartYear,
					panel.climatologyEndYear
				);
				if (!cancelled) climatologyPoints = base.points;
			} catch (e) {
				if (!cancelled) {
					climatologyError = e instanceof Error ? e.message : 'Failed to load climatology';
				}
			} finally {
				if (!cancelled) climatologyLoading = false;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	const climatology = $derived.by(() => {
		if (view !== 'anomaly' || climatologyPoints === undefined) return undefined;
		return dayOfYearClimatology(climatologyPoints);
	});

	const anomalies = $derived.by(() => {
		const clim = climatology;
		const points = panel.series?.points;
		if (clim === undefined || points === undefined) return undefined;
		const byYear = new SvelteMap<number, number[]>();
		for (const p of points) {
			const a = anomalyOf(new Date(p.time), p.value, clim);
			if (!Number.isFinite(a)) continue;
			const year = new Date(p.time).getUTCFullYear();
			const list = byYear.get(year);
			if (list) list.push(a);
			else byYear.set(year, [a]);
		}
		const years = [...byYear.keys()].sort((a, b) => a - b);
		const values = years.map((y) => mean(byYear.get(y) as number[]));
		return years.length < 2 ? undefined : { years, values };
	});

	/**
	 * The archive snaps a request to the grid cell it actually served, so the
	 * panel shows that cell rather than the raw click. Three decimals is about
	 * 100 m, which is more honest than the four the API echoes back.
	 */
	function formatCoordinate(value: number, axis: 'latitude' | 'longitude'): string {
		const hemisphere = axis === 'latitude' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
		return `${Math.abs(value).toFixed(3)}°${hemisphere}`;
	}

	function analyseMapCentre() {
		const centre = get(map)?.getCenter();
		if (!centre) return;
		archiveState.update((s) => ({ ...s, latitude: centre.lat, longitude: centre.lng }));
		if (panel.variable && panel.model) {
			void loadArchive(
				panel.variable,
				panel.model,
				centre.lat,
				centre.lng,
				panel.startYear,
				panel.endYear
			);
		}
	}

	function selectVariable(name: string) {
		setArchiveVariable(name);
	}

	function selectModel(value: ArchiveModel) {
		const selected = ARCHIVE_MODELS.find((model) => model.value === value);
		setArchiveModel(value);
		if (selected?.kind === 'model') {
			// A 1991–2020 climatology cannot be built from the short operational-model archive.
			view = 'annual';
			climatologyPoints = undefined;
			climatologyError = undefined;
			climatologyKey = '';
		}
	}
</script>

{#if panel.open}
	{@const compactDate = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' })}

	<aside
		transition:fly={{ y: 12, duration: 200 }}
		class="absolute right-2 z-50 flex max-h-[70dvh] w-[min(92vw,26rem)] flex-col overflow-hidden rounded-lg bg-glass/90 shadow-lg backdrop-blur-md md:right-2"
		style:bottom="max(7.5rem, calc(var(--om-credit-bottom) + var(--om-credit-height) + 0.5rem))"
	>
		<header class="flex items-center justify-between border-b px-3 py-2">
			<div class="min-w-0">
				<h2 class="text-sm font-semibold">Historical analysis</h2>
				{#if panel.gridLatitude !== undefined && panel.gridLongitude !== undefined}
					<p class="truncate text-[0.7rem] opacity-70">
						{formatCoordinate(panel.gridLatitude, 'latitude')}, {formatCoordinate(
							panel.gridLongitude,
							'longitude'
						)}
						{#if panel.elevation !== undefined}· {Math.round(panel.elevation)} m{/if}
					</p>
				{/if}
			</div>
			<button
				onclick={closeArchive}
				class="shrink-0 rounded p-1 hover:bg-black/10 dark:hover:bg-white/15"
				aria-label="Close historical analysis"
			>
				<X size={16} />
			</button>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto">
			<!-- controls -->
			<div class="space-y-2 border-b px-3 py-2">
				<label class="block">
					<span class="text-[0.7rem] opacity-70">Variable</span>
					<select
						class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
						value={panel.variable}
						onchange={(e) => selectVariable(e.currentTarget.value)}
					>
						{#each availableVariables as v (v.name)}
							<option value={v.name}>{v.label}</option>
						{/each}
					</select>
				</label>

				{#if variable?.endpoint === 'archive'}
					<label class="block">
						<span class="text-[0.7rem] opacity-70">
							Model {#if modelInfo?.resolution}({modelInfo.resolution}°){/if}
						</span>
						<select
							class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
							value={panel.model}
							onchange={(e) => selectModel(e.currentTarget.value as ArchiveModel)}
						>
							{#each ARCHIVE_MODELS as m (m.value)}
								<option value={m.value}>
									{m.label} · from {m.firstAvailableDate ?? m.startYear}
								</option>
							{/each}
						</select>
					</label>
					{#if modelInfo?.note}
						<p class="text-[0.65rem] leading-tight opacity-60">{modelInfo.note}</p>
					{/if}
				{:else}
					<div class="rounded border px-2 py-1.5 text-[0.65rem] leading-tight">
						<span class="opacity-60">Data source</span>
						<p>
							{#if variable?.endpoint === 'marine'}
								{variable.models === 'era5_ocean'
									? 'ERA5-Ocean reanalysis'
									: 'Open-Meteo marine best match'}
							{:else}
								CAMS global reanalysis
							{/if}
						</p>
						{#if variable?.note}
							<p class="mt-0.5 opacity-60">{variable.note}</p>
						{/if}
					</div>
				{/if}

				<div class="flex items-end gap-2">
					<label class="flex-1">
						<span class="text-[0.7rem] opacity-70">From</span>
						<input
							type="number"
							min={minYear}
							max={maxYear}
							class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
							value={panel.startYear}
							onchange={(e) => setArchivePeriod(Number(e.currentTarget.value), panel.endYear)}
						/>
					</label>
					<label class="flex-1">
						<span class="text-[0.7rem] opacity-70">To</span>
						<input
							type="number"
							min={minYear}
							max={maxYear}
							class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
							value={panel.endYear}
							onchange={(e) => setArchivePeriod(panel.startYear, Number(e.currentTarget.value))}
						/>
					</label>
				</div>

				<button
					onclick={analyseMapCentre}
					class="w-full rounded border px-2 py-1 text-xs hover:bg-black/10 dark:hover:bg-white/15"
				>
					Analyse map centre
				</button>
			</div>

			<!-- view tabs -->
			<div class="flex border-b text-xs">
				{#each visibleViews as option (option.key)}
					<button
						onclick={() => (view = option.key)}
						class="flex-1 px-2 py-1.5 {view === option.key
							? 'border-b-2 font-semibold'
							: 'opacity-60'}"
					>
						{option.label}
					</button>
				{/each}
			</div>
			{#if !canShowAnomaly}
				<p class="px-3 pt-1 text-[0.65rem] opacity-60">
					Anomaly view needs a complete 1991–2020 baseline, which this source does not cover.
				</p>
			{/if}

			<div class="space-y-3 px-3 py-2">
				{#if panel.status === 'loading'}
					<div class="space-y-2" in:fade>
						{#each [0, 1, 2, 3] as row (row)}
							<div class="h-3 w-full animate-pulse rounded bg-black/10 dark:bg-white/10"></div>
						{/each}
						<p class="text-[0.7rem] opacity-60">
							Loading {modelInfo?.kind === 'model' ? 'forecast archive' : 'reanalysis'}…
						</p>
					</div>
				{:else if panel.status === 'error'}
					<p class="rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
						{panel.error}
					</p>
				{:else if panel.series && panel.series.points.length === 0}
					<p class="text-xs opacity-70">No data for this location and period.</p>
				{:else if panel.series}
					<!-- period and coverage -->
					<div class="flex flex-wrap justify-between gap-1 text-[0.7rem] opacity-70">
						<span>
							{panel.startYear}–{panel.endYear}
							· {panel.series.resolution === 'daily' ? 'daily' : 'hourly'}
						</span>
						<span>
							{panel.series.points.length.toLocaleString()} of
							{panel.series.totalCount.toLocaleString()} values
						</span>
					</div>
					{#if panel.series.missingCount > 0}
						<p class="text-[0.65rem] text-amber-700 dark:text-amber-300">
							{panel.series.missingCount.toLocaleString()} missing values were skipped.
						</p>
					{/if}

					{#if view === 'annual' && annual}
						<!-- annual means chart -->
						{@const ann = annual}
						{@const w = 320}
						{@const h = 150}
						{@const pad = { l: 34, r: 8, t: 8, b: 20 }}
						{@const lo = Math.min(...ann.values, ann.summary?.min ?? 0)}
						{@const hi = Math.max(...ann.values, ann.summary?.max ?? 1)}
						{@const span = hi - lo || 1}
						{@const x = (i: number) =>
							pad.l + (i / Math.max(1, ann.values.length - 1)) * (w - pad.l - pad.r)}
						{@const y = (v: number) => pad.t + (1 - (v - lo) / span) * (h - pad.t - pad.b)}
						{@const meanY = ann.summary ? y(ann.summary.mean) : null}
						<svg viewBox={`0 0 ${w} ${h}`} class="w-full" role="img" aria-label="Annual mean">
							{#each [0, 0.5, 1] as f (f)}
								{@const vy = pad.t + f * (h - pad.t - pad.b)}
								{@const vval = hi - f * span}
								<line x1={pad.l} y1={vy} x2={w - pad.r} y2={vy} class="stroke-current opacity-15" />
								<text
									x={pad.l - 4}
									y={vy + 3}
									text-anchor="end"
									class="fill-current text-[8px] opacity-60"
								>
									{vval.toFixed(span < 5 ? 1 : 0)}
								</text>
							{/each}

							{#if meanY !== null}
								<line
									x1={pad.l}
									y1={meanY}
									x2={w - pad.r}
									y2={meanY}
									class="stroke-current opacity-40"
									stroke-dasharray="3 3"
								/>
							{/if}

							{#if ann.regression}
								{@const t0 = Date.UTC(ann.years[0], 0, 1)}
								{@const t1 = Date.UTC(ann.years[ann.years.length - 1], 0, 1)}
								{@const p0 = ann.regression.slopePerYear * t0 + ann.regression.intercept}
								{@const p1 = ann.regression.slopePerYear * t1 + ann.regression.intercept}
								<line
									x1={x(0)}
									y1={y(p0)}
									x2={x(ann.values.length - 1)}
									y2={y(p1)}
									class="stroke-red-500"
									stroke-width="1.5"
								/>
							{/if}

							<path
								d={ann.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ')}
								fill="none"
								class="stroke-sky-500"
								stroke-width="1.5"
							/>
							{#each ann.values as v, i (i)}
								<circle cx={x(i)} cy={y(v)} r="1.6" class="fill-sky-500">
									<title>{ann.years[i]}: {v.toFixed(2)} {panel.series.unit}</title>
								</circle>
							{/each}

							<text x={pad.l} y={h - 6} class="fill-current text-[8px] opacity-60"
								>{ann.years[0]}</text
							>
							<text
								x={w - pad.r}
								y={h - 6}
								text-anchor="end"
								class="fill-current text-[8px] opacity-60"
							>
								{ann.years[ann.years.length - 1]}
							</text>
						</svg>
						<p class="text-right text-[0.65rem] opacity-60">{panel.series.unit}</p>

						{#if ann.summary}
							{@const thirdChange = ann.summary.lastThirdMean - ann.summary.firstThirdMean}
							<dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-[0.7rem]">
								<dt class="opacity-60">Period mean</dt>
								<dd class="text-right font-medium">
									{ann.summary.mean.toFixed(2)}
									{panel.series.unit}
								</dd>
								<dt class="opacity-60">First third</dt>
								<dd class="text-right font-medium">{ann.summary.firstThirdMean.toFixed(2)}</dd>
								<dt class="opacity-60">Last third</dt>
								<dd class="text-right font-medium">{ann.summary.lastThirdMean.toFixed(2)}</dd>
								<dt class="opacity-60">Last − first third</dt>
								<dd class="text-right font-medium">
									{thirdChange >= 0 ? '+' : ''}{thirdChange.toFixed(2)}
									{panel.series.unit}
								</dd>
							</dl>
						{/if}

						{#if ann.regression}
							<div class="rounded border px-2 py-1.5">
								<h3 class="text-[0.7rem] font-semibold opacity-80">Linear trend</h3>
								<dl class="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.7rem]">
									<dt class="opacity-60">Per decade</dt>
									<dd class="text-right font-medium">
										{ann.regression.slopePerDecade >= 0
											? '+'
											: ''}{ann.regression.slopePerDecade.toFixed(3)}
										{panel.series.unit}
									</dd>
									<dt class="opacity-60">R²</dt>
									<dd class="text-right font-medium">{ann.regression.r2.toFixed(3)}</dd>
									<dt class="opacity-60">p-value</dt>
									<dd class="text-right font-medium">
										{Number.isFinite(ann.regression.pValue)
											? ann.regression.pValue < 0.001
												? '< 0.001'
												: ann.regression.pValue.toFixed(3)
											: 'n/a'}
									</dd>
									<dt class="opacity-60">Significance</dt>
									<dd class="text-right font-medium">
										{#if ann.regression.pValue < 0.05}
											<span class="text-red-600 dark:text-red-400">significant</span>
										{:else}
											not significant
										{/if}
									</dd>
								</dl>
							</div>
						{/if}

						{#if ann.kendall}
							<div class="rounded border px-2 py-1.5">
								<h3 class="text-[0.7rem] font-semibold opacity-80">
									Mann-Kendall <span class="font-normal opacity-60">(distribution-free)</span>
								</h3>
								<dl class="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.7rem]">
									<dt class="opacity-60">Sen's slope</dt>
									<dd class="text-right font-medium">
										{ann.kendall.senSlopePerYear >= 0 ? '+' : ''}{(
											ann.kendall.senSlopePerYear * 10
										).toFixed(3)}
										{panel.series.unit}/decade
									</dd>
									<dt class="opacity-60">z</dt>
									<dd class="text-right font-medium">{ann.kendall.z.toFixed(2)}</dd>
									<dt class="opacity-60">Verdict</dt>
									<dd class="text-right font-medium">
										{ann.kendall.significant ? 'significant' : 'not significant'}
									</dd>
								</dl>
							</div>
						{/if}
					{:else if view === 'annual'}
						<p class="text-xs opacity-70">
							Need at least two complete years. Widen the period, or check that this variable has
							data for this model.
						</p>
					{:else if view === 'series' && series}
						{@const w = 320}
						{@const h = 120}
						{@const pad = { l: 34, r: 8, t: 8, b: 18 }}
						{@const lo = Math.min(...series.map((p) => p.value))}
						{@const hi = Math.max(...series.map((p) => p.value))}
						{@const span = hi - lo || 1}
						{@const t0 = series[0].time}
						{@const t1 = series[series.length - 1].time}
						{@const x = (t: number) =>
							pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (w - pad.l - pad.r)}
						{@const y = (v: number) => pad.t + (1 - (v - lo) / span) * (h - pad.t - pad.b)}
						<svg viewBox={`0 0 ${w} ${h}`} class="w-full" role="img" aria-label="Hourly series">
							<line
								x1={pad.l}
								y1={pad.t}
								x2={pad.l}
								y2={h - pad.b}
								class="stroke-current opacity-25"
							/>
							<line
								x1={pad.l}
								y1={h - pad.b}
								x2={w - pad.r}
								y2={h - pad.b}
								class="stroke-current opacity-25"
							/>
							<text
								x={pad.l - 4}
								y={pad.t + 3}
								text-anchor="end"
								class="fill-current text-[8px] opacity-60"
							>
								{hi.toFixed(span < 5 ? 1 : 0)}
							</text>
							<text
								x={pad.l - 4}
								y={h - pad.b}
								text-anchor="end"
								class="fill-current text-[8px] opacity-60"
							>
								{lo.toFixed(span < 5 ? 1 : 0)}
							</text>
							<path
								d={series
									.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.time)},${y(p.value)}`)
									.join(' ')}
								fill="none"
								class="stroke-sky-500"
								stroke-width="0.8"
							/>
							<text x={pad.l} y={h - 5} class="fill-current text-[8px] opacity-60"
								>{compactDate.format(t0)}</text
							>
							<text
								x={w - pad.r}
								y={h - 5}
								text-anchor="end"
								class="fill-current text-[8px] opacity-60"
							>
								{compactDate.format(t1)}
							</text>
						</svg>
						<p class="text-right text-[0.65rem] opacity-60">
							{panel.series.unit} · {series.length.toLocaleString()} of
							{panel.series.points.length.toLocaleString()} points drawn
						</p>

						{#if statistics}
							<dl class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.7rem]">
								<dt class="opacity-60">Mean</dt>
								<dd class="text-right font-medium">
									{statistics.mean.toFixed(2)}
									{panel.series.unit}
								</dd>
								<dt class="opacity-60">Std dev</dt>
								<dd class="text-right font-medium">{statistics.stdDev.toFixed(2)}</dd>
								<dt class="opacity-60">Min / max</dt>
								<dd class="text-right font-medium">
									{statistics.min.toFixed(1)} / {statistics.max.toFixed(1)}
								</dd>
								<dt class="opacity-60">5th–95th pct</dt>
								<dd class="text-right font-medium">
									{statistics.p5.toFixed(1)}–{statistics.p95.toFixed(1)}
								</dd>
								<dt class="opacity-60">Median</dt>
								<dd class="text-right font-medium">{statistics.p50.toFixed(2)}</dd>
							</dl>
						{/if}
					{:else if view === 'anomaly'}
						{#if climatologyLoading}
							<p class="text-xs opacity-70">
								Building the {panel.climatologyStartYear}–{panel.climatologyEndYear} normal…
							</p>
						{:else if climatologyError}
							<p class="rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
								{climatologyError}
							</p>
						{:else if anomalies}
							{@const an = anomalies}
							{@const aw = 320}
							{@const ah = 120}
							{@const apad = { l: 34, r: 8, t: 8, b: 20 }}
							{@const absMax = Math.max(0.1, ...an.values.map(Math.abs))}
							{@const ax = (i: number) =>
								apad.l + (i / Math.max(1, an.values.length - 1)) * (aw - apad.l - apad.r)}
							{@const ay = (v: number) =>
								apad.t + (0.5 - v / (2 * absMax)) * (ah - apad.t - apad.b)}
							<svg viewBox={`0 0 ${aw} ${ah}`} class="w-full" role="img" aria-label="Anomaly">
								{#each [-1, 0, 1] as k (k)}
									{@const vy = ay(k * absMax)}
									<line
										x1={apad.l}
										y1={vy}
										x2={aw - apad.r}
										y2={vy}
										class="stroke-current opacity-20"
									/>
									<text
										x={apad.l - 4}
										y={vy + 3}
										text-anchor="end"
										class="fill-current text-[8px] opacity-60"
									>
										{(k * absMax).toFixed(1)}
									</text>
								{/each}
								{#each an.values as v, i (i)}
									<rect
										x={ax(i) - 1.5}
										y={Math.min(ay(0), ay(v))}
										width="3"
										height={Math.max(1, Math.abs(ay(v) - ay(0)))}
										class={v >= 0 ? 'fill-red-500' : 'fill-sky-500'}
									>
										<title
											>{an.years[i]}: {v >= 0 ? '+' : ''}{v.toFixed(2)} {panel.series.unit}</title
										>
									</rect>
								{/each}
								<text x={apad.l} y={ah - 5} class="fill-current text-[8px] opacity-60"
									>{an.years[0]}</text
								>
								<text
									x={aw - apad.r}
									y={ah - 5}
									text-anchor="end"
									class="fill-current text-[8px] opacity-60"
								>
									{an.years[an.years.length - 1]}
								</text>
							</svg>
							<p class="text-right text-[0.65rem] opacity-60">
								{panel.series.unit} vs {panel.climatologyStartYear}–{panel.climatologyEndYear} normal
							</p>
							{@const posYears = an.values.filter((v) => v > 0).length}
							<p class="text-[0.7rem]">
								<span class="text-red-600 dark:text-red-400">{posYears}</span> of
								{an.values.length} years above the normal.
							</p>
						{:else}
							<p class="text-xs opacity-70">Not enough overlapping days to build an anomaly.</p>
						{/if}
					{/if}
				{:else}
					<p class="text-xs opacity-70">Open the panel and pick a location to begin.</p>
				{/if}
			</div>
		</div>

		<footer class="border-t px-3 py-1.5 text-[0.65rem] leading-tight opacity-60">
			{#if variable?.endpoint === 'archive' && modelInfo}
				{modelInfo.label}
				{modelInfo.kind === 'reanalysis' ? 'reanalysis' : 'archived forecast model data'} from
				<a
					href={modelInfo.kind === 'reanalysis'
						? 'https://open-meteo.com/en/docs/historical-weather-api'
						: 'https://open-meteo.com/en/docs/historical-forecast-api'}
					class="underline"
					rel="noreferrer"
					target="_blank">Open-Meteo</a
				>. {modelInfo.kind === 'reanalysis'
					? 'Model reanalysis, not station observations.'
					: 'Archived model forecasts, not climate reanalysis.'}
			{:else if variable?.endpoint === 'marine'}
				{variable.models === 'era5_ocean' ? 'ERA5-Ocean' : 'Open-Meteo marine best match'} data from
				<a
					href="https://open-meteo.com/en/docs/marine-weather-api"
					class="underline"
					rel="noreferrer"
					target="_blank">Open-Meteo</a
				>.
			{:else}
				CAMS global reanalysis from
				<a
					href="https://open-meteo.com/en/docs/air-quality-api"
					class="underline"
					rel="noreferrer"
					target="_blank">Open-Meteo</a
				>.
			{/if}
		</footer>
	</aside>
{/if}
