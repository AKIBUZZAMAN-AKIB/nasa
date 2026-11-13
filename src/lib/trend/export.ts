/**
 * Downloads: the chart as a PNG (with its title and source line drawn in),
 * and the analysed series and statistics as CSV.
 */
import { formatP } from './story';

import type { Analysis } from './run';

function download(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
}

const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity'];

/** Copy the computed paint of every element into attributes, so CSS variables survive. */
function inlineStyles(source: Element, target: Element): void {
	const cs = getComputedStyle(source);
	const style: string[] = [];
	for (const prop of PAINT) {
		const value = cs.getPropertyValue(prop);
		if (value) style.push(`${prop}:${value}`);
	}
	if (source instanceof SVGTextElement || source.tagName === 'text') {
		style.push(
			`font-family:${cs.fontFamily}`,
			`font-size:${cs.fontSize}`,
			`font-weight:${cs.fontWeight}`
		);
	}
	target.setAttribute('style', style.join(';'));
	const a = source.children;
	const b = target.children;
	for (let i = 0; i < a.length; i++) inlineStyles(a[i], b[i]);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const words = text.split(' ');
	const lines: string[] = [];
	let line = '';
	for (const w of words) {
		const next = line ? `${line} ${w}` : w;
		if (ctx.measureText(next).width > maxWidth && line) {
			lines.push(line);
			line = w;
		} else line = next;
	}
	if (line) lines.push(line);
	return lines;
}

/** Render an SVG chart to a PNG with a title above it and source lines below it. */
export async function downloadChartPng(
	svg: SVGSVGElement,
	opts: { title: string; subtitle: string; footer: string[]; filename: string; dark: boolean }
): Promise<void> {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	inlineStyles(svg, clone);
	const w = svg.viewBox.baseVal.width || svg.clientWidth;
	const h = svg.viewBox.baseVal.height || svg.clientHeight;
	clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	clone.setAttribute('width', String(w));
	clone.setAttribute('height', String(h));
	const xml = new XMLSerializer().serializeToString(clone);
	const img = new Image();
	const loaded = new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error('Could not draw the chart.'));
	});
	img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
	await loaded;

	const scale = 2;
	const pad = 24;
	const width = Math.max(w, 640) + pad * 2;
	const measure = document.createElement('canvas').getContext('2d')!;
	measure.font = '13px system-ui, sans-serif';
	const footer = opts.footer.flatMap((l) => wrap(measure, l, width - pad * 2));
	const height = pad + 26 + 20 + 12 + h + 14 + footer.length * 18 + pad;
	const canvas = document.createElement('canvas');
	canvas.width = width * scale;
	canvas.height = height * scale;
	const ctx = canvas.getContext('2d')!;
	ctx.scale(scale, scale);
	ctx.fillStyle = opts.dark ? '#0b1120' : '#ffffff';
	ctx.fillRect(0, 0, width, height);
	ctx.fillStyle = opts.dark ? '#f1f5f9' : '#0f172a';
	ctx.font = '600 18px system-ui, sans-serif';
	ctx.fillText(opts.title, pad, pad + 18);
	ctx.fillStyle = opts.dark ? '#cbd5e1' : '#475569';
	ctx.font = '13px system-ui, sans-serif';
	ctx.fillText(opts.subtitle, pad, pad + 26 + 16);
	ctx.drawImage(img, pad + (width - pad * 2 - w) / 2, pad + 26 + 20 + 12, w, h);
	let y = pad + 26 + 20 + 12 + h + 14 + 12;
	for (const line of footer) {
		ctx.fillText(line, pad, y);
		y += 18;
	}
	const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
	if (!blob) throw new Error('Could not create the image.');
	download(blob, opts.filename);
}

function csvCell(value: unknown): string {
	const s = value === null || value === undefined ? '' : String(value);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The yearly series, the Sen trend line and the reference dataset, with the statistics as comment lines. */
export function analysisCsv(a: Analysis, pageUrl: string): string {
	const t = a.trend;
	const v = a.variable;
	const rows: string[] = [];
	const meta: [string, unknown][] = [
		['Earth System Trend Explorer by DIVERGENT', pageUrl],
		['Variable', `${v.name} (${v.unit})`],
		['Region', a.region.name],
		['Season', a.season.name],
		['Period', `${t.firstYear}-${t.lastYear}`],
		['Dataset', `${v.dataset.name}; ${v.dataset.provider}; ${v.dataset.resolution}`],
		['Data access', v.dataset.live ? 'Live API request' : 'Bundled sample (precomputed)'],
		['Source URL', a.data.requestUrl],
		['Trend', t.direction],
		["Sen's slope per decade", t.perDecade],
		["Sen's slope 95% CI low", t.perDecadeLow],
		["Sen's slope 95% CI high", t.perDecadeHigh],
		['Mann-Kendall tau', t.mk.tau],
		['Mann-Kendall p', formatP(t.mk.p)],
		['Hamed-Rao modified MK p', formatP(t.hr.p)],
		['Pre-whitened (TFPW) MK p', formatP(t.tfpw.p)],
		['Lag-1 autocorrelation', t.tfpw.lag1],
		['Change point year', t.changePoint.year ?? ''],
		['Change point type', t.changePoint.kind],
		['Data coverage', a.reliability.coverage],
		['Dataset agreement', `${a.reliability.agreement.level} (${a.reliability.agreement.label})`],
		['Confidence', a.reliability.confidence]
	];
	for (const [k, val] of meta) rows.push(`# ${k}: ${val}`);
	const ref = a.agreementSeries;
	const header = ['year', `${v.id} (${v.unit})`, 'sen_trend_line'];
	if (ref) header.push(`reference: ${ref.label}`);
	rows.push(header.map(csvCell).join(','));
	a.series.years.forEach((year, i) => {
		const value = a.series.values[i];
		const line = t.intercept + t.slopePerYear * year;
		const cells: unknown[] = [year, value ?? '', Number(line.toFixed(6))];
		if (ref) {
			const j = ref.series.years.indexOf(year);
			cells.push(j >= 0 ? (ref.series.values[j] ?? '') : '');
		}
		rows.push(cells.map(csvCell).join(','));
	});
	return rows.join('\n') + '\n';
}

export function downloadCsv(text: string, filename: string): void {
	download(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename);
}
