<script lang="ts">
	import { onMount } from 'svelte';

	import BookOpen from '@lucide/svelte/icons/book-open';
	import CloudSun from '@lucide/svelte/icons/cloud-sun';
	import Leaf from '@lucide/svelte/icons/leaf';
	import MapIcon from '@lucide/svelte/icons/map';
	import Mountain from '@lucide/svelte/icons/mountain-snow';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Sprout from '@lucide/svelte/icons/sprout';
	import Waves from '@lucide/svelte/icons/waves';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { replaceState } from '$app/navigation';
	import { base } from '$app/paths';

	import FarmerStory from '$lib/components/trend/farmer-story.svelte';
	import RegionMap from '$lib/components/trend/region-map.svelte';
	import ResultsView from '$lib/components/trend/results-view.svelte';
	import SiteHeader from '$lib/components/trend/site-header.svelte';

	import {
		EARTH_SYSTEMS,
		SEASONS,
		type SystemId,
		VARIABLES,
		seasonById,
		variableById,
		variablesForSystem
	} from '$lib/trend/catalog';
	import { REGIONS, type Region, formatLat, formatLon, regionById } from '$lib/trend/regions';
	import {
		type Analysis,
		type Comparison,
		compareSuggestions,
		compareVariables,
		regionsFor,
		runAnalysis
	} from '$lib/trend/run';
	import {
		DEFAULT_SELECTION,
		type Mode,
		type Preset,
		QUICK_STARTS,
		type Selection,
		parseSelection,
		selectionQuery
	} from '$lib/trend/state';

	const SYSTEM_ICONS = {
		biosphere: Leaf,
		climate: CloudSun,
		cryosphere: Mountain,
		land: Sprout,
		ocean: Waves
	} as const;

	let sel = $state<Selection>({ ...DEFAULT_SELECTION });
	let ready = $state(false);
	let showFarmer = $state(false);
	let showMap = $state(false);

	let status = $state<'loading' | 'done' | 'error'>('loading');
	let errorMessage = $state('');
	let analysis = $state<Analysis | null>(null);
	let comparison = $state<Comparison | null>(null);
	let compareState = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	let available = $state<{ first: number; last: number } | null>(null);
	let retry = $state(0);
	let shareUrl = $state('');

	const assetBase = $derived(typeof location === 'undefined' ? base : `${location.origin}${base}`);

	const variable = $derived(
		variableById(sel.variableId) ?? variableById(DEFAULT_SELECTION.variableId)!
	);
	const systemId = $derived(variable.system);
	const system = $derived(EARTH_SYSTEMS.find((s) => s.id === systemId)!);
	const allowedRegions = $derived(regionsFor(variable));
	const allowedIds = $derived(new Set(allowedRegions.map((r) => r.id)));
	const region = $derived<Region>(regionById(sel.regionId) ?? allowedRegions[0]);
	const season = $derived(seasonById(sel.seasonId));
	const regionGroups = $derived.by(() => {
		// Local, non-reactive scratch map: rebuilt on every derivation.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const groups = new Map<string, Region[]>();
		for (const r of allowedRegions) {
			const list = groups.get(r.group) ?? [];
			list.push(r);
			groups.set(r.group, list);
		}
		return [...groups];
	});
	const canTapMap = $derived(variable.source.kind !== 'regional');

	const yearOptions = $derived.by(() => {
		if (!available) return [];
		const out: number[] = [];
		for (let y = available.first; y <= available.last; y++) out.push(y);
		return out;
	});

	const INTRO_KEY = 'trend-intro-dismissed';
	// Rendered into the static page so it never pushes the page down after load;
	// app.html hides it before the first paint when it is not needed.
	let showIntro = $state(true);
	const namedRegions = REGIONS.filter((r) => r.group !== 'Custom').length;
	const firstYear = Math.min(...VARIABLES.map((v) => v.dataset.firstYear));

	function dismissIntro() {
		showIntro = false;
		try {
			localStorage.setItem(INTRO_KEY, '1');
		} catch {
			// private mode: the tour simply shows again next time
		}
	}

	onMount(() => {
		sel = normalise(parseSelection(new URLSearchParams(location.search)));
		ready = true;
		try {
			showIntro = !location.search && localStorage.getItem(INTRO_KEY) !== '1';
		} catch {
			showIntro = false;
		}
		if (new URLSearchParams(location.search).get('story') === 'farmer') showFarmer = true;
	});

	/** Keep the region valid for the variable (switching to its preferred region when not). */
	function normalise(next: Selection): Selection {
		const v = variableById(next.variableId) ?? variableById(DEFAULT_SELECTION.variableId)!;
		const ok = regionsFor(v);
		const r = regionById(next.regionId);
		const fits =
			r &&
			(ok.some((x) => x.id === r.id) || (r.group === 'Custom' && v.source.kind !== 'regional'));
		if (!fits) {
			const preferred = v.preferredRegion && ok.find((x) => x.id === v.preferredRegion);
			next = { ...next, regionId: (preferred || ok[0])?.id ?? next.regionId };
		}
		return { ...next, variableId: v.id };
	}

	function update(patch: Partial<Selection>, keepYears = false) {
		const next = normalise({ ...sel, ...patch });
		if (!keepYears && (patch.variableId || patch.regionId)) {
			// A new dataset has its own record length: start from its full span.
			if (patch.from === undefined) next.from = undefined;
			if (patch.to === undefined) next.to = undefined;
		}
		sel = next;
	}

	function chooseSystem(id: SystemId) {
		if (id === systemId) return;
		const first = variablesForSystem(id)[0];
		// A new Earth system is a new question: open it where its data means the
		// most (snow in the Himalaya, sea ice in the Arctic), not where we were.
		// Without a preferred region, keep a Bangladesh region or tapped point the
		// user chose, and come back to Bangladesh from the Himalaya, Bay or Arctic.
		const keep = region.group === 'Bangladesh' || region.group === 'Custom';
		update({
			variableId: first.id,
			regionId: first.preferredRegion ?? (keep ? region.id : 'bangladesh')
		});
	}

	function applyPreset(p: Preset) {
		sel = normalise({ ...p.selection, mode: sel.mode });
		showFarmer = false;
		requestAnimationFrame(() =>
			document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		);
	}

	// Write the selection to the address bar, so every result is a shareable link.
	$effect(() => {
		if (!ready) return;
		const query = selectionQuery(sel);
		const url = `${location.pathname}?${query}`;
		shareUrl = `${location.origin}${url}`;
		try {
			replaceState(url, {});
		} catch {
			history.replaceState(history.state, '', url);
		}
	});

	// Run the analysis whenever the selection (but not the mode) changes.
	$effect(() => {
		if (!ready) return;
		const req = {
			variable,
			region,
			season,
			from: sel.from,
			to: sel.to,
			assetBase
		};
		void retry;
		const controller = new AbortController();
		status = 'loading';
		comparison = null;
		compareState = 'idle';
		runAnalysis({ ...req, signal: controller.signal })
			.then((result) => {
				analysis = result;
				available = result.available;
				status = 'done';
				const related = compareSuggestions(result.variable, result.region).slice(0, 3);
				if (!related.length) return;
				compareState = 'loading';
				return compareVariables(result, related, assetBase, controller.signal).then(
					(c) => {
						comparison = c;
						compareState = 'done';
					},
					(e) => {
						if ((e as Error).name !== 'AbortError') compareState = 'error';
					}
				);
			})
			.catch((e) => {
				if ((e as Error).name === 'AbortError') return;
				errorMessage = (e as Error).message || 'Something went wrong.';
				status = 'error';
			});
		return () => controller.abort();
	});

	const sites = $derived(analysis?.data.sample?.sites ?? []);

	function setMode(m: Mode) {
		sel = { ...sel, mode: m };
	}
