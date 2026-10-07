<script lang="ts">
	import * as d3 from 'd3';

	import {
		COLORS,
		MONTHS,
		TOOLTIP_CLASS,
		fmt,
		legendRow,
		signed,
		styleAxis,
		tooltip
	} from './d3-utils';

	import type { MonthClimatology } from '$lib/analysis/analysis-stats';

	interface Props {
		climatology: MonthClimatology[];
		unit: string;
		baselineLabel: string;
		highlight?: { year: number; values: (number | undefined)[] };
		height?: number;
	}

	let { climatology, unit, baselineLabel, highlight, height = 250 }: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!svgEl || width < 50 || climatology.length !== 12) return;
		draw(svgEl, width);
	});

	function draw(svgNode: SVGSVGElement, w: number) {
		const svg = d3.select(svgNode);
		svg.selectAll('*').remove();
		const tip = tooltip(tipEl);
		const m = { t: 22, r: 10, b: 20, l: 46 };
		const iw = w - m.l - m.r;
		const ih = height - m.t - m.b;
		const valid = climatology.filter((c) => c.n > 0);
		if (!valid.length) return;

		const x = d3.scalePoint<number>().domain(d3.range(12)).range([0, iw]).padding(0.4);
		const vals = [
			...valid.flatMap((c) => [c.min, c.max]),
			...(highlight?.values.filter((v): v is number => v !== undefined && Number.isFinite(v)) ?? [])
		];
		const y = d3
			.scaleLinear()
			.domain(d3.extent(vals) as [number, number])
			.nice()
			.range([ih, 0]);
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
				.call(d3.axisBottom(x).tickFormat((i) => MONTHS[Number(i)]))
		);
		g.append('text')
			.attr('x', -m.l + 2)
			.attr('y', -10)
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.6)
			.text(unit);

		const band = (lo: keyof MonthClimatology, hi: keyof MonthClimatology) =>
			d3
				.area<MonthClimatology>()
				.defined((c) => c.n > 0)
				.x((c) => x(c.month) ?? 0)
				.y0((c) => y(c[lo] as number))
				.y1((c) => y(c[hi] as number))
				.curve(d3.curveMonotoneX);
		g.append('path')
			.datum(climatology)
			.attr('fill', COLORS.primary)
			.attr('fill-opacity', 0.14)
			.attr('d', band('p10', 'p90'));
		g.append('path')
			.datum(climatology)
			.attr('fill', COLORS.primary)
			.attr('fill-opacity', 0.28)
			.attr('d', band('p25', 'p75'));
		const line = (key: keyof MonthClimatology) =>
			d3
				.line<MonthClimatology>()
				.defined((c) => c.n > 0)
				.x((c) => x(c.month) ?? 0)
				.y((c) => y(c[key] as number))
				.curve(d3.curveMonotoneX);
		for (const key of ['min', 'max'] as const) {
			g.append('path')
				.datum(climatology)
				.attr('fill', 'none')
				.attr('stroke', COLORS.primary)
				.attr('stroke-opacity', 0.55)
				.attr('stroke-dasharray', '2 2')
				.attr('d', line(key));
		}
		g.append('path')
			.datum(climatology)
			.attr('fill', 'none')
			.attr('stroke', COLORS.primary)
			.attr('stroke-width', 2)
			.attr('d', line('p50'));

		if (highlight) {
			const pts = highlight.values
				.map((v, month) => ({ month, v }))
				.filter(
					(p): p is { month: number; v: number } => p.v !== undefined && Number.isFinite(p.v)
				);
			g.append('path')
				.datum(pts)
				.attr('fill', 'none')
				.attr('stroke', COLORS.secondary)
				.attr('stroke-width', 1.8)
				.attr(
					'd',
					d3
						.line<{ month: number; v: number }>()
						.x((p) => x(p.month) ?? 0)
						.y((p) => y(p.v))
						.curve(d3.curveMonotoneX)
				);
			g.append('g')
				.selectAll('circle')
				.data(pts)
				.join('circle')
				.attr('cx', (p) => x(p.month) ?? 0)
				.attr('cy', (p) => y(p.v))
				.attr('r', 3.2)
				.attr('stroke', 'white')
				.attr('stroke-width', 0.8)
				.attr('fill', (p) => {
					const c = climatology[p.month];
					if (p.v > c.p90 || p.v < c.p10) return p.v > c.p90 ? COLORS.positive : COLORS.negative;
					return COLORS.secondary;
				});
		}

		const items: { label: string; color: string; dash?: string; kind?: 'line' | 'box' }[] = [
			{ label: `Median ${baselineLabel}`, color: COLORS.primary },
			{ label: 'p25–p75', color: 'rgba(14,165,233,0.45)', kind: 'box' },
			{ label: 'p10–p90', color: 'rgba(14,165,233,0.2)', kind: 'box' },
			{ label: 'min/max', color: COLORS.primary, dash: '2 2' }
		];
		if (highlight) items.push({ label: String(highlight.year), color: COLORS.secondary });
		legendRow(svg.append('g').attr('transform', `translate(${m.l},8)`), items);

		const guide = g
			.append('line')
			.attr('y1', 0)
			.attr('y2', ih)
			.attr('stroke', 'currentColor')
			.attr('stroke-opacity', 0);
		g.append('rect')
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'transparent')
			.on('pointermove', (event: PointerEvent) => {
				const [mx, my] = d3.pointer(event);
				const idx = d3.minIndex(d3.range(12), (i) => Math.abs((x(i) ?? 0) - mx));
				const c = climatology[Math.max(0, idx)];
				if (!c || c.n === 0) return;
				guide
					.attr('x1', x(c.month) ?? 0)
					.attr('x2', x(c.month) ?? 0)
					.attr('stroke-opacity', 0.3);
				const hv = highlight?.values[c.month];
				const rows = [
					`<b>${MONTHS[c.month]}</b> · ${c.n} years`,
					`Median <b>${fmt(c.p50)}</b> · mean ${fmt(c.mean)} ${unit}`,
					`p10–p90: ${fmt(c.p10)} – ${fmt(c.p90)}`,
					`min–max: ${fmt(c.min)} – ${fmt(c.max)}`
				];
				if (highlight && hv !== undefined && Number.isFinite(hv)) {
					rows.push(
						`<span style="color:${COLORS.secondary}">${highlight.year}: <b>${fmt(hv)}</b> (${signed(hv - c.mean)} vs mean)</span>`
					);
				}
				tip.show(rows.join('<br>'), mx + m.l, my + m.t);
			})
			.on('pointerleave', () => {
				tip.hide();
				guide.attr('stroke-opacity', 0);
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
		aria-label="Monthly climatology"
	></svg>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
