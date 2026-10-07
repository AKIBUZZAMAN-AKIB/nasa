<script lang="ts">
	import * as d3 from 'd3';

	import { quantileSorted } from '$lib/analysis/analysis-stats';

	import { COLORS, TOOLTIP_CLASS, fmt, legendRow, styleAxis, tooltip } from './d3-utils';

	interface Props {
		early: Float64Array;
		late: Float64Array;
		earlyLabel: string;
		lateLabel: string;
		unit: string;
		height?: number;
	}

	let { early, late, earlyLabel, lateLabel, unit, height = 230 }: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!svgEl || width < 50 || early.length < 2 || late.length < 2) return;
		draw(svgEl, width);
	});

	function draw(svgNode: SVGSVGElement, w: number) {
		const svg = d3.select(svgNode);
		svg.selectAll('*').remove();
		const tip = tooltip(tipEl);
		const m = { t: 22, r: 10, b: 22, l: 40 };
		const iw = w - m.l - m.r;
		const ih = height - m.t - m.b;

		// Clip the long tail at the pooled 0.5–99.5th percentile for readability.
		const lo = Math.min(quantileSorted(early, 0.005) ?? 0, quantileSorted(late, 0.005) ?? 0);
		const hi = Math.max(quantileSorted(early, 0.995) ?? 1, quantileSorted(late, 0.995) ?? 1);
		const x = d3.scaleLinear().domain([lo, hi]).nice().range([0, iw]);
		const thresholds = x.ticks(Math.min(50, Math.max(15, Math.floor(iw / 10))));
		const bin = d3
			.bin()
			.domain(x.domain() as [number, number])
			.thresholds(thresholds);
		const density = (values: Float64Array) =>
			bin(Array.from(values)).map((b) => ({
				x0: b.x0 ?? 0,
				x1: b.x1 ?? 0,
				d: b.length / values.length / Math.max(1e-9, (b.x1 ?? 0) - (b.x0 ?? 0)),
				share: b.length / values.length
			}));
		const de = density(early);
		const dl = density(late);
		const y = d3
			.scaleLinear()
			.domain([0, d3.max([...de, ...dl], (b) => b.d) ?? 1])
			.nice()
			.range([ih, 0]);

		const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
		styleAxis(
			g.append('g').call(d3.axisLeft(y).ticks(4).tickSize(-iw).tickFormat(d3.format('.2~g'))),
			true
		);
		g.select('.domain').remove();
		styleAxis(
			g
				.append('g')
				.attr('transform', `translate(0,${ih})`)
				.call(d3.axisBottom(x).ticks(Math.floor(iw / 60)))
		);
		g.append('text')
			.attr('x', iw)
			.attr('y', ih - 4)
			.attr('text-anchor', 'end')
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.6)
			.text(unit);
		g.append('text')
			.attr('x', -m.l + 2)
			.attr('y', -10)
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.6)
			.text('density');

		const area = d3
			.area<{ x0: number; x1: number; d: number }>()
			.x((b) => x((b.x0 + b.x1) / 2))
			.y0(ih)
			.y1((b) => y(b.d))
			.curve(d3.curveBasis);
		const draws: [typeof de, string][] = [
			[de, COLORS.negative],
			[dl, COLORS.positive]
		];
		for (const [data, color] of draws) {
			g.append('path')
				.datum(data)
				.attr('fill', color)
				.attr('fill-opacity', 0.22)
				.attr('stroke', color)
				.attr('stroke-width', 1.5)
				.attr('d', area);
		}
		const medians: [Float64Array, string][] = [
			[early, COLORS.negative],
			[late, COLORS.positive]
		];
		for (const [values, color] of medians) {
			const md = quantileSorted(values, 0.5) ?? 0;
			g.append('line')
				.attr('x1', x(md))
				.attr('x2', x(md))
				.attr('y1', 0)
				.attr('y2', ih)
				.attr('stroke', color)
				.attr('stroke-dasharray', '3 2')
				.attr('stroke-width', 1.2);
		}

		legendRow(svg.append('g').attr('transform', `translate(${m.l},8)`), [
			{ label: `${earlyLabel} (n=${early.length.toLocaleString()})`, color: COLORS.negative },
			{ label: `${lateLabel} (n=${late.length.toLocaleString()})`, color: COLORS.positive },
			{ label: 'medians', color: 'currentColor', dash: '3 2' }
		]);

		g.append('rect')
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'transparent')
			.on('pointermove', (event: PointerEvent) => {
				const [mx, my] = d3.pointer(event);
				const v = x.invert(mx);
				const i = de.findIndex((b) => v >= b.x0 && v < b.x1);
				if (i < 0) return tip.hide();
				tip.show(
					`<b>${fmt(de[i].x0)} – ${fmt(de[i].x1)}</b> ${unit}<br><span style="color:${COLORS.negative}">${earlyLabel}: ${(de[i].share * 100).toFixed(1)}%</span><br><span style="color:${COLORS.positive}">${lateLabel}: ${(dl[i].share * 100).toFixed(1)}%</span>`,
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
		aria-label="Distribution shift"
	></svg>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
