<script lang="ts">
	import { ticks as niceTicks } from 'd3';

	import { formatNumber } from '$lib/trend/story';

	export interface ChartLine {
		from: number;
		to: number;
		slope: number;
		intercept: number;
	}

	export interface ChartSeries {
		label: string;
		years: number[];
		values: (number | null)[];
		color: string;
		dashed?: boolean;
	}

	interface Props {
		years: number[];
		values: (number | null)[];
		unit: string;
		decimals: number;
		label: string;
		trendLine?: ChartLine;
		segments?: ChartLine[];
		changeYear?: number;
		extra?: ChartSeries[];
		simple?: boolean;
		/** Small chart for cards (shorter, fewer ticks). */
		compact?: boolean;
		color?: string;
	}

	let {
		years,
		values,
		unit,
		decimals,
		label,
		trendLine,
		segments = [],
		changeYear,
		extra = [],
		simple = false,
		compact = false,
		color = 'var(--trend-main)'
	}: Props = $props();

	let width = $state(600);
	const height = $derived(compact ? 130 : width < 480 ? 220 : 280);
	const margin = $derived({ top: 14, right: 12, bottom: 28, left: width < 480 ? 42 : 52 });

	const allValues = $derived(
		[...values, ...extra.flatMap((s) => s.values)].filter((v): v is number => v !== null)
	);
	const yDomain = $derived.by(() => {
		let lo = Math.min(...allValues);
		let hi = Math.max(...allValues);
		if (!Number.isFinite(lo)) return [0, 1];
		if (lo === hi) {
			lo -= 1;
			hi += 1;
		}
		const pad = (hi - lo) * 0.08;
		return [lo - pad, hi + pad];
	});
	const xMin = $derived(Math.min(...years, ...extra.flatMap((s) => s.years)));
	const xMax = $derived(Math.max(...years, ...extra.flatMap((s) => s.years)));

	const innerW = $derived(Math.max(10, width - margin.left - margin.right));
	const innerH = $derived(height - margin.top - margin.bottom);
	const x = (year: number) =>
		margin.left + (xMax === xMin ? innerW / 2 : ((year - xMin) / (xMax - xMin)) * innerW);
	const y = (v: number) =>
		margin.top + innerH - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerH;

	const yTicks = $derived(niceTicks(yDomain[0], yDomain[1], compact ? 3 : width < 480 ? 4 : 6));
	const xTicks = $derived.by(() => {
		const span = xMax - xMin;
		const step = span > 30 ? (width < 480 ? 10 : 5) : span > 12 ? (width < 480 ? 5 : 2) : 1;
		const out: number[] = [];
		for (let t = Math.ceil(xMin / step) * step; t <= xMax; t += step) out.push(t);
		return out;
	});
	const tickDecimals = $derived(
		Math.max(0, Math.min(3, -Math.floor(Math.log10(Math.abs(yTicks[1] - yTicks[0] || 1)))))
	);

	function pathFor(ys: number[], vs: (number | null)[]): string {
		let d = '';
		let pen = false;
		ys.forEach((year, i) => {
			const v = vs[i];
			if (v === null) {
				pen = false;
				return;
			}
			d += `${pen ? 'L' : 'M'}${x(year).toFixed(1)},${y(v).toFixed(1)}`;
			pen = true;
		});
		return d;
	}

	const linePath = (l: ChartLine) =>
		`M${x(l.from)},${y(l.intercept + l.slope * l.from)}L${x(l.to)},${y(l.intercept + l.slope * l.to)}`;

	let hover = $state<number | null>(null);
	function onPointer(event: PointerEvent) {
		const svg = event.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const px = ((event.clientX - rect.left) / rect.width) * width;
		const year = Math.round(xMin + ((px - margin.left) / innerW) * (xMax - xMin));
		hover = Math.max(xMin, Math.min(xMax, year));
	}
	const hoverIndex = $derived(hover === null ? -1 : years.indexOf(hover));
	const hoverValue = $derived(hoverIndex >= 0 ? values[hoverIndex] : null);
	const tooltipLeft = $derived(hover === null ? 0 : x(hover) > width / 2);
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<svg
		{width}
		{height}
		viewBox={`0 0 ${width} ${height}`}
		role="img"
		aria-label={label}
		class="block touch-pan-y select-none"
		onpointermove={onPointer}
		onpointerdown={onPointer}
		onpointerleave={() => (hover = null)}
	>
		<!-- grid -->
		{#each yTicks as t (t)}
			<line
				x1={margin.left}
				x2={width - margin.right}
				y1={y(t)}
				y2={y(t)}
				class="stroke-border"
				stroke-width="1"
			/>
			<text
				x={margin.left - 6}
				y={y(t)}
				dy="0.32em"
				text-anchor="end"
				class="fill-muted-foreground text-[11px]"
			>
				{t.toFixed(tickDecimals)}
			</text>
		{/each}
		{#each xTicks as t (t)}
			<text
				x={x(t)}
				y={height - 8}
				text-anchor={x(t) > width - 16 ? 'end' : x(t) < 16 ? 'start' : 'middle'}
				class="fill-muted-foreground text-[11px]">{t}</text
			>
		{/each}
		<text x={4} y={10} class="fill-muted-foreground text-[10px]">{unit}</text>

		{#if changeYear !== undefined}
			<line
				x1={x(changeYear - 0.5)}
				x2={x(changeYear - 0.5)}
				y1={margin.top}
				y2={margin.top + innerH}
				stroke="var(--trend-change)"
				stroke-width="1.5"
				stroke-dasharray="4 3"
			/>
			{@const cx = x(changeYear - 0.5)}
			{@const flip = cx > margin.left + innerW - 76}
			<text
				x={flip ? cx - 4 : cx + 4}
				y={margin.top + 10}
				text-anchor={flip ? 'end' : 'start'}
				class="text-[11px] font-medium"
				fill="var(--trend-change)">change {changeYear}</text
			>
		{/if}

		{#each extra as s (s.label)}
			<path
				d={pathFor(s.years, s.values)}
				fill="none"
				stroke={s.color}
				stroke-width="1.5"
				stroke-dasharray={s.dashed ? '5 3' : undefined}
				opacity="0.85"
			/>
		{/each}

		<path d={pathFor(years, values)} fill="none" stroke={color} stroke-width="1.75" opacity="0.9" />
		{#if !simple || years.length <= 60}
			{#each years as year, i (year)}
				{#if values[i] !== null}
					<circle cx={x(year)} cy={y(values[i]!)} r={width < 480 ? 2.2 : 2.8} fill={color} />
				{/if}
			{/each}
		{/if}

		{#if trendLine}
			<path d={linePath(trendLine)} stroke="var(--trend-line)" stroke-width="2.5" fill="none" />
		{/if}
		{#each segments as seg, i (i)}
			<path
				d={linePath(seg)}
				stroke="var(--trend-change)"
				stroke-width="2"
				stroke-dasharray="6 3"
				fill="none"
			/>
		{/each}

		{#if hover !== null}
			<line
				x1={x(hover)}
				x2={x(hover)}
				y1={margin.top}
				y2={margin.top + innerH}
				class="stroke-foreground/40"
				stroke-width="1"
			/>
			{#if hoverValue !== null}
				<circle
					cx={x(hover)}
					cy={y(hoverValue)}
					r="4.5"
					fill={color}
					class="stroke-background"
					stroke-width="2"
				/>
			{/if}
		{/if}
	</svg>
	{#if hover !== null}
		<div
			class="bg-popover text-popover-foreground pointer-events-none absolute top-1 z-10 rounded-md border px-2 py-1 text-xs shadow-sm"
			style={tooltipLeft ? `right:${width - x(hover) + 8}px` : `left:${x(hover) + 8}px`}
		>
			<div class="font-semibold">{hover}</div>
			<div>
				{hoverValue === null ? 'no data' : `${formatNumber(hoverValue, decimals)} ${unit}`}
			</div>
			{#each extra as s (s.label)}
				{@const k = s.years.indexOf(hover)}
				{#if k >= 0 && s.values[k] !== null}
					<div style={`color:${s.color}`}>{s.label}: {formatNumber(s.values[k]!, decimals)}</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
