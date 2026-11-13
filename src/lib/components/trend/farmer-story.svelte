<script lang="ts">
	import Sprout from '@lucide/svelte/icons/sprout';
	import X from '@lucide/svelte/icons/x';

	import { seasonById, variableById } from '$lib/trend/catalog';
	import { regionById } from '$lib/trend/regions';
	import { type Analysis, runAnalysis } from '$lib/trend/run';
	import { FARMER_STORY, type Preset } from '$lib/trend/state';
	import { arrowFor, capitalise, formatNumber, rateDecimals, signed } from '$lib/trend/story';

	import TrendChart from './trend-chart.svelte';

	interface Props {
		assetBase: string;
		onopen: (preset: Preset) => void;
		onclose: () => void;
	}

	let { assetBase, onopen, onclose }: Props = $props();

	type Step = {
		preset: Preset;
		state: 'loading' | 'done' | 'error';
		analysis?: Analysis;
		error?: string;
	};
	let steps = $state<Step[]>(FARMER_STORY.map((preset) => ({ preset, state: 'loading' })));

	$effect(() => {
		const controller = new AbortController();
		(async () => {
			for (let i = 0; i < FARMER_STORY.length; i++) {
				const p = FARMER_STORY[i];
				const variable = variableById(p.selection.variableId)!;
				const region = regionById(p.selection.regionId)!;
				try {
					const analysis = await runAnalysis({
						variable,
						region,
						season: seasonById(p.selection.seasonId),
						from: p.selection.from,
						to: p.selection.to,
						assetBase,
						signal: controller.signal
					});
					steps[i] = { preset: p, state: 'done', analysis };
				} catch (e) {
					if ((e as Error).name === 'AbortError') return;
					steps[i] = { preset: p, state: 'error', error: (e as Error).message };
				}
			}
		})();
		return () => controller.abort();
	});

	const answerWord = (a: Analysis) => {
		const t = a.trend;
		if (t.direction === 'no trend') return 'No clear change';
		return capitalise(t.direction === 'increasing' ? a.variable.up : a.variable.down);
	};

	const done = $derived(steps.filter((s) => s.analysis));
	const summary = $derived(
		done.length === steps.length
			? done
					.map(
						(s) => `${capitalise(s.analysis!.variable.everydayName)} ${arrowFor(s.analysis!.trend)}`
					)
					.join(', ')
			: ''
	);
</script>

<section
	class="rounded-xl border border-emerald-300 bg-emerald-50/70 p-4 shadow-sm sm:p-5 dark:border-emerald-800 dark:bg-emerald-950/30"
	aria-labelledby="farmer-title"
>
	<div class="flex items-start gap-3">
		<Sprout
			class="mt-0.5 size-6 shrink-0 text-emerald-700 dark:text-emerald-300"
			aria-hidden="true"
		/>
		<div class="min-w-0 flex-1">
			<h2 id="farmer-title" class="text-lg font-semibold">
				A farmer near Rajshahi asks three questions
			</h2>
			<p class="text-muted-foreground text-sm">
				Same place, same years (2001 onwards), three NASA datasets. Tap a card to see its full
				analysis.
			</p>
		</div>
		<button
			type="button"
			class="hover:bg-accent -m-1 inline-flex size-10 shrink-0 items-center justify-center rounded-md"
			onclick={onclose}
			aria-label="Close the farmer story"
		>
			<X class="size-5" />
		</button>
	</div>

	<ol class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
		{#each steps as step, i (step.preset.id)}
			<li>
				<button
					type="button"
					class="bg-card hover:border-foreground/40 flex h-full w-full flex-col rounded-lg border p-3 text-left transition-colors"
					onclick={() => onopen(step.preset)}
				>
					<span class="text-muted-foreground text-xs font-semibold"
						>{i + 1}. {step.preset.title}</span
					>
					<span class="mt-0.5 text-sm font-medium">{step.preset.question}</span>
					{#if step.state === 'loading'}
						<span
							class="bg-muted mt-3 h-24 w-full animate-pulse rounded"
							role="status"
							aria-label="Loading"
						></span>
					{:else if step.state === 'error'}
						<span class="text-muted-foreground mt-3 text-sm">Could not load: {step.error}</span>
					{:else if step.analysis}
						{@const a = step.analysis}
						<span class="mt-2 text-xl font-semibold">{arrowFor(a.trend)} {answerWord(a)}</span>
						<span class="text-muted-foreground text-sm">
							{signed(a.trend.perDecade, rateDecimals(a.variable))}
							{a.variable.unit} per decade · average {formatNumber(
								a.trend.meanValue,
								a.variable.decimals
							)}
							{a.variable.unit} · confidence {a.reliability.confidence.toLowerCase()}
						</span>
						<span class="pointer-events-none mt-2 block w-full">
							<TrendChart
								years={a.series.years}
								values={a.series.values}
								unit={a.variable.unit}
								decimals={a.variable.decimals}
								label={`${a.variable.name}: ${a.trend.direction}`}
								trendLine={{
									from: a.trend.firstYear,
									to: a.trend.lastYear,
									slope: a.trend.slopePerYear,
									intercept: a.trend.intercept
								}}
								simple
								compact
							/>
						</span>
						<span class="mt-1 text-sm">{a.story.everyday.split('. ')[0]}.</span>
					{/if}
				</button>
			</li>
		{/each}
	</ol>
	{#if summary}
		<p class="mt-4 text-base font-semibold">In short: {summary}</p>
		<p class="text-muted-foreground text-sm">
			↑ rising, ↓ falling, → no clear trend (Mann–Kendall test, corrected for autocorrelation).
			These are separate measurements that change side by side; they do not prove that one causes
			another.
		</p>
	{/if}
</section>
