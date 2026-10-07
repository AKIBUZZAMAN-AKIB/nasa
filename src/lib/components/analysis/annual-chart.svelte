<script lang="ts">
	import * as d3 from 'd3';

	import { COLORS, TOOLTIP_CLASS, fmt, legendRow, signed, styleAxis, tooltip } from './d3-utils';

	interface Line {
		slopePerYear: number;
		intercept: number;
	}

	interface Props {
		years: number[];
		values: number[];
		unit: string;
		mode?: 'line' | 'bar';
		label?: string;
		incomplete?: { year: number; value: number }[];
		ols?: Line;
		sen?: Line;
		change?: { year: number; meanBefore: number; meanAfter: number; pValue: number };
		compare?: { years: number[]; values: number[]; label: string };
		/** Colour bars by sign (difference series). */
		signColors?: boolean;
		/** Shade the climatological baseline period (as in the C3S Climate Atlas). */
		baseline?: [number, number];
		/** Optional legend text, e.g. "OLS −0.23/dec", for direct value labelling. */
		olsLabel?: string;
		senLabel?: string;
		height?: number;
	}

	let {
		years,
		values,
		unit,
		mode = 'line',
		label = 'Annual value',
		incomplete = [],
		ols,
		sen,
		change,
		compare,
		signColors = false,
		baseline,
		olsLabel = 'OLS',
		senLabel = "Sen's slope",
		height = 220
	}: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!svgEl || width < 50 || years.length === 0) return;
		draw(svgEl, width);
	});

	function draw(svgNode: SVGSVGElement, w: number) {
		const svg = d3.select(svgNode);
		svg.selectAll('*').remove();
		const m = { t: 22, r: 10, b: 22, l: 46 };
		const iw = w - m.l - m.r;
		const ih = height - m.t - m.b;
		const tip = tooltip(tipEl);

		const allYears = [...years, ...incomplete.map((d) => d.year), ...(compare?.years ?? [])];
		const [y0, y1] = d3.extent(allYears) as [number, number];
		const x = d3
			.scaleLinear()
			.domain([y0 - 0.6, y1 + 0.6])
			.range([0, iw]);

		const yValues = [...values, ...incomplete.map((d) => d.value), ...(compare?.values ?? [])];
		for (const line of [ols, sen]) {
			if (line)
				yValues.push(
					line.intercept + line.slopePerYear * y0,
					line.intercept + line.slopePerYear * y1
				);
		}
		let [lo, hi] = d3.extent(yValues.filter(Number.isFinite)) as [number, number];
		if (mode === 'bar') {
			if (lo > 0) lo = 0;
			if (hi < 0) hi = 0;
		}
		if (lo === hi) {
			lo -= 1;
			hi += 1;
		}
		const pad = (hi - lo) * 0.06;
		const y = d3
			.scaleLinear()
			.domain([mode === 'bar' && lo === 0 ? 0 : lo - pad, hi + pad])
			.nice()
			.range([ih, 0]);

		const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);

		// Baseline period shading (drawn first, under everything).
		if (baseline) {
			const b0 = Math.max(baseline[0], y0);
			const b1 = Math.min(baseline[1], y1);
			if (b1 >= b0) {
				g.append('rect')
					.attr('x', x(b0 - 0.5))
					.attr('width', x(b1 + 0.5) - x(b0 - 0.5))
					.attr('y', 0)
					.attr('height', ih)
					.attr('fill', 'currentColor')
					.attr('fill-opacity', 0.05);
				g.append('text')
					.attr('x', x(b1 + 0.5) - 3)
					.attr('y', ih - 4)
					.attr('text-anchor', 'end')
					.attr('font-size', 9)
					.attr('fill', 'currentColor')
					.attr('fill-opacity', 0.45)
					.text(`baseline ${baseline[0]}–${baseline[1]}`);
			}
		}

		// Grid + axes
		styleAxis(
			g.append('g').call(
				d3
					.axisLeft(y)
					.ticks(Math.max(3, Math.floor(ih / 36)))
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
						.ticks(Math.min(years.length, Math.floor(iw / 48)))
						.tickFormat(d3.format('d'))
				)
		);
		g.append('text')
			.attr('x', -m.l + 2)
			.attr('y', -10)
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.6)
			.text(unit);

		if (y.domain()[0] < 0 && y.domain()[1] > 0) {
			g.append('line')
				.attr('x1', 0)
				.attr('x2', iw)
				.attr('y1', y(0))
				.attr('y2', y(0))
				.attr('stroke', 'currentColor')
				.attr('stroke-opacity', 0.4);
		}

		// Data
		const step = iw / Math.max(1, y1 - y0 + 1.2);
		const barW = Math.max(1, step * 0.72);
		if (mode === 'bar') {
			const base = y(Math.max(y.domain()[0], Math.min(0, y.domain()[1])));
			g.append('g')
				.selectAll('rect')
				.data(years.map((year, i) => ({ year, value: values[i] })))
				.join('rect')
				.attr('x', (d) => x(d.year) - barW / 2)
				.attr('width', barW)
				.attr('y', base)
				.attr('height', 0)
				.attr('rx', Math.min(1.5, barW / 4))
				.attr('fill', (d) =>
					signColors ? (d.value >= 0 ? COLORS.positive : COLORS.negative) : COLORS.primary
				)
				.attr('fill-opacity', 0.8)
				.transition()
				.duration(450)
				.delay((_, i) => i * 6)
				.attr('y', (d) => Math.min(base, y(d.value)))
				.attr('height', (d) => Math.abs(y(d.value) - base));
		} else {
			const line = d3
				.line<number>()
				.x((_, i) => x(years[i]))
				.y((v) => y(v))
				.defined((v) => Number.isFinite(v));
			const path = g
				.append('path')
				.datum(values)
				.attr('fill', 'none')
				.attr('stroke', COLORS.primary)
				.attr('stroke-width', 1.6)
				.attr('d', line);
			const len = (path.node() as SVGPathElement).getTotalLength?.() ?? 0;
			if (len) {
				path
					.attr('stroke-dasharray', `${len} ${len}`)
					.attr('stroke-dashoffset', len)
					.transition()
					.duration(700)
					.ease(d3.easeCubicOut)
					.attr('stroke-dashoffset', 0)
					.on('end', function () {
						d3.select(this).attr('stroke-dasharray', null);
					});
			}
			g.append('g')
				.selectAll('circle')
				.data(years.map((year, i) => ({ year, value: values[i] })))
				.join('circle')
				.attr('cx', (d) => x(d.year))
				.attr('cy', (d) => y(d.value))
				.attr('r', 2.1)
				.attr('fill', COLORS.primary);
		}

		if (incomplete.length) {
			g.append('g')
				.selectAll('circle')
				.data(incomplete)
				.join('circle')
				.attr('cx', (d) => x(d.year))
				.attr('cy', (d) => y(d.value))
				.attr('r', 2.6)
				.attr('fill', 'none')
				.attr('stroke', 'currentColor')
				.attr('stroke-opacity', 0.45)
				.attr('stroke-dasharray', '1.5 1.5');
		}

		if (compare && compare.years.length) {
			const line = d3
				.line<number>()
				.x((_, i) => x(compare.years[i]))
				.y((v) => y(v))
				.defined((v) => Number.isFinite(v));
			g.append('path')
				.datum(compare.values)
				.attr('fill', 'none')
				.attr('stroke', COLORS.secondary)
				.attr('stroke-width', 1.6)
				.attr('d', line);
			g.append('g')
				.selectAll('circle')
				.data(compare.years.map((year, i) => ({ year, value: compare.values[i] })))
				.join('circle')
				.attr('cx', (d) => x(d.year))
				.attr('cy', (d) => y(d.value))
				.attr('r', 1.8)
				.attr('fill', COLORS.secondary);
		}

		// Change point (Pettitt): regime means before and after.
		if (change) {
			const cx = x(change.year - 0.5);
			g.append('line')
				.attr('x1', cx)
				.attr('x2', cx)
				.attr('y1', 0)
				.attr('y2', ih)
				.attr('stroke', COLORS.change)
				.attr('stroke-width', 1.2)
				.attr('stroke-dasharray', '4 3');
			g.append('line')
				.attr('x1', x(y0 - 0.5))
				.attr('x2', cx)
				.attr('y1', y(change.meanBefore))
				.attr('y2', y(change.meanBefore))
				.attr('stroke', COLORS.change)
				.attr('stroke-width', 1.8)
				.attr('stroke-opacity', 0.7);
			g.append('line')
				.attr('x1', cx)
				.attr('x2', x(y1 + 0.5))
				.attr('y1', y(change.meanAfter))
				.attr('y2', y(change.meanAfter))
				.attr('stroke', COLORS.change)
				.attr('stroke-width', 1.8)
				.attr('stroke-opacity', 0.7);
			g.append('text')
				.attr('x', Math.min(iw - 4, cx + 4))
				.attr('y', 10)
				.attr('font-size', 9)
				.attr('text-anchor', cx > iw - 90 ? 'end' : 'start')
				.attr('fill', COLORS.change)
				.text(
					`${change.year} · Δ ${signed(change.meanAfter - change.meanBefore)} (p ${change.pValue < 0.001 ? '< 0.001' : '= ' + change.pValue.toFixed(3)})`
				);
		}

		// Trend lines
		const trend = (line: Line, color: string, dash?: string) =>
			g
				.append('line')
				.attr('x1', x(y0))
				.attr('x2', x(y1))
				.attr('y1', y(line.intercept + line.slopePerYear * y0))
				.attr('y2', y(line.intercept + line.slopePerYear * y1))
				.attr('stroke', color)
				.attr('stroke-width', 1.6)
				.attr('stroke-dasharray', dash ?? null);
		if (ols) trend(ols, COLORS.ols);
		if (sen) trend(sen, COLORS.sen, '5 3');

		// Legend
		const items: { label: string; color: string; dash?: string; kind?: 'line' | 'box' }[] = [
			{ label, color: COLORS.primary, kind: mode === 'bar' ? 'box' : 'line' }
		];
		if (compare) items.push({ label: compare.label, color: COLORS.secondary });
		if (ols) items.push({ label: olsLabel, color: COLORS.ols });
		if (sen) items.push({ label: senLabel, color: COLORS.sen, dash: '5 3' });
		if (change)
			items.push({ label: `Step ${change.year} (Pettitt)`, color: COLORS.change, dash: '4 3' });
		legendRow(svg.append('g').attr('transform', `translate(${m.l},8)`), items);

		// Hover
		const guide = g
			.append('line')
			.attr('y1', 0)
			.attr('y2', ih)
			.attr('stroke', 'currentColor')
			.attr('stroke-opacity', 0)
			.attr('pointer-events', 'none');
		const byYear = new Map(years.map((yr, i) => [yr, values[i]]));
		const incompleteByYear = new Map(incomplete.map((d) => [d.year, d.value]));
		const compareByYear = new Map((compare?.years ?? []).map((yr, i) => [yr, compare!.values[i]]));
		g.append('rect')
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'transparent')
			.on('pointermove', (event: PointerEvent) => {
				const [mx, my] = d3.pointer(event);
				const yr = Math.round(x.invert(mx));
				const v = byYear.get(yr);
				const inc = incompleteByYear.get(yr);
				const c = compareByYear.get(yr);
				if (v === undefined && inc === undefined && c === undefined) {
					tip.hide();
					guide.attr('stroke-opacity', 0);
					return;
				}
				guide.attr('x1', x(yr)).attr('x2', x(yr)).attr('stroke-opacity', 0.3);
				const rows = [`<b>${yr}</b>`];
				if (v !== undefined) rows.push(`${label}: <b>${fmt(v)}</b> ${unit}`);
				if (inc !== undefined)
					rows.push(`<span style="opacity:.7">Incomplete year: ${fmt(inc)} ${unit}</span>`);
				if (c !== undefined && compare)
					rows.push(
						`<span style="color:${COLORS.secondary}">${compare.label}: <b>${fmt(c)}</b></span>`
					);
				if (v !== undefined && c !== undefined) rows.push(`Difference: ${signed(v - c)} ${unit}`);
				if (ols && v !== undefined)
					rows.push(
						`<span style="opacity:.7">vs OLS line: ${signed(v - (ols.intercept + ols.slopePerYear * yr))}</span>`
					);
				tip.show(rows.join('<br>'), mx + m.l, my + m.t);
			})
			.on('pointerleave', () => {
				tip.hide();
				guide.attr('stroke-opacity', 0);
			});
	}
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<svg bind:this={svgEl} {width} {height} class="block select-none" role="img" aria-label={label}
	></svg>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
