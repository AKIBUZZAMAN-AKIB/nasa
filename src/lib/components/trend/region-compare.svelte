<script lang="ts">
	import { analyzeTrend } from '$lib/trend/analyze';
	import { regionGap } from '$lib/trend/insights';
	import { type Analysis, loadSeries, regionsFor } from '$lib/trend/run';
	import { arrowFor, formatNumber, formatP, signed } from '$lib/trend/story';

	import TrendChart from './trend-chart.svelte';

	import type { SeasonalSeries, TrendResult } from '$lib/trend/analyze';

	interface Props {
		analysis: Analysis;
		assetBase: string;
		research: boolean;
		rateDecimals: number;
	}

	let { analysis: a, assetBase, research, rateDecimals: rd }: Props = $props();

	const options = $derived(
		regionsFor(a.variable).filter((r) => r.id !== a.region.id && r.group !== 'Custom')
	);
	const nameOf = (n: string) => n.replace(/ \(.*\)$/, '');

	let otherId = $state('');
	let status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	let errorText = $state('');
	let other = $state<{ series: SeasonalSeries; trend: TrendResult; name: string } | null>(null);

	// Start over when the main analysis changes.
	$effect(() => {
		void a;
		otherId = '';
		other = null;
		status = 'idle';
	});

	let controller: AbortController | null = null;
	function pick(id: string) {
		otherId = id;
		controller?.abort();
		other = null;
		if (!id) {
			status = 'idle';
			return;
		}
		const region = options.find((r) => r.id === id);
		if (!region) return;
		controller = new AbortController();
		const c = controller;
		status = 'loading';
		loadSeries({
			variable: a.variable,
			region,
			season: a.season,
			from: a.from,
			to: a.to,
			assetBase,
			signal: c.signal
		}).then(
			(b) => {
				if (c.signal.aborted) return;
				const trend = analyzeTrend(b.series);
				if (!trend) {
					errorText = 'it has too few years of data for these settings.';
					status = 'error';
					return;
				}
				other = { series: b.series, trend, name: nameOf(region.name) };
				status = 'done';
			},
			(e) => {
				if ((e as Error).name === 'AbortError' || c.signal.aborted) return;
				errorText = (e as Error).message;
				status = 'error';
			}
		);
	}

	const gap = $derived(other ? regionGap(a.series, other.series) : null);
	const here = $derived(nameOf(a.region.name));

	const gapSentence = $derived.by(() => {
		if (!other || !gap) return '';
		const unit = a.variable.unit;
		const higher = gap.meanDifference >= 0 ? here : other.name;
		const level = `On average ${higher} is ${formatNumber(Math.abs(gap.meanDifference), a.variable.decimals)} ${unit} higher.`;
		if (!gap.significant)
			return `${level} The gap between the two places has not changed significantly over ${gap.years[0]}–${gap.years.at(-1)}.`;
		const widening = Math.sign(gap.perDecade) === Math.sign(gap.meanDifference || gap.perDecade);
		return `${level} The gap is ${widening ? 'widening' : 'narrowing'} significantly: ${signed(gap.perDecade, rd)} ${unit} per decade (${here} minus ${other.name}).`;
	});
</script>

<div>
	<label for="compare-region" class="text-sm font-medium">Compare with another place</label>
	<select
		id="compare-region"
		class="border-input bg-background mt-1.5 block min-h-11 w-full rounded-lg border px-3 text-base sm:max-w-sm sm:text-sm"
		value={otherId}
		onchange={(e) => pick(e.currentTarget.value)}
		disabled={!options.length}
	>
		<option value="">{options.length ? 'Choose a place…' : 'No other place has this data'}</option>
		{#each options as r (r.id)}
			<option value={r.id}>{r.name}</option>
		{/each}
	</select>

	{#if status === 'loading'}
		<div class="mt-3 space-y-2" role="status" aria-label="Loading the second place">
			<div class="bg-muted h-4 w-2/3 animate-pulse rounded"></div>
			<div class="bg-muted h-40 animate-pulse rounded-lg"></div>
		</div>
	{:else if status === 'error'}
		<p class="text-destructive mt-3 text-sm" role="alert">
			The second place could not be loaded: {errorText}
		</p>
	{:else if status === 'done' && other}
		<div class="trend-enter mt-3">
			<ul class="grid gap-2 text-sm sm:grid-cols-2">
				{#each [{ name: here, t: a.trend, color: 'var(--trend-main)' }, { name: other.name, t: other.trend, color: 'var(--trend-ref)' }] as row (row.name)}
					<li class="bg-muted/50 flex items-start gap-2 rounded-lg p-2.5">
						<span
							class="mt-1.5 h-0.5 w-4 shrink-0 rounded"
							style={`background:${row.color}`}
							aria-hidden="true"
						></span>
						<span class="min-w-0">
							<span class="block font-medium">{row.name}</span>
							<span class="text-muted-foreground tabular-nums">
								{arrowFor(row.t)}
								{signed(row.t.perDecade, rd)}
								{a.variable.unit}/decade · {row.t.direction === 'no trend'
									? 'not significant'
									: 'significant'}{research ? ` (p = ${formatP(row.t.hr.p)})` : ''}
							</span>
						</span>
					</li>
				{/each}
			</ul>
			<div class="mt-3">
				<TrendChart
					years={a.series.years}
					values={a.series.values}
					unit={a.variable.unit}
					decimals={a.variable.decimals}
					label={`${a.variable.name}: ${here} and ${other.name}`}
					extra={[
						{
							label: other.name,
							years: other.series.years,
							values: other.series.values,
							color: 'var(--trend-ref)',
							dashed: true
						}
					]}
					simple
					compact
				/>
			</div>
			{#if gap}
				<p class="mt-2 text-sm" data-gap-sentence>{gapSentence}</p>
				{#if research}
					<p class="text-muted-foreground mt-1 text-xs">
						Trend of the yearly difference: Sen's slope {signed(gap.perDecade, rd)} (95% range {signed(
							gap.perDecadeLow,
							rd
						)} to {signed(gap.perDecadeHigh, rd)}), modified Mann–Kendall p = {formatP(gap.p)}, {gap
							.years.length} shared years.
					</p>
				{/if}
			{:else}
				<p class="text-muted-foreground mt-2 text-sm">
					The two places share too few years to test whether the gap is changing.
				</p>
			{/if}
		</div>
	{/if}
</div>
