<script lang="ts">
	import * as d3 from 'd3';

	import { type CellStatistic, type SpatialMetric, metricValue } from '$lib/analysis/spatial';

	import {
		TOOLTIP_CLASS,
		colorLegend,
		divergingInterpolator,
		fmt,
		pValueText,
		sequentialInterpolator,
		signed,
		styleAxis,
		symmetricDiverging,
		tooltip
	} from './d3-utils';

	import type { AggregateKind } from '$lib/analysis/analysis-stats';

	interface Props {
		cells: CellStatistic[];
		metric: SpatialMetric;
		latStep: number;
		lonStep: number;
		location: { latitude: number; longitude: number };
		bounds: {
			latitudeMin: number;
			latitudeMax: number;
			longitudeMin: number;
			longitudeMax: number;
		};
		unit: string;
		annualUnit: string;
		code: string;
		kind: AggregateKind;
		/** Called with a cell's coordinates when the user clicks it. */
		onpick?: (latitude: number, longitude: number) => void;
	}

	let {
		cells,
		metric,
		latStep,
		lonStep,
		location,
		bounds,
		unit,
		annualUnit,
		code,
		kind,
		onpick
	}: Props = $props();

	let width = $state(0);
	let svgEl: SVGSVGElement | undefined = $state();
	let tipEl: HTMLDivElement | undefined = $state();

	const heightFor = (w: number) => {
		const lonSpan = bounds.longitudeMax - bounds.longitudeMin + lonStep;
		const latSpan = bounds.latitudeMax - bounds.latitudeMin + latStep;
		const mid = ((bounds.latitudeMax + bounds.latitudeMin) / 2) * (Math.PI / 180);
		const ratio = latSpan / (lonSpan * Math.max(0.2, Math.cos(mid)));
		return Math.round(Math.min(420, Math.max(180, (w - 56) * ratio)) + 56);
	};
	const height = $derived(heightFor(width));

	$effect(() => {
		if (!svgEl || width < 50 || cells.length === 0) return;
		draw(svgEl, width, height);
	});

	function draw(svgNode: SVGSVGElement, w: number, h: number) {
		const svg = d3.select(svgNode);
		svg.selectAll('*').remove();
		const tip = tooltip(tipEl);
		const m = { t: 8, r: 10, b: 58, l: 42 };
		const iw = w - m.l - m.r;
		const ih = h - m.t - m.b;
		const lonMin = d3.min(cells, (c) => c.longitude)! - lonStep / 2;
		const lonMax = d3.max(cells, (c) => c.longitude)! + lonStep / 2;
		const latMin = d3.min(cells, (c) => c.latitude)! - latStep / 2;
		const latMax = d3.max(cells, (c) => c.latitude)! + latStep / 2;
		const x = d3.scaleLinear().domain([lonMin, lonMax]).range([0, iw]);
		const y = d3.scaleLinear().domain([latMin, latMax]).range([ih, 0]);

		const values = cells.map((c) => metricValue(c, metric));
		let color: (v: number) => string;
		let domain: [number, number];
		let legendLabel: string;
		let legendFmt = (v: number) => fmt(v);
		if (metric === 'sen' || metric === 'shift') {
			const s = symmetricDiverging(values, divergingInterpolator(code, kind));
			const d = s.domain();
			domain = [d[0], d[2]];
			color = (v) => s(v);
			legendLabel =
				metric === 'sen'
					? `Sen's slope (${annualUnit} per decade)`
					: `Pettitt shift (${annualUnit})`;
			legendFmt = (v) => signed(v);
		} else if (metric === 'changeYear') {
			const ext = d3.extent(values.filter(Number.isFinite)) as [number, number];
			const s = d3.scaleSequential(d3.interpolateViridis).domain(ext);
			domain = ext;
			color = (v) => s(v);
			legendLabel = 'Most likely change-point year (Pettitt)';
			legendFmt = (v) => String(Math.round(v));
		} else {
			const ext = d3.extent(values.filter(Number.isFinite)) as [number, number];
			const s = d3.scaleSequential(sequentialInterpolator(code, kind)).domain(ext);
			domain = ext;
			color = (v) => s(v);
			legendLabel = `Period mean (${annualUnit})`;
		}

		const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
		const cw = Math.abs(x(lonStep) - x(0));
		const ch = Math.abs(y(0) - y(latStep));
		g.append('g')
			.selectAll('rect')
			.data(cells)
			.join('rect')
			.attr('x', (c) => x(c.longitude - lonStep / 2))
			.attr('y', (c) => y(c.latitude + latStep / 2))
			.attr('width', cw + 0.4)
			.attr('height', ch + 0.4)
			.attr('fill', (c) => {
				const v = metricValue(c, metric);
				return Number.isFinite(v) ? color(v) : 'transparent';
			})
			.attr('opacity', 0)
			.transition()
			.duration(400)
			.attr('opacity', 1);

		// Significance stippling: p < 0.05 for the relevant test.
		const significant = cells.filter((c) =>
			metric === 'sen'
				? c.mkPValue < 0.05
				: metric === 'mean'
					? false
					: (c.changePValue ?? 1) < 0.05
		);
		g.append('g')
			.selectAll('circle')
			.data(significant)
			.join('circle')
			.attr('cx', (c) => x(c.longitude))
			.attr('cy', (c) => y(c.latitude))
			.attr('r', Math.max(1, Math.min(cw, ch) * 0.1))
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.65)
			.attr('pointer-events', 'none');

		// Selected location
		g.append('circle')
			.attr('cx', x(location.longitude))
			.attr('cy', y(location.latitude))
			.attr('r', 6)
			.attr('fill', 'none')
			.attr('stroke', 'white')
			.attr('stroke-width', 3);
		g.append('circle')
			.attr('cx', x(location.longitude))
			.attr('cy', y(location.latitude))
			.attr('r', 6)
			.attr('fill', 'none')
			.attr('stroke', 'black')
			.attr('stroke-width', 1.4);

		const fmtLon = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`;
		const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`;
		styleAxis(
			g
				.append('g')
				.attr('transform', `translate(0,${ih})`)
				.call(
					d3
						.axisBottom(x)
						.ticks(Math.floor(iw / 70))
						.tickFormat((v) => fmtLon(Number(v)))
				)
		);
		styleAxis(
			g.append('g').call(
				d3
					.axisLeft(y)
					.ticks(Math.floor(ih / 40))
					.tickFormat((v) => fmtLat(Number(v)))
			)
		);

		colorLegend(
			svg.append('g').attr('transform', `translate(${m.l},${h - 28})`),
			color,
			domain,
			Math.min(260, iw * 0.7),
			legendLabel,
			legendFmt
		);

		const hl = g
			.append('rect')
			.attr('fill', 'none')
			.attr('stroke', 'currentColor')
			.attr('stroke-width', 1.5)
			.attr('opacity', 0)
			.attr('pointer-events', 'none');
		const delaunay = d3.Delaunay.from(
			cells,
			(c) => x(c.longitude),
			(c) => y(c.latitude)
		);
		g.append('rect')
			.attr('width', iw)
			.attr('height', ih)
			.attr('fill', 'transparent')
			.style('cursor', onpick ? 'pointer' : 'default')
			.on('pointermove', (event: PointerEvent) => {
				const [px, py] = d3.pointer(event);
				const c = cells[delaunay.find(px, py)];
				if (!c) return;
				hl.attr('x', x(c.longitude - lonStep / 2))
					.attr('y', y(c.latitude + latStep / 2))
					.attr('width', cw)
					.attr('height', ch)
					.attr('opacity', 0.9);
				tip.show(
					[
						`<b>${fmtLat(c.latitude)}, ${fmtLon(c.longitude)}</b> · ${c.years} yrs`,
						`Mean: <b>${fmt(c.mean)}</b> ${annualUnit}`,
						`Sen: <b>${signed(c.senPerDecade)}</b> /decade (MK p ${pValueText(c.mkPValue)})`,
						c.changeYear
							? `Change point: <b>${c.changeYear}</b>, shift ${signed(c.shift)} (p ${pValueText(c.changePValue)})`
							: '',
						onpick ? '<span style="opacity:.6">Click to analyse this cell</span>' : ''
					]
						.filter(Boolean)
						.join('<br>'),
					px + m.l,
					py + m.t
				);
			})
			.on('pointerleave', () => {
				tip.hide();
				hl.attr('opacity', 0);
			})
			.on('click', (event: PointerEvent) => {
				const [px, py] = d3.pointer(event);
				const c = cells[delaunay.find(px, py)];
				if (c && onpick) onpick(c.latitude, c.longitude);
			});
		void unit;
	}
</script>

<div class="relative w-full" bind:clientWidth={width}>
	<svg
		bind:this={svgEl}
		{width}
		{height}
		class="block select-none"
		role="img"
		aria-label="Regional trend map"
	></svg>
	<div bind:this={tipEl} class={TOOLTIP_CLASS} style="opacity:0"></div>
</div>
