<script lang="ts">
	import * as d3 from 'd3';

	import {
		MONTHS,
		TOOLTIP_CLASS,
		colorLegend,
		divergingInterpolator,
		fmt,
		sequentialInterpolator,
		signed,
		styleAxis,
		symmetricDiverging,
		tooltip
	} from './d3-utils';

	import type { AggregateKind, MatrixCell } from '$lib/analysis/analysis-stats';

	interface Props {
		cells: MatrixCell[];
		mode: 'anomaly' | 'value';
		unit: string;
		code: string;
		kind: AggregateKind;
		baselineLabel: string;
	}

	let { cells, mode, unit, code, kind, baselineLabel }: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();
	const height = 12 * 15 + 64;

	$effect(() => {
		if (!svgEl || width < 50 || cells.length === 0) return;
		draw(svgEl, width);
	});

	function draw(svgNode: SVGSVGElement, w: number) {
		const svg = d3.select(svgNode);
		svg.selectAll('*').remove();
		const tip = tooltip(tipEl);
		const m = { t: 6, r: 10, b: 50, l: 30 };
		const iw = w - m.l - m.r;
		const ih = height - m.t - m.b;
		const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => a - b);
		const x = d3.scaleBand<number>().domain(years).range([0, iw]).padding(0.04);
		const y = d3.scaleBand<number>().domain(d3.range(12)).range([0, ih]).padding(0.06);

		const accessor = (c: MatrixCell) => (mode === 'anomaly' ? c.anomaly : c.value);
		const values = cells.map(accessor);
		let color: (v: number) => string;
		let domain: [number, number];
		if (mode === 'anomaly') {
			const scale = symmetricDiverging(values, divergingInterpolator(code, kind));
			const d = scale.domain();
			domain = [d[0], d[2]];
			color = (v) => scale(v);
		} else {
			const ext = d3.extent(values) as [number, number];
			const scale = d3.scaleSequential(sequentialInterpolator(code, kind)).domain(ext);
			domain = ext;
			color = (v) => scale(v);
		}

		const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
		g.append('g')
			.selectAll('rect')
			.data(cells)
			.join('rect')
			.attr('x', (c) => x(c.year) ?? 0)
			.attr('y', (c) => y(c.month) ?? 0)
			.attr('width', x.bandwidth())
			.attr('height', y.bandwidth())
			.attr('rx', Math.min(1.5, x.bandwidth() / 4))
			.attr('fill', (c) => color(accessor(c)))
			.attr('opacity', 0)
			.transition()
			.duration(350)
			.delay((c) => (years.indexOf(c.year) / years.length) * 300)
			.attr('opacity', 1);

		styleAxis(
			g.append('g').call(
				d3
					.axisLeft(y)
					.tickFormat((i) => MONTHS[Number(i)].slice(0, 3))
					.tickSize(0)
			)
		)
			.select('.domain')
			.remove();
		const tickEvery = years.length > 60 ? 10 : years.length > 25 ? 5 : 2;
		styleAxis(
			g
				.append('g')
				.attr('transform', `translate(0,${ih})`)
				.call(
					d3
						.axisBottom(x)
						.tickValues(years.filter((yr) => yr % tickEvery === 0))
						.tickFormat(d3.format('d'))
						.tickSize(2)
				)
		)
			.select('.domain')
			.remove();

		const legendW = Math.min(240, iw * 0.6);
		colorLegend(
			svg.append('g').attr('transform', `translate(${m.l + iw - legendW},${height - 22})`),
			color,
			domain,
			legendW,
			mode === 'anomaly' ? `Anomaly (${unit}) vs ${baselineLabel}` : unit,
			mode === 'anomaly' ? (v) => signed(v) : (v) => fmt(v)
		);

		const hl = g
			.append('rect')
			.attr('fill', 'none')
			.attr('stroke', 'currentColor')
			.attr('stroke-width', 1.4)
			.attr('opacity', 0)
			.attr('pointer-events', 'none');
		const index = new Map(cells.map((c) => [c.year * 12 + c.month, c]));
		g.append('rect')
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'transparent')
			.on('pointermove', (event: PointerEvent) => {
				const [mx, my] = d3.pointer(event);
				const yi = Math.floor((mx / iw) * years.length);
				const mi = Math.floor((my / ih) * 12);
				const c = index.get(years[yi] * 12 + mi);
				if (!c) {
					tip.hide();
					hl.attr('opacity', 0);
					return;
				}
				hl.attr('x', x(c.year) ?? 0)
					.attr('y', y(c.month) ?? 0)
					.attr('width', x.bandwidth())
					.attr('height', y.bandwidth())
					.attr('opacity', 0.9);
				tip.show(
					`<b>${MONTHS[c.month]} ${c.year}</b><br>Value: <b>${fmt(c.value)}</b> ${unit}<br>Anomaly: <b>${signed(c.anomaly)}</b>`,
					mx + m.l,
					my + m.t
				);
			})
			.on('pointerleave', () => {
				tip.hide();
				hl.attr('opacity', 0);
			});
	}
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<svg
		bind:this={svgEl}
		{width}
		{height}
		class="block select-none"
		role="img"
		aria-label="Year by month heatmap"
	></svg>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
