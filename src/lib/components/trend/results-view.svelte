<script lang="ts">
	import { flushSync, onMount } from 'svelte';

	import Download from '@lucide/svelte/icons/download';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import Info from '@lucide/svelte/icons/info';
	import Printer from '@lucide/svelte/icons/printer';
	import Share2 from '@lucide/svelte/icons/share-2';
	import { mode as theme } from 'mode-watcher';
	import { toast } from 'svelte-sonner';

	import { analysisCsv, downloadChartPng, downloadCsv, slug } from '$lib/trend/export';
	import { compassPart, formatLat, formatLon } from '$lib/trend/regions';
	import {
		arrowFor,
		arrowsLine,
		associationSentence,
		capitalise,
		formatNumber,
		formatP,
		rateDecimals,
		seasonPhrase,
		signed,
		significanceLabel
	} from '$lib/trend/story';

	import CellMap from './cell-map.svelte';
	import DriverModel from './driver-model.svelte';
	import MonthBreakdown from './month-breakdown.svelte';
	import RegionCompare from './region-compare.svelte';
	import TrendChart, { type ChartSeries } from './trend-chart.svelte';

	import type { Analysis, Comparison } from '$lib/trend/run';
	import type { Mode } from '$lib/trend/state';

	interface Props {
		analysis: Analysis;
		mode: Mode;
		comparison?: Comparison | null;
		compareState: 'idle' | 'loading' | 'done' | 'error';
		shareUrl: string;
		assetBase: string;
	}

	let { analysis: a, mode, comparison = null, compareState, shareUrl, assetBase }: Props = $props();

	const hasMonthly = $derived(!a.data.annual && a.data.monthly.size >= 24);
	const printedOn = new Date().toISOString().slice(0, 10);

	function printReport() {
		window.print();
	}

	let chartBox: HTMLDivElement | undefined = $state();
	let showReference = $state(true);

	// The sections below the fold (season by season, compare two places) render one
	// idle moment after the headline and the chart, so the first answer paints sooner
	// on a phone. Printing renders them at once.
	let extrasReady = $state(false);
	onMount(() => {
		const show = () => (extrasReady = true);
		const beforePrint = () => flushSync(show);
		addEventListener('beforeprint', beforePrint);
		const idle = typeof requestIdleCallback === 'function';
		const id = idle ? requestIdleCallback(show, { timeout: 800 }) : 0;
		const timer = idle ? undefined : setTimeout(show, 50);
		return () => {
			removeEventListener('beforeprint', beforePrint);
			if (idle) cancelIdleCallback(id);
			clearTimeout(timer);
		};
	});

	const research = $derived(mode === 'research');
	const t = $derived(a.trend);
	const v = $derived(a.variable);
	const rel = $derived(a.reliability);
	const cp = $derived(t.changePoint);
	const rd = $derived(rateDecimals(v));
	const unit = $derived(v.unit);
	const periodLabel = $derived(`${t.firstYear}–${t.lastYear}`);
	const seasonText = $derived(a.season.id === 'annual' ? 'whole year' : a.season.name);

	const directionWord = $derived(
		t.direction === 'increasing'
			? 'Increasing'
			: t.direction === 'decreasing'
				? 'Decreasing'
				: 'No clear trend'
	);
	const directionTone = $derived(
		t.direction === 'no trend'
			? 'text-muted-foreground'
			: t.direction === 'increasing'
				? 'text-[var(--trend-up)]'
				: 'text-[var(--trend-down)]'
	);

	const trendLine = $derived({
		from: t.firstYear,
		to: t.lastYear,
		slope: t.slopePerYear,
		intercept: t.intercept
	});

	const segments = $derived.by(() => {
		const s = t.segmented;
		if (cp.kind !== 'rate' || !s) return [];
		const lastBefore = t.years[s.index];
		const firstAfter = t.years[s.index + 1];
		return [
			{ from: t.firstYear, to: lastBefore, slope: s.before.slope, intercept: s.before.intercept },
			{ from: firstAfter, to: t.lastYear, slope: s.after.slope, intercept: s.after.intercept }
		];
	});

	const extra = $derived.by((): ChartSeries[] => {
		if (!research || !showReference || !a.agreementSeries) return [];
		return [
			{
				label: a.agreementSeries.label,
				years: a.agreementSeries.series.years,
				values: a.agreementSeries.series.values,
				color: 'var(--trend-ref)',
				dashed: true
			}
		];
	});

	const where = $derived.by(() => {
		const sp = a.spatial;
		if (sp && sp.cells.length > 1) {
			const s = sp.strongest;
			const part = s ? compassPart(a.region, s.lon, s.lat) : '';
			const sig = sp.significantCount;
			const main =
				sig > 0
					? `${sig} of ${sp.cells.length} grid cells changed significantly`
					: `None of the ${sp.cells.length} grid cells changed significantly on its own`;
			const strongest = s
				? `strongest in the ${part === 'centre' ? 'centre' : part} (${formatLat(s.lat)}, ${formatLon(s.lon)}: ${signed(s.perDecade, rd)} ${unit}/decade)`
				: '';
			return { main, detail: strongest };
		}
		return {
			main: a.region.name,
			detail: a.data.sample
				? `From ${a.data.sample.sites.length} bundled sample site${a.data.sample.sites.length === 1 ? '' : 's'}`
				: 'One series for the whole area'
		};
	});

	const answers = $derived([
		{
			q: 'What is changing?',
			a: `${capitalise(v.everydayName)}: ${directionWord.toLowerCase()}`,
			d: `${v.name}, ${seasonText}`
		},
		{ q: 'Where?', a: where.main, d: where.detail },
		{
			q: 'How much?',
			a: `${signed(t.perDecade, rd)} ${unit} per decade`,
			d: `About ${signed(t.totalChange, v.decimals)} ${unit} over ${periodLabel}`
		},
		{
			q: 'When did the major change occur?',
			a: cp.year !== undefined ? `${cp.year}` : 'No clear change point',
			d:
				cp.year !== undefined ? `After ${cp.year}: ${cp.phrase}` : 'The change, if any, was gradual'
		},
		{
			q: 'Is it statistically significant?',
			a: significanceLabel(t),
			d: `Mann–Kendall (autocorrelation-corrected) p = ${formatP(t.hr.p)}`
		},
		{
			q: 'How reliable is it?',
			a: `Confidence: ${rel.confidence}`,
			d: `Coverage ${Math.round(rel.coverage * 100)}% · Agreement ${rel.agreement.level}`
		}
	]);

	const levelClass = (level: string) =>
		level === 'High'
			? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100'
			: level === 'Medium'
				? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
				: level === 'Low'
					? 'bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100'
					: 'bg-muted text-muted-foreground';

	const significanceLevel = $derived(
		t.evidence === 'very strong' || t.evidence === 'strong'
			? 'High'
			: t.evidence === 'weak'
				? 'Medium'
				: 'Low'
	);
	const coverageLevel = $derived(
		rel.coverage >= 0.9 ? 'High' : rel.coverage >= 0.7 ? 'Medium' : 'Low'
	);

	const sourceLines = $derived([
		`Data: ${v.dataset.name} (${v.dataset.provider}), ${v.dataset.resolution}; ${v.dataset.live ? 'live request' : `bundled sample, retrieved ${a.data.sample?.retrieved ?? ''}`}.`,
		`Trend: Sen's slope ${signed(t.perDecade, rd)} ${unit}/decade (95% CI ${signed(t.perDecadeLow, rd)} to ${signed(t.perDecadeHigh, rd)}); Mann–Kendall (Hamed–Rao) p = ${formatP(t.hr.p)}.`,
		'Earth System Trend Explorer by DIVERGENT · NASA Space Apps Challenge 2026'
	]);

	const baseName = $derived(slug(`${v.id}-${a.region.name}-${a.season.id}-${periodLabel}`));

	async function savePng() {
		const svg = chartBox?.querySelector('svg');
		if (!svg) return;
		try {
			await downloadChartPng(svg, {
				title: `${v.name}, ${a.region.name}`,
				subtitle: `${capitalise(seasonText)}, ${periodLabel} · ${directionWord}${cp.year !== undefined ? ` · change point ${cp.year}` : ''}`,
				footer: sourceLines,
				filename: `${baseName}.png`,
				dark: theme.current === 'dark'
			});
		} catch (e) {
			toast.error((e as Error).message);
		}
	}

	function saveCsv() {
		downloadCsv(analysisCsv(a, shareUrl), `${baseName}.csv`);
	}

	async function share() {
		const title = `${v.name}, ${a.region.name}`;
		try {
			if (navigator.share && matchMedia('(pointer: coarse)').matches) {
				await navigator.share({ title, text: a.story.headline, url: shareUrl });
				return;
			}
			await navigator.clipboard.writeText(shareUrl);
			toast.success('Link copied', { description: 'It opens this exact analysis.' });
		} catch (e) {
			if ((e as Error).name !== 'AbortError')
				toast.error('Could not copy the link. You can copy it from the address bar.');
		}
	}
