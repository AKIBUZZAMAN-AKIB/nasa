<script lang="ts">
	/**
	 * Headline KPI tile ("summary first, detail later"): label, big tabular
	 * number, a context line, an optional status pill (icon + text, so colour is
	 * never the only cue) and an optional D3 sparkline of the annual series.
	 */
	import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Minus } from '@lucide/svelte';
	import * as d3 from 'd3';

	import { COLORS } from './d3-utils';

	type Tone = 'up' | 'down' | 'flat' | 'warn' | 'ok' | 'none';

	interface Props {
		label: string;
		value: string;
		unit?: string;
		detail?: string;
		pill?: { text: string; tone: Tone };
		/** Arrow next to the value. */
		direction?: 'up' | 'down' | 'flat';
		/** Colour of the arrow: warming/wetting is not "good" or "bad", so stay neutral by default. */
		accent?: string;
		spark?: { values: number[]; highlightLast?: boolean; trend?: [number, number] };
		title?: string;
	}

	let {
		label,
		value,
		unit,
		detail,
		pill,
		direction,
		accent = 'currentColor',
		spark,
		title
	}: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	const H = 26;

	$effect(() => {
		if (!svgEl || !spark || width < 30) return;
		const svg = d3.select(svgEl);
		svg.selectAll('*').remove();
		const vals = spark.values;
		const finite = vals.filter(Number.isFinite);
		if (finite.length < 2) return;
		const x = d3
			.scaleLinear()
			.domain([0, vals.length - 1])
			.range([1, width - 3]);
		const [lo, hi] = d3.extent(finite) as [number, number];
		const y = d3
			.scaleLinear()
			.domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi])
			.range([H - 3, 3]);
		svg
			.append('path')
			.datum(vals)
			.attr('fill', 'none')
			.attr('stroke', COLORS.primary)
			.attr('stroke-width', 1.2)
			.attr('stroke-opacity', 0.85)
			.attr(
				'd',
				d3
					.line<number>()
					.defined(Number.isFinite)
					.x((_, i) => x(i))
					.y((v) => y(v))
			);
		if (spark.trend) {
			svg
				.append('line')
				.attr('x1', x(0))
				.attr('x2', x(vals.length - 1))
				.attr('y1', y(spark.trend[0]))
				.attr('y2', y(spark.trend[1]))
				.attr('stroke', COLORS.sen)
				.attr('stroke-width', 1.2)
				.attr('stroke-dasharray', '3 2');
		}
		if (spark.highlightLast !== false) {
			const i = vals.length - 1;
			if (Number.isFinite(vals[i]))
				svg
					.append('circle')
					.attr('cx', x(i))
					.attr('cy', y(vals[i]))
					.attr('r', 2.2)
					.attr('fill', COLORS.primary);
		}
	});

	const PILL: Record<Tone, string> = {
		up: 'bg-orange-500/15 text-orange-800 dark:text-orange-300',
		down: 'bg-sky-500/15 text-sky-800 dark:text-sky-300',
		flat: 'bg-black/5 text-neutral-700 dark:bg-white/10 dark:text-neutral-300',
		warn: 'bg-amber-500/20 text-amber-900 dark:text-amber-300',
		ok: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
		none: 'bg-black/5 text-neutral-700 dark:bg-white/10 dark:text-neutral-300'
	};
</script>

<div
	class="flex min-w-0 flex-col rounded-lg border border-black/10 bg-white px-2.5 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-900"
	{title}
>
	<div class="flex items-center justify-between gap-1">
		<span class="truncate text-[0.62rem] font-medium uppercase tracking-wide opacity-60"
			>{label}</span
		>
		{#if pill}
			<span
				class="flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[0.58rem] font-semibold {PILL[
					pill.tone
				]}"
			>
				{#if pill.tone === 'warn'}<AlertTriangle
						size={9}
					/>{:else if pill.tone === 'ok'}<CheckCircle2 size={9} />{/if}
				{pill.text}
			</span>
		{/if}
	</div>
	<div class="mt-0.5 flex items-baseline gap-1">
		{#if direction}
			<span style="color:{accent}" class="self-center">
				{#if direction === 'up'}<ArrowUpRight
						size={16}
					/>{:else if direction === 'down'}<ArrowDownRight size={16} />{:else}<Minus
						size={16}
					/>{/if}
			</span>
		{/if}
		<span class="text-[1.15rem] font-semibold leading-none tracking-tight tabular-nums"
			>{value}</span
		>
		{#if unit}<span class="text-[0.66rem] opacity-60">{unit}</span>{/if}
	</div>
	{#if detail}
		<p class="mt-1 text-[0.62rem] leading-snug opacity-70">{detail}</p>
	{/if}
	{#if spark}
		<div class="mt-auto pt-1" bind:clientWidth={width}>
			<svg bind:this={svgEl} {width} height={H} class="block" aria-hidden="true"></svg>
		</div>
	{/if}
</div>
