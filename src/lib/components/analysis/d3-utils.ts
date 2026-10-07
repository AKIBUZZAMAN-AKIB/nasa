/**
 * Shared D3 helpers for the analysis charts.
 *
 * Pattern (Svelte 5 + D3): Svelte owns the container, its size
 * (`bind:clientWidth`) and the reactive inputs; D3 owns everything inside the
 * <svg> and redraws inside an `$effect` whenever inputs or width change.
 * D3's axis generators already use `currentColor`, so charts follow the
 * app's light/dark theme without extra wiring.
 */
import * as d3 from 'd3';

import type { AggregateKind } from '$lib/analysis/analysis-stats';

/**
 * Categorical colours from the Okabe–Ito "Color Universal Design" palette,
 * distinguishable under the common colour-vision deficiencies (the IPCC AR6
 * style guide asks for colour-blind-safe line colours). Sign colours are the
 * end members of ColorBrewer RdBu, the IPCC temperature diverging scheme.
 */
export const COLORS = {
	primary: '#0072B2', // blue
	secondary: '#E69F00', // orange
	ols: '#D55E00', // vermilion
	sen: '#CC79A7', // reddish purple
	change: '#009E73', // bluish green
	positive: '#d6604d',
	negative: '#4393c3',
	baseline: 'currentColor',
	muted: 'currentColor'
} as const;

export const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

export type Selection = d3.Selection<SVGSVGElement, unknown, null, undefined>;

/** Number formatting with sensible digits for the value magnitude. */
export function fmt(value: number | undefined, digits?: number): string {
	if (value === undefined || !Number.isFinite(value)) return '–';
	const abs = Math.abs(value);
	const d = digits ?? (abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4);
	// No forced trailing zeros: axes read "100", "50", "0" rather than "100.0".
	return value.toLocaleString('en-US', { maximumFractionDigits: d });
}

export function signed(value: number | undefined, digits?: number): string {
	if (value === undefined || !Number.isFinite(value)) return '–';
	return `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmt(Math.abs(value), digits)}`;
}

export function pValueText(p: number | undefined): string {
	if (p === undefined || !Number.isFinite(p)) return 'n/a';
	if (p < 0.001) return '< 0.001';
	return p.toFixed(3);
}

/** Is a higher value "wetter" rather than "warmer"? Picks brown–teal vs blue–red. */
export function isHydrological(code: string, kind: AggregateKind): boolean {
	if (kind === 'rate') return true;
	return /PREC|RH2M|QV2M|GWET|SFMC|EVPTRNS|EVLAND|SNO|precip|rain|snow|humid|soil_moisture|et0|CLOUD|cloud/i.test(
		code
	);
}

/** Diverging interpolator where t=0 is "low" and t=1 is "high". */
export function divergingInterpolator(code: string, kind: AggregateKind): (t: number) => string {
	return isHydrological(code, kind) ? d3.interpolateBrBG : (t: number) => d3.interpolateRdBu(1 - t);
}

export function sequentialInterpolator(code: string, kind: AggregateKind): (t: number) => string {
	if (isHydrological(code, kind)) return d3.interpolateYlGnBu;
	if (/RADIATION|SW_DWN|radiation|ALLSKY|CLRSKY/i.test(code)) return d3.interpolateYlOrBr;
	// IPCC AR6 WGI style guide: sequential yellow→red for temperature and no
	// rainbow colour maps (they are not perceptually ordered).
	if (/^T|temperature|dew|bulb/i.test(code)) return d3.interpolateYlOrRd;
	return d3.interpolateViridis;
}

/** Symmetric diverging scale around zero (or a centre). */
export function symmetricDiverging(
	values: ArrayLike<number>,
	interpolator: (t: number) => string,
	centre = 0
) {
	let max = 0;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (Number.isFinite(v)) max = Math.max(max, Math.abs(v - centre));
	}
	if (max === 0) max = 1;
	return d3
		.scaleDiverging(interpolator)
		.domain([centre - max, centre, centre + max])
		.clamp(true);
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export interface Tooltip {
	show(html: string, x: number, y: number): void;
	hide(): void;
}

/** HTML tooltip positioned inside `container` (which must be position: relative). */
export function tooltip(element: HTMLDivElement | undefined): Tooltip {
	return {
		show(html, x, y) {
			if (!element) return;
			element.innerHTML = html;
			element.style.opacity = '1';
			const parent = element.parentElement;
			const pw = parent?.clientWidth ?? 0;
			const w = element.offsetWidth;
			const left = x + 12 + w > pw ? Math.max(0, x - 12 - w) : x + 12;
			element.style.transform = `translate(${left}px, ${Math.max(0, y - 10)}px)`;
		},
		hide() {
			if (element) element.style.opacity = '0';
		}
	};
}