</script>

<svelte:head>
	<title
		>Earth System Trend Explorer by DIVERGENT · Find what changes. Understand what matters.</title
	>
</svelte:head>

<div class="trend-app bg-background text-foreground min-h-dvh">
	<a
		href="#controls"
		class="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
		>Skip to the explorer</a
	>
	<SiteHeader current="explorer" />

	<main class="mx-auto max-w-6xl px-3 pb-16 sm:px-5">
		<!-- Intro -->
		<section class="pt-5 pb-4 sm:pt-8" aria-labelledby="intro-title">
			<p class="text-xs font-semibold tracking-wider text-eyebrow uppercase">
				NASA Space Apps Challenge 2026 · Team DIVERGENT · Rajshahi, Bangladesh
			</p>
			<h1 id="intro-title" class="mt-1 text-2xl font-bold tracking-tight text-balance sm:text-4xl">
				Find what changes. Understand what matters.
			</h1>
			<p class="text-muted-foreground mt-2 max-w-3xl text-[0.95rem] sm:text-base">
				Pick an Earth system, a variable, a place and a time period. We test 45 years of NASA Earth
				observations and answer: what is changing, where, how much, when the major change happened,
				whether it is statistically significant, and how reliable it is.
			</p>
			<ul class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="What the explorer covers">
				{#each [{ n: String(EARTH_SYSTEMS.length), l: 'Earth systems' }, { n: String(VARIABLES.length), l: 'variables' }, { n: String(namedRegions), l: 'regions + any point' }, { n: `${firstYear}–${new Date().getFullYear()}`, l: 'years covered' }] as stat (stat.l)}
					<li class="flex items-baseline gap-1.5">
						<span class="text-foreground text-lg font-semibold tabular-nums">{stat.n}</span>
						<span class="text-muted-foreground">{stat.l}</span>
					</li>
				{/each}
			</ul>
			<div class="mt-4 flex flex-wrap gap-2">
				<button
					type="button"
					class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
					onclick={() => (showFarmer = !showFarmer)}
					aria-expanded={showFarmer}
				>
					<Sprout class="size-4" aria-hidden="true" />
					{showFarmer ? 'Hide the farmer story' : 'Farmer story: rain, soil, crops'}
				</button>
				<a
					href={`${base}/about`}
					class="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium"
				>
					<BookOpen class="size-4" aria-hidden="true" />How it works
				</a>
			</div>
			{#if showIntro}
				<div
					class="bg-brand-soft text-brand-ink trend-enter mt-4 rounded-xl border border-transparent p-4"
					role="region"
					aria-label="Quick tour"
					data-intro
				>
					<div class="flex items-start justify-between gap-3">
						<p class="font-semibold">New here? Three steps</p>
						<button
							type="button"
							class="-m-2 min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold underline-offset-4 hover:underline"
							onclick={dismissIntro}>Got it</button
						>
					</div>
					<ol class="mt-1 grid gap-3 text-sm sm:grid-cols-3">
						{#each ['Pick an Earth system and a variable, then a place from the list or tap the map.', 'Read the answer: the headline, the six questions and the chart with its trend line.', 'Check “How sure are we?”, then share the link or save a one-page report.'] as step, i (i)}
							<li class="flex gap-2.5">
								<span
									class="bg-primary text-primary-foreground grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold"
									aria-hidden="true">{i + 1}</span
								>
								<span>{step}</span>
							</li>
						{/each}
					</ol>
				</div>
			{/if}
			<div class="mt-4">
				<p class="text-muted-foreground mb-1.5 text-xs font-medium">Try a question</p>
				<div class="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
					{#each QUICK_STARTS as q (q.id)}
						{@const active =
							sel.variableId === q.selection.variableId &&
							sel.regionId === q.selection.regionId &&
							sel.seasonId === q.selection.seasonId}
						<button
							type="button"
							class="min-h-11 shrink-0 rounded-full border px-3.5 text-sm transition-colors {active
								? 'border-brand bg-brand-soft text-brand-ink font-semibold'
								: 'hover:bg-accent'}"
							aria-pressed={active}
							onclick={() => applyPreset(q)}>{q.question}</button
						>
					{/each}
				</div>
			</div>
		</section>

		{#if showFarmer && ready}
			<div class="mb-5">
				<FarmerStory {assetBase} onopen={applyPreset} onclose={() => (showFarmer = false)} />
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-5 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
			<!-- Controls -->
			<section
				id="controls"
				class="bg-card space-y-4 rounded-xl border p-4 shadow-sm lg:sticky lg:top-[4.25rem]"
				aria-label="Choose what to analyse"
			>
				<div class="bg-muted grid grid-cols-2 rounded-lg p-1" role="group" aria-label="View">
					{#each [{ id: 'everyday', label: 'Everyday' }, { id: 'research', label: 'Research' }] as m (m.id)}
						<button
							type="button"
							class="min-h-11 rounded-md text-sm font-semibold transition-colors {sel.mode === m.id
								? 'bg-card text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/10'
								: 'text-muted-foreground'}"
							aria-pressed={sel.mode === m.id}
							onclick={() => setMode(m.id as Mode)}>{m.label}</button
						>
					{/each}
				</div>
				<p class="text-muted-foreground -mt-2 text-xs">
					{sel.mode === 'everyday'
						? 'Plain words and simple charts, for farmers, students and citizens.'
						: 'Full statistics, maps of change, second dataset and test details.'}
				</p>

				<fieldset>
					<legend class="text-sm font-semibold"
						><span class="text-muted-foreground">1.</span> Earth system</legend
					>
					<div class="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-3">
						{#each EARTH_SYSTEMS as s (s.id)}
							{@const Icon = SYSTEM_ICONS[s.id]}
							<button
								type="button"
								class="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium transition-colors {systemId ===
								s.id
									? 'border-brand bg-brand-soft text-brand-ink'
									: 'hover:bg-accent'}"
								aria-pressed={systemId === s.id}
								onclick={() => chooseSystem(s.id)}
							>
								<Icon class="size-5" aria-hidden="true" />
								{s.name === 'Land Surface' ? 'Land' : s.name}
							</button>
						{/each}
					</div>
					<p class="text-muted-foreground mt-1.5 text-xs">
						{sel.mode === 'everyday' ? system.everyday : system.description}
					</p>
				</fieldset>

				<div>
					<label for="variable" class="text-sm font-semibold"
						><span class="text-muted-foreground">2.</span> Variable</label
					>
					<select
						id="variable"
						class="bg-background mt-1.5 min-h-11 w-full rounded-lg border px-3 text-sm"
						value={variable.id}
						onchange={(e) => update({ variableId: e.currentTarget.value })}
					>
						{#each variablesForSystem(systemId) as v (v.id)}
							<option value={v.id}>{v.name}{v.dataset.live ? '' : ' (sample)'}</option>
						{/each}
					</select>
					<p class="text-muted-foreground mt-1.5 text-xs">{variable.description}</p>
				</div>

				<div>
					<label for="region" class="text-sm font-semibold"
						><span class="text-muted-foreground">3.</span> Region</label
					>
					<select
						id="region"
						class="bg-background mt-1.5 min-h-11 w-full rounded-lg border px-3 text-sm"
						value={region.id}
						onchange={(e) => update({ regionId: e.currentTarget.value })}
					>
						{#if region.group === 'Custom'}
							<option value={region.id}
								>Point {formatLat(region.center[1])}, {formatLon(region.center[0])}</option
							>
						{/if}
						{#each regionGroups as [group, list] (group)}
							<optgroup label={group}>
								{#each list as r (r.id)}
									<option value={r.id}>{r.name}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
					<button
						type="button"
						class="hover:bg-accent mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium"
						aria-expanded={showMap}
						onclick={() => (showMap = !showMap)}
					>
						<MapIcon class="size-4" aria-hidden="true" />
						{showMap
							? 'Hide the map'
							: canTapMap
								? 'Choose on the map, or tap any point'
								: 'Show on the map'}
					</button>
					{#if showMap}
						<div class="mt-2">
							<RegionMap
								{region}
								allowed={allowedIds}
								{sites}
								overlay={variable.overlay}
								onselect={(id) => {
									if (id.startsWith('point:') && !canTapMap) return;
									update({ regionId: id });
								}}
							/>
						</div>
					{/if}
				</div>

				<fieldset>
					<legend class="text-sm font-semibold"
						><span class="text-muted-foreground">4.</span> Time period</legend
					>
					<label for="season" class="text-muted-foreground mt-1.5 block text-xs font-medium"
						>Season</label
					>
					<select
						id="season"
						class="bg-background mt-1 min-h-11 w-full rounded-lg border px-3 text-sm"
						value={sel.seasonId}
						onchange={(e) => update({ seasonId: e.currentTarget.value }, true)}
					>
						{#each SEASONS as s (s.id)}
							<option value={s.id}>{s.name}</option>
						{/each}
					</select>
					<div class="mt-2 grid grid-cols-2 gap-2">
						<div>
							<label for="from" class="text-muted-foreground block text-xs font-medium">From</label>
							<select
								id="from"
								class="bg-background mt-1 min-h-11 w-full rounded-lg border px-3 text-sm"
								disabled={!yearOptions.length}
								value={String(sel.from ?? analysis?.from ?? '')}
								onchange={(e) => update({ from: Number(e.currentTarget.value) }, true)}
							>
								{#each yearOptions as y (y)}
									<option value={String(y)} disabled={y > (sel.to ?? analysis?.to ?? 9999) - 7}
										>{y}</option
									>
								{/each}
							</select>
						</div>
						<div>
							<label for="to" class="text-muted-foreground block text-xs font-medium">To</label>
							<select
								id="to"
								class="bg-background mt-1 min-h-11 w-full rounded-lg border px-3 text-sm"
								disabled={!yearOptions.length}
								value={String(sel.to ?? analysis?.to ?? '')}
								onchange={(e) => update({ to: Number(e.currentTarget.value) }, true)}
							>
								{#each yearOptions as y (y)}
									<option value={String(y)} disabled={y < (sel.from ?? analysis?.from ?? 0) + 7}
										>{y}</option
									>
								{/each}
							</select>
						</div>
					</div>
					{#if sel.from !== undefined || sel.to !== undefined}
						<button
							type="button"
							class="text-muted-foreground mt-1 min-h-11 text-xs underline underline-offset-2"
							onclick={() => update({ from: undefined, to: undefined }, true)}
							>Use the full record</button
						>
					{/if}
				</fieldset>
			</section>

			<!-- Results -->
			<div
				id="results"
				class="min-w-0 scroll-mt-20"
				aria-live="polite"
				aria-busy={status === 'loading'}
			>
				{#if status === 'error'}
					<div class="bg-card rounded-xl border p-5" role="alert">
						<h2 class="font-semibold">This analysis could not be completed</h2>
						<p class="text-muted-foreground mt-1 text-sm">{errorMessage}</p>
						<div class="mt-3 flex flex-wrap gap-2">
							<button
								type="button"
								class="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
								onclick={() => retry++}
							>
								<RotateCw class="size-4" aria-hidden="true" />Try again
							</button>
							<button
								type="button"
								class="hover:bg-accent inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium"
								onclick={() => applyPreset(QUICK_STARTS[0])}>Back to the Bangladesh example</button
							>
						</div>
					</div>
				{:else if analysis}
					<div class:opacity-60={status === 'loading'} class="transition-opacity">
						{#if status === 'loading'}
							<p class="text-muted-foreground mb-2 text-sm" role="status">Updating…</p>
						{/if}
						<ResultsView
							{analysis}
							mode={sel.mode}
							{comparison}
							{compareState}
							{shareUrl}
							{assetBase}
						/>
					</div>
				{:else}
					<div class="space-y-4" role="status" aria-label="Loading the analysis">
						<div class="bg-card rounded-xl border p-5">
							<div class="bg-muted h-4 w-1/3 animate-pulse rounded"></div>
							<div class="bg-muted mt-3 h-6 w-4/5 animate-pulse rounded"></div>
							<div class="bg-muted mt-3 h-4 w-full animate-pulse rounded"></div>
							<div class="bg-muted mt-2 h-4 w-2/3 animate-pulse rounded"></div>
						</div>
						<div class="bg-card h-72 animate-pulse rounded-xl border"></div>
						<p class="text-muted-foreground text-sm">Loading NASA data and running the tests…</p>
					</div>
				{/if}
			</div>
		</div>
	</main>

	<footer class="border-t">
		<div class="text-muted-foreground mx-auto max-w-6xl space-y-1 px-3 py-6 text-xs sm:px-5">
			<p>
				Earth System Trend Explorer by team DIVERGENT for the NASA Space Apps Challenge 2026. Data:
				NASA POWER (MERRA-2, CERES), GPM IMERG, MODIS, GISTEMP, GIBS, NSIDC, with ERA5 and NOAA PSL
				as independent checks.
			</p>
			<p>
				NASA does not endorse this project. Trends describe the data, not their causes.
				<a class="underline underline-offset-2" href={`${base}/about`}>Methods and limitations</a> ·
				<a
					class="underline underline-offset-2"
					href="https://github.com/AKIBUZZAMAN-AKIB/nasa"
					rel="noopener">Source code</a
				>
				·
				<a class="underline underline-offset-2" href={`${base}/weather`}>Live weather map</a>
			</p>
		</div>
	</footer>
</div>
