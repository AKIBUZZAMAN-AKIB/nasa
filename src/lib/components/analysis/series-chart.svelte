<script lang="ts">
	import * as d3 from 'd3';

	import { type TimePoint, lttb, movingAverage } from '$lib/analysis/analysis-stats';

	import { COLORS, TOOLTIP_CLASS, fmt, legendRow, styleAxis, tooltip } from './d3-utils';

	interface Props {
		points: TimePoint[];
		unit: string;
		label?: string;
		/** Moving-average window in samples (1 = off). */
		smooth?: number;
		smoothLabel?: string;
		secondary?: TimePoint[];
		secondaryLabel?: string;
		monthly?: boolean;
		height?: number;
	}

	let {
		points,
		unit,
		label = 'Value',
		smooth = 1,
		smoothLabel = '',
		secondary,
		secondaryLabel = 'Comparison',
		monthly = false,
		height = 270
	}: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();

	const smoothed = $derived(smooth > 1 ? movingAverage(points, smooth) : undefined);
	const smoothedSecondary = $derived(
		smooth > 1 && secondary ? movingAverage(secondary, smooth) : undefined
	);

	$effect(() => {
		if (!svgEl || width < 50 || points.length < 2) return;
		draw(svgEl, width, smoothed, smoothedSecondary);
	});

	const bisect = d3.bisector((d: TimePoint) => d.time);

	function sliceDomain(data: readonly TimePoint[], t0: number, t1: number): TimePoint[] {
		const a = Math.max(0, bisect.left(data, t0) - 1);
		const b = Math.min(data.length, bisect.right(data, t1) + 1);
		return data.slice(a, b);
	}

	function draw(svgNode: SVGSVGElement, w: number, smooth?: TimePoint[], smooth2?: TimePoint[]) {
		const svg = d3.select(svgNode);
		svg.selectAll('*').remove();
		const tip = tooltip(tipEl);
		const m = { t: 22, r: 10, b: 20, l: 46 };
		const ctxH = 42;
		const gap = 22;
		const iw = w - m.l - m.r;
		const fh = height - m.t - m.b - ctxH - gap;

		const fullDomain: [number, number] = [points[0].time, points[points.length - 1].time];
		const x = d3.scaleUtc().domain(fullDomain).range([0, iw]);
		const x2 = d3.scaleUtc().domain(fullDomain).range([0, iw]);
		const y = d3.scaleLinear().range([fh, 0]);
		const [clo, chi] = d3.extent(points, (d) => d.value) as [number, number];
		const y2 = d3.scaleLinear().domain([clo, chi]).nice().range([ctxH, 0]);

		const clipId = `clip-${Math.random().toString(36).slice(2, 8)}`;
		svg
			.append('defs')
			.append('clipPath')
			.attr('id', clipId)
			.append('rect')
			.attr('width', iw)
			.attr('height', fh);

		const focus = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
		const context = svg.append('g').attr('transform', `translate(${m.l},${m.t + fh + gap})`);

		const yAxisG = focus.append('g');
		const xAxisG = focus.append('g').attr('transform', `translate(0,${fh})`);
		const plot = focus.append('g').attr('clip-path', `url(#${clipId})`);
		const rawPath = plot
			.append('path')
			.attr('fill', 'none')
			.attr('stroke', COLORS.primary)
			.attr('stroke-width', 1)
			.attr('stroke-opacity', smooth ? 0.4 : 0.9);
		const secPath = plot
			.append('path')
			.attr('fill', 'none')
			.attr('stroke', COLORS.secondary)
			.attr('stroke-width', 1)
			.attr('stroke-opacity', smooth2 ? 0.35 : 0.8);
		const smoothPath = plot
			.append('path')
			.attr('fill', 'none')
			.attr('stroke', COLORS.primary)
			.attr('stroke-width', 1.8);
		const smooth2Path = plot
			.append('path')
			.attr('fill', 'none')
			.attr('stroke', COLORS.secondary)
			.attr('stroke-width', 1.8);
		focus
			.append('text')
			.attr('x', -m.l + 2)
			.attr('y', -10)
			.attr('font-size', 9)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.6)
			.text(unit);

		const line = d3
			.line<TimePoint>()
			.x((d) => x(d.time))
			.y((d) => y(d.value));
		const target = Math.max(200, Math.round(iw * 1.5));

		function render(domain: [number, number]) {
			x.domain(domain);
			const visible = sliceDomain(points, domain[0], domain[1]);
			const visible2 = secondary ? sliceDomain(secondary, domain[0], domain[1]) : [];
			const ext = d3.extent([...visible, ...visible2], (d) => d.value) as [number, number];
			y.domain(ext[0] === ext[1] ? [ext[0] - 1, ext[1] + 1] : ext).nice();
			rawPath.attr('d', line(lttb(visible, target)));
			secPath.attr('d', visible2.length ? line(lttb(visible2, target)) : null);
			smoothPath.attr(
				'd',
				smooth ? line(lttb(sliceDomain(smooth, domain[0], domain[1]), target)) : null
			);
			smooth2Path.attr(
				'd',
				smooth2 ? line(lttb(sliceDomain(smooth2, domain[0], domain[1]), target)) : null
			);
			yAxisG.selectAll('*').remove();
			styleAxis(
				yAxisG.call(
					d3
						.axisLeft(y)
						.ticks(Math.max(3, Math.floor(fh / 34)))
						.tickSize(-iw)
						.tickFormat((v) => fmt(Number(v)))
				),
				true
			);
			yAxisG.select('.domain').remove();
			xAxisG.selectAll('*').remove();
			styleAxis(xAxisG.call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(iw / 80)))));
		}

		// Context (overview) with brush
		const area = d3
			.area<TimePoint>()
			.x((d) => x2(d.time))
			.y0(ctxH)
			.y1((d) => y2(d.value));
		context
			.append('path')
			.datum(lttb(points, Math.round(iw)))
			.attr('fill', COLORS.primary)
			.attr('fill-opacity', 0.25)
			.attr('stroke', COLORS.primary)
			.attr('stroke-width', 0.6)
			.attr('d', area);
		styleAxis(
			context
				.append('g')
				.attr('transform', `translate(0,${ctxH})`)
				.call(d3.axisBottom(x2).ticks(Math.max(2, Math.floor(iw / 80))))
		);

		const brush = d3
			.brushX()
			.extent([
				[0, 0],
				[iw, ctxH]
			])
			.on('brush end', (event: d3.D3BrushEvent<unknown>) => {
				const s = event.selection as [number, number] | null;
				render(s ? [x2.invert(s[0]).getTime(), x2.invert(s[1]).getTime()] : fullDomain);
			});
		const brushG = context.append('g').call(brush);
		brushG
			.selectAll('.selection')
			.attr('fill', COLORS.primary)
			.attr('fill-opacity', 0.18)
			.attr('stroke', COLORS.primary);
		context
			.append('text')
			.attr('x', iw)
			.attr('y', -4)
			.attr('text-anchor', 'end')
			.attr('font-size', 8.5)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.55)
			.text('Drag here to zoom · double-click chart to reset');

		render(fullDomain);
		// Start zoomed to the last ~5 years for daily data so detail is visible.
		if (!monthly && points.length > 365 * 8) {
			const start = Math.max(fullDomain[0], fullDomain[1] - 5 * 365.25 * 86_400_000);
			brushG.call(brush.move, [x2(start), iw]);
		}

		// Legend
		const items: { label: string; color: string; dash?: string }[] = [
			{ label, color: COLORS.primary }
		];
		if (secondary) items.push({ label: secondaryLabel, color: COLORS.secondary });
		if (smooth) items.push({ label: smoothLabel, color: 'currentColor' });
		legendRow(svg.append('g').attr('transform', `translate(${m.l},8)`), items);

		// Hover on focus
		const dot = focus
			.append('circle')
			.attr('r', 3)
			.attr('fill', COLORS.primary)
			.attr('stroke', 'white')
			.attr('opacity', 0);
		const fmtDate = monthly ? d3.utcFormat('%b %Y') : d3.utcFormat('%d %b %Y');
		focus
			.append('rect')
			.attr('width', iw)
			.attr('height', fh)
			.attr('fill', 'transparent')
			.on('pointermove', (event: PointerEvent) => {
				const [mx, my] = d3.pointer(event);
				const t = x.invert(mx).getTime();
				const i = Math.min(points.length - 1, Math.max(0, bisect.center(points, t)));
				const p = points[i];
				dot.attr('cx', x(p.time)).attr('cy', y(p.value)).attr('opacity', 1);
				const rows = [
					`<b>${fmtDate(new Date(p.time))}</b>`,
					`${label}: <b>${fmt(p.value)}</b> ${unit}`
				];
				if (secondary?.length) {
					const j = bisect.center(secondary, p.time);
					const q = secondary[j];
					if (q && Math.abs(q.time - p.time) < 2 * 86_400_000)
						rows.push(
							`<span style="color:${COLORS.secondary}">${secondaryLabel}: <b>${fmt(q.value)}</b></span>`
						);
				}
				if (smooth?.length) {
					const k = bisect.center(smooth, p.time);
					if (smooth[k])
						rows.push(`<span style="opacity:.7">${smoothLabel}: ${fmt(smooth[k].value)}</span>`);
				}
				tip.show(rows.join('<br>'), mx + m.l, my + m.t);
			})
			.on('pointerleave', () => {
				dot.attr('opacity', 0);
				tip.hide();
			})
			.on('dblclick', () => brushG.call(brush.move, null));
	}
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<svg
		bind:this={svgEl}
		{width}
		{height}
		class="block select-none"
		role="img"
		aria-label="{label} time series"
	></svg>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