</script>

<section aria-labelledby="result-headline" class="space-y-4">
	<div data-print-only class="border-b pb-3">
		<p class="text-lg font-semibold">Earth System Trend Explorer by DIVERGENT: result report</p>
		<p class="text-sm">Created {printedOn}. Reopen this analysis: {shareUrl}</p>
	</div>
	<!-- Story -->
	<div
		class="bg-card trend-enter relative overflow-hidden rounded-xl border p-4 shadow-sm sm:p-5"
		data-print-block
	>
		<div
			class="from-brand via-eyebrow absolute inset-x-0 top-0 h-1 bg-gradient-to-r to-transparent"
			aria-hidden="true"
		></div>
		<p class="text-eyebrow text-xs font-semibold tracking-wide uppercase">
			{a.region.name} · {capitalise(seasonPhrase(a.season).trim() || 'whole year')} · {periodLabel}
		</p>
		<h2
			id="result-headline"
			class="mt-1.5 text-xl leading-snug font-semibold tracking-tight text-balance sm:text-2xl"
		>
			{a.story.headline}
		</h2>
		<p class="mt-2 text-[0.95rem] leading-relaxed">
			{research ? a.story.research : a.story.everyday}
		</p>
		<div class="mt-3 flex flex-wrap gap-1.5" aria-label="Summary">
			<span class="rounded-full border px-2.5 py-1 text-xs font-medium">
				Trend: <span class={directionTone}>{directionWord} {arrowFor(t)}</span>
			</span>
			{#if cp.year !== undefined}
				<span class="rounded-full border px-2.5 py-1 text-xs font-medium"
					>Change point: {cp.year}</span
				>
				<span class="rounded-full border px-2.5 py-1 text-xs font-medium"
					>After {cp.year}: {capitalise(cp.phrase ?? '')}</span
				>
			{/if}
			<span class="rounded-full px-2.5 py-1 text-xs font-medium {levelClass(rel.confidence)}">
				Confidence: {rel.confidence}
			</span>
			<span
				class="rounded-full px-2.5 py-1 text-xs font-medium {v.dataset.live
					? 'bg-brand-soft text-brand-ink'
					: 'bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100'}"
			>
				{v.dataset.live ? 'Live NASA data' : 'Bundled sample data'}
			</span>
		</div>
	</div>

	<!-- The six questions -->
	<div class="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2 lg:grid-cols-3">
		{#each answers as item (item.q)}
			<div class="bg-card rounded-xl border p-3.5">
				<p class="text-muted-foreground text-xs font-medium">{item.q}</p>
				<p class="mt-0.5 font-semibold">{item.a}</p>
				<p class="text-muted-foreground mt-0.5 text-sm">{item.d}</p>
			</div>
		{/each}
	</div>

	<!-- Chart -->
	<div class="bg-card rounded-xl border p-3 shadow-sm sm:p-4">
		<div class="flex flex-wrap items-start justify-between gap-2">
			<div class="min-w-0">
				<h3 class="font-semibold">
					{research ? 'Yearly series, trend and change point' : 'How it changed, year by year'}
				</h3>
				<p class="text-muted-foreground text-sm">
					{v.name} ({unit}), {seasonText}. Orange line: trend{cp.kind === 'rate'
						? '; purple: change point'
						: ''}.
				</p>
			</div>
		</div>
		<div class="mt-3" bind:this={chartBox} data-print-block>
			<TrendChart
				years={a.series.years}
				values={a.series.values}
				{unit}
				decimals={v.decimals}
				label={`${v.name} in ${a.region.name}, ${periodLabel}: ${directionWord}${cp.year !== undefined ? `, change point ${cp.year}` : ''}`}
				{trendLine}
				{segments}
				changeYear={cp.year}
				{extra}
				simple={!research}
			/>
		</div>
		<div class="mt-3 grid grid-cols-2 gap-2 min-[440px]:grid-cols-4" data-no-print>
			<button
				type="button"
				class="hover:bg-accent inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium"
				onclick={share}
			>
				<Share2 class="size-4" aria-hidden="true" />Share
			</button>
			<button
				type="button"
				class="hover:bg-accent inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium"
				onclick={savePng}
			>
				<Download class="size-4" aria-hidden="true" />PNG
			</button>
			<button
				type="button"
				class="hover:bg-accent inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium"
				onclick={saveCsv}
			>
				<FileSpreadsheet class="size-4" aria-hidden="true" />CSV
			</button>
			<button
				type="button"
				class="hover:bg-accent inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium"
				onclick={printReport}
			>
				<Printer class="size-4" aria-hidden="true" />Report
			</button>
		</div>
		{#if research && a.agreementSeries}
			<label class="mt-2 inline-flex min-h-11 items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="accent-primary size-5 shrink-0"
					bind:checked={showReference}
				/>
				Show the second dataset ({a.agreementSeries.label}, dashed)
			</label>
		{/if}
	</div>

	<!-- Reliability -->
	<div class="bg-card rounded-xl border p-4 shadow-sm">
		<h3 class="font-semibold">How sure are we?</h3>
		<dl class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
			<div class="rounded-lg p-2.5 {levelClass(significanceLevel)}">
				<dt class="text-xs font-medium opacity-80">Significance</dt>
				<dd class="font-semibold">
					{t.significant ? 'Significant' : t.evidence === 'weak' ? 'Weak' : 'Not significant'}
				</dd>
			</div>
			<div class="rounded-lg p-2.5 {levelClass(coverageLevel)}">
				<dt class="text-xs font-medium opacity-80">Data coverage</dt>
				<dd class="font-semibold">{Math.round(rel.coverage * 100)}%</dd>
			</div>
			<div class="rounded-lg p-2.5 {levelClass(rel.agreement.level)}">
				<dt class="text-xs font-medium opacity-80">Dataset agreement</dt>
				<dd class="font-semibold">{rel.agreement.level}</dd>
			</div>
			<div class="rounded-lg p-2.5 {levelClass(rel.confidence)}">
				<dt class="text-xs font-medium opacity-80">Confidence</dt>
				<dd class="font-semibold">{rel.confidence}</dd>
			</div>
		</dl>
		<ul class="text-muted-foreground mt-3 list-disc space-y-1 pl-5 text-sm">
			{#each rel.reasons as reason (reason)}
				<li>{reason}</li>
			{/each}
			{#if rel.agreement.level !== 'Not available'}
				<li>
					Second dataset: {rel.agreement.label}{rel.agreement.r !== undefined
						? `, year-to-year correlation r = ${rel.agreement.r.toFixed(2)}`
						: ''}{rel.agreement.otherPerDecade !== undefined
						? `, its trend ${signed(rel.agreement.otherPerDecade, rd)} ${unit}/decade (p = ${formatP(rel.agreement.otherP ?? 1)})`
						: ''}.
				</li>
			{:else if rel.agreement.reason}
				<li>{rel.agreement.reason}</li>
			{/if}
		</ul>
	</div>

	<!-- Where (grid cells) -->
	{#if a.spatial && a.spatial.cells.length > 1}
		<div class="bg-card rounded-xl border p-4 shadow-sm">
			<h3 class="font-semibold">Where is it changing?</h3>
			<p class="text-muted-foreground text-sm">
				Trend of each {v.dataset.resolution.split(',')[0]} grid cell, per decade. Hatched cells are significant
				after the Benjamini–Hochberg false discovery rate correction.
			</p>
			<div class="mt-3">
				<CellMap
					spatial={a.spatial}
					region={a.region}
					{unit}
					decimals={rd}
					up={v.up}
					down={v.down}
				/>
			</div>
		</div>
	{/if}

	{#if hasMonthly && extrasReady}
		<div class="bg-card rounded-xl border p-4 shadow-sm" data-print-block>
			<h3 class="font-semibold">Season by season</h3>
			<div class="mt-3">
				<MonthBreakdown
					monthly={a.data.monthly}
					from={a.from}
					to={a.to}
					{unit}
					decimals={v.decimals}
					rateDecimals={rd}
					name={v.everydayName}
					up={v.up}
					down={v.down}
					{research}
				/>
			</div>
		</div>
	{/if}

	{#if a.region.group !== 'Custom' && extrasReady}
		<div class="bg-card rounded-xl border p-4 shadow-sm" data-no-print>
			<h3 class="font-semibold">Compare two places</h3>
			<p class="text-muted-foreground mb-3 text-sm">
				Same variable, season and years. Shows whether the gap between the two places is changing.
			</p>
			<RegionCompare analysis={a} {assetBase} {research} rateDecimals={rd} />
		</div>
	{/if}

	<!-- Cross-variable association -->
	<div class="bg-card rounded-xl border p-4 shadow-sm">
		<h3 class="font-semibold">What changes together?</h3>
		{#if compareState === 'loading'}
			<p class="text-muted-foreground mt-2 text-sm" role="status">
				Checking related variables over the same years…
			</p>
		{:else if compareState === 'error'}
			<p class="text-muted-foreground mt-2 text-sm">
				The related variables could not be loaded right now.
			</p>
		{:else if comparison && comparison.items.length > 1}
			{@const ok = comparison.items.filter((i) => i.trend)}
			<p class="mt-2 text-lg font-semibold tracking-wide">{arrowsLine(ok)}</p>
			<p class="text-muted-foreground text-sm">
				{a.region.name}, {seasonText}, same years. ↑ significant increase, ↓ significant decrease, →
				no clear trend.
			</p>
			<ul class="mt-3 space-y-2 text-sm">
				{#each comparison.items as item (item.variable.id)}
					<li
						class="flex flex-wrap items-baseline justify-between gap-x-3 border-b pb-2 last:border-0"
					>
						<span class="font-medium">{item.variable.name}</span>
						{#if item.trend}
							<span class="text-muted-foreground">
								{arrowFor(item.trend)}
								{signed(item.trend.perDecade, rateDecimals(item.variable))}
								{item.variable.unit}/decade{research ? ` · p = ${formatP(item.trend.hr.p)}` : ''}
							</span>
						{:else}
							<span class="text-muted-foreground">{item.error ?? 'Not available'}</span>
						{/if}
					</li>
				{/each}
			</ul>
			{#if comparison.pairs.length}
				<h4 class="mt-3 text-sm font-semibold">Year-to-year association with {v.everydayName}</h4>
				<ul class="mt-1 space-y-1.5 text-sm">
					{#each comparison.pairs.filter((p) => p.a === v.id || p.b === v.id) as pair (pair.a + pair.b)}
						{@const other = comparison.items.find(
							(i) => i.variable.id === (pair.a === v.id ? pair.b : pair.a)
						)}
						{#if other}
							<li>
								{associationSentence(pair, v.everydayName, other.variable.everydayName)}
								{#if research}
									<span class="text-muted-foreground">
										(Spearman ρ = {pair.rho.toFixed(2)}; detrended Pearson on {pair.years} years, effective
										n = {pair.nEffective.toFixed(1)})
									</span>
								{/if}
							</li>
						{/if}
					{/each}
				</ul>
			{/if}
			{#if comparison.drivers}
				<div class="mt-4 border-t pt-4">
					<DriverModel model={comparison.drivers} target={v.everydayName} {research} />
				</div>
			{/if}
			<p
				class="mt-3 flex gap-1.5 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
			>
				<Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<span
					>Association is not causation. Two variables can move together because a third factor
					drives both.</span
				>
			</p>
		{:else}
			<p class="text-muted-foreground mt-2 text-sm">
				No related variable is available for this region.
			</p>
		{/if}
	</div>

	<!-- Full statistics -->
	{#if research}
		<div class="bg-card rounded-xl border p-4 shadow-sm">
			<h3 class="font-semibold">Statistics</h3>
			<div class="mt-2 overflow-x-auto">
				<table class="w-full min-w-[20rem] text-left text-sm">
					<caption class="sr-only">Full statistical results</caption>
					<tbody class="[&_td]:py-1.5 [&_th]:py-1.5 [&_th]:pr-3 [&_th]:font-medium [&_tr]:border-b">
						<tr><th scope="row">Years used</th><td>{t.n} ({periodLabel})</td></tr>
						<tr><th scope="row">Mean</th><td>{formatNumber(t.meanValue, v.decimals)} {unit}</td></tr
						>
						<tr>
							<th scope="row">Sen's slope</th>
							<td
								>{signed(t.perDecade, rd)}
								{unit}/decade (95% CI {signed(t.perDecadeLow, rd)} to {signed(
									t.perDecadeHigh,
									rd
								)})</td
							>
						</tr>
						<tr>
							<th scope="row">Mann–Kendall</th>
							<td
								>S = {t.mk.s}, τ = {t.mk.tau.toFixed(3)}, Z = {t.mk.z.toFixed(2)}, p = {formatP(
									t.mk.p
								)}</td
							>
						</tr>
						<tr>
							<th scope="row">Hamed–Rao modified MK</th>
							<td>Z = {t.hr.z.toFixed(2)}, p = {formatP(t.hr.p)} (primary test)</td>
						</tr>
						<tr>
							<th scope="row">Trend-free pre-whitening MK</th>
							<td>p = {formatP(t.tfpw.p)}, lag-1 autocorrelation r₁ = {t.tfpw.lag1.toFixed(2)}</td>
						</tr>
						<tr>
							<th scope="row">Pettitt change point</th>
							<td>
								{#if t.pettitt}
									{t.years[t.pettitt.index + 1] ?? '–'} (K = {t.pettitt.k}, p = {formatP(
										t.pettitt.p
									)})
								{:else}–{/if}
							</td>
						</tr>
						<tr>
							<th scope="row">Segmented trend</th>
							<td>
								{#if t.segmented}
									Best split after {t.years[t.segmented.index]}: {signed(
										t.segmented.before.slope * 10,
										rd
									)} → {signed(t.segmented.after.slope * 10, rd)}
									{unit}/decade (ΔBIC = {t.segmented.deltaBic.toFixed(1)}, {t.segmented.preferred
										? 'two segments preferred'
										: 'one line is enough'})
								{:else}–{/if}
							</td>
						</tr>
						<tr>
							<th scope="row">Reported change point</th>
							<td
								>{cp.year !== undefined
									? `${cp.year}, ${cp.kind === 'rate' ? 'change in rate' : 'shift in level'}: ${cp.phrase}`
									: 'None (needs agreement of the tests, see Methods)'}</td
							>
						</tr>
						{#if rel.agreement.breakYear !== undefined}
							<tr>
								<th scope="row">Homogeneity check</th>
								<td>
									Difference to {rel.agreement.label} shifts in {rel.agreement.breakYear} (Pettitt p =
									{formatP(rel.agreement.breakP ?? 1)}, {(rel.agreement.breakShift ?? 0).toFixed(1)} SD)
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<!-- Source and citation -->
	<div class="bg-card rounded-xl border p-4 text-sm shadow-sm">
		<h3 class="font-semibold">Data source and citation</h3>
		<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
			<dt class="text-muted-foreground">Dataset</dt>
			<dd>
				<a class="underline underline-offset-2" href={v.dataset.url} target="_blank" rel="noopener"
					>{v.dataset.name}</a
				>
			</dd>
			<dt class="text-muted-foreground">Provider</dt>
			<dd>{v.dataset.provider}</dd>
			<dt class="text-muted-foreground">Resolution</dt>
			<dd>{v.dataset.resolution}</dd>
			<dt class="text-muted-foreground">Time span</dt>
			<dd>{a.available.first}–{a.available.last} available; {periodLabel} analysed</dd>
			<dt class="text-muted-foreground">Access</dt>
			<dd>
				{#if v.dataset.live}
					Live request from your browser
				{:else}
					Bundled sample (the server cannot be read from a web page), retrieved {a.data.sample
						?.retrieved}
				{/if}
			</dd>
			<dt class="text-muted-foreground">Method</dt>
			<dd>{a.data.method}</dd>
			{#if research}
				<dt class="text-muted-foreground">Request</dt>
				<dd class="min-w-0 break-all">
					<a
						class="underline underline-offset-2"
						href={a.data.requestUrl}
						target="_blank"
						rel="noopener">{a.data.requestUrl}</a
					>
				</dd>
			{/if}
		</dl>
	</div>
</section>
