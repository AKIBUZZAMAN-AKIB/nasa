<script lang="ts">
	/**
	 * Compact "climate stripes" band (Ed Hawkins, showyourstripes.info): one
	 * stripe per year, coloured by its anomaly with the IPCC-style diverging
	 * palette (red–blue for temperature, brown–green for water variables).
	 */
	import * as d3 from 'd3';

	import { TOOLTIP_CLASS, signed, symmetricDiverging, tooltip } from './d3-utils';

	interface Props {
		years: number[];
		anomalies: number[];
		interpolator: (t: number) => string;
		unit: string;
		height?: number;
		baseline?: [number, number];
	}

	let { years, anomalies, interpolator, unit, height = 18, baseline }: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!svgEl || width < 30 || !years.length) return;
		const svg = d3.select(svgEl);
		svg.selectAll('*').remove();
		const tip = tooltip(tipEl);
		const color = symmetricDiverging(anomalies, interpolator);
		const x = d3.scaleBand<number>().domain(years).range([0, width]).paddingInner(0);
		svg
			.append('g')
			.selectAll('rect')
			.data(years.map((year, i) => ({ year, a: anomalies[i] })))
			.join('rect')
			.attr('x', (d) => x(d.year) ?? 0)
			.attr('width', Math.ceil(x.bandwidth()) + 0.5)
			.attr('height', height)
			.attr('fill', (d) => (Number.isFinite(d.a) ? color(d.a) : 'transparent'))
			.on('pointermove', (event: PointerEvent, d) => {
				const [mx, my] = d3.pointer(event, svgEl);
				tip.show(`<b>${d.year}</b>: ${signed(d.a)} ${unit}`, mx, my);
			})
			.on('pointerleave', () => tip.hide());
		if (baseline) {
			const a = x(Math.max(baseline[0], years[0]));
			const b = x(Math.min(baseline[1], years[years.length - 1]));
			if (a !== undefined && b !== undefined)
				svg
					.append('rect')
					.attr('x', a)
					.attr('y', height - 2)
					.attr('width', b + x.bandwidth() - a)
					.attr('height', 2)
					.attr('fill', 'currentColor')
					.attr('fill-opacity', 0.55)
					.attr('pointer-events', 'none');
		}
	});
</script>

<div class="relative">
	<div class="overflow-hidden rounded" bind:clientWidth={width}>
		<svg
			bind:this={svgEl}
			{width}
			{height}
			class="block"
			role="img"
			aria-label="Climate stripes, {years[0]}–{years[years.length - 1]}"
		></svg>
	</div>
	<div class="mt-0.5 flex justify-between text-[0.58rem] tabular-nums opacity-55">
		<span>{years[0]}</span>
		{#if baseline}<span>▬ baseline {baseline[0]}–{baseline[1]}</span>{/if}
		<span>{years[years.length - 1]}</span>
	</div>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
