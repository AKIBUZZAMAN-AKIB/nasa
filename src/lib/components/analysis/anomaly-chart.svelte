<script lang="ts">
	import * as d3 from 'd3';

	import {
		TOOLTIP_CLASS,
		divergingInterpolator,
		fmt,
		signed,
		styleAxis,
		symmetricDiverging,
		tooltip
	} from './d3-utils';

	import type { AggregateKind } from '$lib/analysis/analysis-stats';

	interface Props {
		years: number[];
		anomalies: number[];
		unit: string;
		code: string;
		kind: AggregateKind;
		baselineLabel: string;
		height?: number;
	}

	let { years, anomalies, unit, code, kind, baselineLabel, height = 250 }: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!svgEl || width < 50 || years.length === 0) return;
		draw(svgEl, width);
	});

	/** Centred running mean over `k` years (shrinking at the edges). */
	function runningMean(values: number[], k: number): number[] {
		const half = Math.floor(k / 2);
		return values.map((_, i) => {
			const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));
			return slice.length >= Math.min(k, 5) ? (d3.mean(slice) ?? NaN) : NaN;
		});
	}

	function draw(svgNode: SVGSVGElement, w: number) {
		const svg = d3.select(svgNode);
		svg.selectAll('*').remove();
		const tip = tooltip(tipEl);
		const stripeH = 26;
		const m = { t: 10, r: 10, b: 20, l: 46 };
		const iw = w - m.l - m.r;
		const ih = height - m.t - m.b - stripeH - 14;
		const color = symmetricDiverging(anomalies, divergingInterpolator(code, kind));

		const x = d3.scaleBand<number>().domain(years).range([0, iw]).padding(0.12);
		const maxAbs = d3.max(anomalies, (a) => Math.abs(a)) || 1;
		const y = d3
			.scaleLinear()
			.domain([-maxAbs * 1.08, maxAbs * 1.08])
			.nice()
			.range([ih, 0]);
		const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);

		styleAxis(
			g.append('g').call(
				d3
					.axisLeft(y)
					.ticks(5)
					.tickSize(-iw)
					.tickFormat((v) => signed(Number(v)))
			),
			true
		);
		g.select('.domain').remove();
		g.append('line')
			.attr('x1', 0)
			.attr('x2', iw)
			.attr('y1', y(0))
			.attr('y2', y(0))
			.attr('stroke', 'currentColor')
			.attr('stroke-opacity', 0.5);
		g.append('text')
			.attr('x', 4)
			.attr('y', 8)
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.6)
			.text(`${unit} vs ${baselineLabel}`);

		const data = years.map((year, i) => ({ year, a: anomalies[i] }));
		g.append('g')
			.selectAll('rect')
			.data(data)
			.join('rect')
			.attr('x', (d) => x(d.year) ?? 0)
			.attr('width', x.bandwidth())
			.attr('y', y(0))
			.attr('height', 0)
			.attr('fill', (d) => color(d.a))
			.transition()
			.duration(450)
			.delay((_, i) => i * 5)
			.attr('y', (d) => Math.min(y(0), y(d.a)))
			.attr('height', (d) => Math.abs(y(d.a) - y(0)));

		const smooth = runningMean(anomalies, 11);
		g.append('path')
			.datum(smooth)
			.attr('fill', 'none')
			.attr('stroke', 'currentColor')
			.attr('stroke-width', 1.6)
			.attr('stroke-opacity', 0.8)
			.attr(
				'd',
				d3
					.line<number>()
					.defined((v) => Number.isFinite(v))
					.x((_, i) => (x(years[i]) ?? 0) + x.bandwidth() / 2)
					.y((v) => y(v))
					.curve(d3.curveMonotoneX)
			);

		// Climate stripes (Hawkins style): one colour per year, same scale.
		const sy = ih + 6;
		const stripes = g.append('g').attr('transform', `translate(0,${sy})`);
		const sx = d3.scaleBand<number>().domain(years).range([0, iw]).padding(0);
		stripes
			.selectAll('rect')
			.data(data)
			.join('rect')
			.attr('x', (d) => sx(d.year) ?? 0)
			.attr('width', sx.bandwidth() + 0.5)
			.attr('height', stripeH)
			.attr('fill', (d) => color(d.a));
		styleAxis(
			g
				.append('g')
				.attr('transform', `translate(0,${sy + stripeH})`)
				.call(
					d3
						.axisBottom(sx)
						.tickValues(
							years.filter((yr) => yr % (years.length > 60 ? 20 : years.length > 25 ? 10 : 5) === 0)
						)
						.tickFormat(d3.format('d'))
				)
		);

		g.append('rect')
			.attr('width', iw)
			.attr('height', sy + stripeH)
			.attr('fill', 'transparent')
			.on('pointermove', (event: PointerEvent) => {
				const [mx, my] = d3.pointer(event);
				const i = Math.max(0, Math.min(years.length - 1, Math.floor((mx / iw) * years.length)));
				const rank = [...anomalies].sort((a, b) => b - a).indexOf(anomalies[i]) + 1;
				tip.show(
					`<b>${years[i]}</b><br>Anomaly: <b>${signed(anomalies[i])}</b> ${unit}<br><span style="opacity:.7">Rank ${rank} of ${years.length} · 11-yr mean ${fmt(smooth[i])}</span>`,
					mx + m.l,
					my + m.t
				);
			})
			.on('pointerleave', () => tip.hide());
	}
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<svg
		bind:this={svgEl}
		{width}
		{height}
		class="block select-none"
		role="img"
		aria-label="Annual anomalies and stripes"
	></svg>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
