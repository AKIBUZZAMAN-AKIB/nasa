<script lang="ts">
	import * as d3 from 'd3';

	import { COLORS, TOOLTIP_CLASS, colorLegend, fmt, styleAxis, tooltip } from './d3-utils';

	interface Datum {
		x: number;
		y: number;
		year: number;
		label?: string;
	}

	interface Props {
		data: Datum[];
		xLabel: string;
		yLabel: string;
		unit: string;
		height?: number;
	}

	let { data, xLabel, yLabel, unit, height = 280 }: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!svgEl || width < 50 || data.length < 3) return;
		draw(svgEl, width);
	});

	function draw(svgNode: SVGSVGElement, w: number) {
		const svg = d3.select(svgNode);
		svg.selectAll('*').remove();
		const tip = tooltip(tipEl);
		const m = { t: 10, r: 12, b: 58, l: 46 };
		const size = Math.min(w - m.l - m.r, height - m.t - m.b);
		const iw = w - m.l - m.r;
		const ih = size;
		const all = data.flatMap((d) => [d.x, d.y]);
		const ext = d3.extent(all) as [number, number];
		const pad = (ext[1] - ext[0]) * 0.04 || 1;
		const domain: [number, number] = [ext[0] - pad, ext[1] + pad];
		const x = d3.scaleLinear().domain(domain).nice().range([0, iw]);
		const y = d3.scaleLinear().domain(domain).nice().range([ih, 0]);
		const years = d3.extent(data, (d) => d.year) as [number, number];
		const color = d3.scaleSequential(d3.interpolateViridis).domain(years);

		const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
		styleAxis(
			g.append('g').call(
				d3
					.axisLeft(y)
					.ticks(5)
					.tickSize(-iw)
					.tickFormat((v) => fmt(Number(v)))
			),
			true
		);
		g.select('.domain').remove();
		styleAxis(
			g
				.append('g')
				.attr('transform', `translate(0,${ih})`)
				.call(
					d3
						.axisBottom(x)
						.ticks(Math.floor(iw / 60))
						.tickFormat((v) => fmt(Number(v)))
				)
		);
		g.append('text')
			.attr('x', iw)
			.attr('y', ih + 26)
			.attr('text-anchor', 'end')
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.7)
			.text(`${xLabel} (${unit})`);
		g.append('text')
			.attr('x', 4)
			.attr('y', 8)
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.7)
			.text(`${yLabel} (${unit})`);

		// 1:1 line
		const [d0, d1] = x.domain();
		g.append('line')
			.attr('x1', x(d0))
			.attr('y1', y(d0))
			.attr('x2', x(d1))
			.attr('y2', y(d1))
			.attr('stroke', 'currentColor')
			.attr('stroke-opacity', 0.45)
			.attr('stroke-dasharray', '4 3');

		// OLS fit y ~ x
		const mx = d3.mean(data, (d) => d.x) ?? 0;
		const my = d3.mean(data, (d) => d.y) ?? 0;
		let sxy = 0;
		let sxx = 0;
		for (const d of data) {
			sxy += (d.x - mx) * (d.y - my);
			sxx += (d.x - mx) ** 2;
		}
		if (sxx > 0) {
			const b = sxy / sxx;
			const a = my - b * mx;
			g.append('line')
				.attr('x1', x(d0))
				.attr('y1', y(a + b * d0))
				.attr('x2', x(d1))
				.attr('y2', y(a + b * d1))
				.attr('stroke', COLORS.ols)
				.attr('stroke-width', 1.4);
		}

		g.append('g')
			.selectAll('circle')
			.data(data)
			.join('circle')
			.attr('cx', (d) => x(d.x))
			.attr('cy', (d) => y(d.y))
			.attr('r', data.length > 300 ? 2 : 3)
			.attr('fill', (d) => color(d.year))
			.attr('fill-opacity', 0.85)
			.attr('stroke', 'white')
			.attr('stroke-width', 0.3);

		colorLegend(
			svg.append('g').attr('transform', `translate(${m.l},${height - 22})`),
			(v) => color(v),
			years,
			Math.min(200, iw * 0.6),
			'Year · dashed 1:1 · red OLS fit',
			(v) => String(Math.round(v))
		);

		const delaunay = d3.Delaunay.from(
			data,
			(d) => x(d.x),
			(d) => y(d.y)
		);
		const ring = g
			.append('circle')
			.attr('r', 5)
			.attr('fill', 'none')
			.attr('stroke', 'currentColor')
			.attr('opacity', 0);
		g.append('rect')
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'transparent')
			.on('pointermove', (event: PointerEvent) => {
				const [px, py] = d3.pointer(event);
				const i = delaunay.find(px, py);
				const d = data[i];
				if (!d) return;
				ring.attr('cx', x(d.x)).attr('cy', y(d.y)).attr('opacity', 0.8);
				tip.show(
					`<b>${d.label ?? d.year}</b><br>${xLabel}: ${fmt(d.x)}<br>${yLabel}: ${fmt(d.y)}<br>Difference: ${fmt(d.y - d.x)} ${unit}`,
					px + m.l,
					py + m.t
				);
			})
			.on('pointerleave', () => {
				tip.hide();
				ring.attr('opacity', 0);
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
		aria-label="Source scatter"
	></svg>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