export const TOOLTIP_CLASS =
	'pointer-events-none absolute left-0 top-0 z-10 max-w-[16rem] rounded-md border border-black/10 bg-white/95 px-2 py-1 text-[0.68rem] leading-snug text-neutral-900 shadow-md transition-opacity duration-100 dark:border-white/15 dark:bg-neutral-900/95 dark:text-neutral-100';

// ---------------------------------------------------------------------------
// Axes and legends
// ---------------------------------------------------------------------------

export function styleAxis(
	g: d3.Selection<SVGGElement, unknown, null, undefined>,
	grid = false,
	gridSize = 0
) {
	g.attr('font-size', 10).attr('font-family', 'inherit');
	g.select('.domain').attr('stroke-opacity', 0.25);
	g.selectAll('.tick line').attr('stroke-opacity', grid ? 0.08 : 0.25);
	g.selectAll('.tick text').attr('fill-opacity', 0.7);
	if (grid && gridSize) g.selectAll('.tick line').attr('x2', gridSize);
	return g;
}

/** Horizontal colour legend for a continuous colour scale. */
export function colorLegend(
	parent: d3.Selection<SVGGElement, unknown, null, undefined>,
	color: (v: number) => string,
	domain: [number, number],
	width: number,
	label: string,
	formatter: (v: number) => string = (v) => fmt(v)
) {
	const id = `grad-${Math.random().toString(36).slice(2, 9)}`;
	const defs = parent.append('defs');
	const gradient = defs.append('linearGradient').attr('id', id);
	const stops = 16;
	for (let i = 0; i <= stops; i++) {
		const t = i / stops;
		gradient
			.append('stop')
			.attr('offset', `${t * 100}%`)
			.attr('stop-color', color(domain[0] + t * (domain[1] - domain[0])));
	}
	parent
		.append('rect')
		.attr('width', width)
		.attr('height', 8)
		.attr('rx', 2)
		.attr('fill', `url(#${id})`);
	const scale = d3.scaleLinear().domain(domain).range([0, width]);
	const axis = parent
		.append('g')
		.attr('transform', 'translate(0,8)')
		.call(
			d3
				.axisBottom(scale)
				.ticks(Math.max(2, Math.floor(width / 60)))
				.tickSize(3)
				.tickFormat((v) => formatter(Number(v)))
		);
	styleAxis(axis);
	axis.select('.domain').remove();
	parent
		.append('text')
		.attr('y', -3)
		.attr('font-size', 9)
		.attr('fill', 'currentColor')
		.attr('fill-opacity', 0.7)
		.text(label);
}

/** Inline legend row: [{ label, color, dash? }]. */
export function legendRow(
	parent: d3.Selection<SVGGElement, unknown, null, undefined>,
	items: { label: string; color: string; dash?: string; kind?: 'line' | 'box' }[]
) {
	let x = 0;
	for (const item of items) {
		const g = parent.append('g').attr('transform', `translate(${x},0)`);
		if (item.kind === 'box') {
			g.append('rect')
				.attr('y', -4)
				.attr('width', 10)
				.attr('height', 8)
				.attr('rx', 1.5)
				.attr('fill', item.color);
		} else {
			g.append('line')
				.attr('x1', 0)
				.attr('x2', 12)
				.attr('stroke', item.color)
				.attr('stroke-width', 2)
				.attr('stroke-dasharray', item.dash ?? null);
		}
		const text = g
			.append('text')
			.attr('x', 15)
			.attr('dy', '0.32em')
			.attr('font-size', 10)
			.attr('fill', 'currentColor')
			.attr('fill-opacity', 0.8)
			.text(item.label);
		const w =
			(text.node() as SVGTextElement | null)?.getComputedTextLength?.() ?? item.label.length * 5;
		x += 15 + w + 12;
	}
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Serialize an <svg> (resolving currentColor) and trigger a download. */
export function downloadSvg(svg: SVGSVGElement | undefined | null, filename: string): void {
	if (!svg) return;
	const clone = svg.cloneNode(true) as SVGSVGElement;
	const color = getComputedStyle(svg).color || '#000';
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	clone.setAttribute(
		'style',
		`color:${color};font-family:system-ui,sans-serif;background:transparent`
	);
	const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
	triggerDownload(blob, filename);
}

export function downloadCsv(rows: (string | number)[][], filename: string): void {
	const text = rows
		.map((r) =>
			r
				.map((c) =>
					typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c)
				)
				.join(',')
		)
		.join('\n');
	triggerDownload(new Blob([text], { type: 'text/csv' }), filename);
}

function triggerDownload(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
