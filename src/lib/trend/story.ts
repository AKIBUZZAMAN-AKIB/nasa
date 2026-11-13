/**
 * Plain-language 'environmental trend story' built from the analysis. Two
 * voices: a research summary with the numbers, and an everyday version for
 * farmers, students and citizens. Association is never described as cause.
 */
import { type Region, compassPart } from './regions';

import type { PairAssociation, Reliability, SpatialSummary, TrendResult } from './analyze';
import type { Season, Variable } from './catalog';

export function formatNumber(value: number, decimals: number): string {
	if (!Number.isFinite(value)) return '–';
	const fixed =
		Math.abs(value) < 10 ** -decimals && value !== 0
			? value.toPrecision(2)
			: value.toFixed(decimals);
	return fixed.replace(/^-0(\.0+)?$/, '0');
}

export function signed(value: number, decimals: number): string {
	const s = formatNumber(value, decimals);
	return value > 0 && s !== '0' ? `+${s}` : s;
}

export function formatP(p: number): string {
	if (!Number.isFinite(p)) return 'n/a';
	if (p < 0.001) return '< 0.001';
	return p.toFixed(3);
}

/** Extra decimal for per-decade rates so small trends do not round to 0. */
export function rateDecimals(variable: Variable): number {
	return variable.decimals + 1;
}

/** Whether a percent change makes sense for this unit (not for temperatures or percentages). */
export function relativeChangeMeaningful(variable: Variable): boolean {
	return !['°C', '%', '% wet'].includes(variable.unit);
}

/** Place names that stay capitalised inside a sentence. */
const PROPER_NOUNS = /^(Arctic|Antarctic|Bengal|Bangladesh|Himalaya|Himalayan|Sundarbans|Earth)$/;

/** Lower-case a name but keep acronyms and dataset names (NASA, GISTEMP, MODIS) as they are. */
export function lowerName(name: string): string {
	return name
		.replace(/\s*\((NASA|MERRA|GPM|MODIS|NSIDC)[^)]*\)/g, '')
		.replace(/\s*\(since \d{4}\)/g, '')
		.split(' ')
		.map((w) => (/[A-Z].*[A-Z0-9]/.test(w) || PROPER_NOUNS.test(w) ? w : w.toLowerCase()))
		.join(' ');
}

export function seasonPhrase(season: Season): string {
	if (season.id === 'annual') return 'yearly';
	return season.name
		.replace(/ only$/, '')
		.replace(/ \(.*\)$/, '')
		.toLowerCase();
}

function aggregateWord(variable: Variable, season: Season): string {
	const when = season.id === 'annual' ? 'yearly' : seasonPhrase(season);
	return variable.agg === 'sum' ? `${when} total` : `${when} average`;
}

export interface Story {
	headline: string;
	research: string;
	everyday: string;
	/** Short labels in the problem statement's format, e.g. Trend: Increasing. */
	tags: { label: string; value: string }[];
}

export function buildStory(
	variable: Variable,
	region: Region,
	season: Season,
	trend: TrendResult,
	reliability: Reliability,
	spatial: SpatialSummary | null
): Story {
	const unit = variable.unit;
	const rd = rateDecimals(variable);
	const span = `${trend.firstYear}–${trend.lastYear}`;
	const what = `${aggregateWord(variable, season)} ${lowerName(variable.name)}`;
	const rate = `${signed(trend.perDecade, rd)} ${unit} per decade`;
	const total = `${signed(trend.totalChange, variable.decimals)} ${unit}`;
	const pct =
		relativeChangeMeaningful(variable) && trend.meanValue !== 0
			? ` (${signed((trend.totalChange / Math.abs(trend.meanValue)) * 100, 0)}% of the average)`
			: '';
	const cp = trend.changePoint;
	const regionName = region.name.replace(/ \(.*\)$/, '');
	// 'Arctic sea-ice extent' already names its place: no 'in Arctic Ocean'.
	const placeWord = regionName.split(' ')[0].toLowerCase();
	const namesPlace = variable.name.toLowerCase().split(/\s+/).includes(placeWord);
	const inRegion = namesPlace ? '' : ` in ${regionName}`;

	// --- Headline
	let headline: string;
	if (trend.direction === 'no trend') {
		headline = `No significant trend in ${what}${inRegion} (${span})`;
	} else {
		headline = `${capitalise(what)}${inRegion} ${trend.direction === 'increasing' ? 'increased' : 'decreased'} significantly (${span})`;
	}

	// --- Research voice
	const parts: string[] = [];
	if (trend.direction === 'no trend') {
		parts.push(
			`The ${what}${inRegion} shows no statistically significant monotonic trend over ${span} (Sen's slope ${rate}, modified Mann–Kendall p = ${formatP(trend.hr.p)}).`
		);
	} else {
		parts.push(
			`The ${what}${inRegion} ${trend.direction === 'increasing' ? 'increased' : 'decreased'} significantly over ${span}: ${rate} (Sen's slope, 95% CI ${signed(trend.perDecadeLow, rd)} to ${signed(trend.perDecadeHigh, rd)}), about ${total}${pct} over the record (modified Mann–Kendall p = ${formatP(trend.hr.p)}).`
		);
	}
	if (cp.kind === 'rate' && cp.year !== undefined) {
		parts.push(
			`The strongest change in behaviour came around ${cp.year}: ${signed(cp.before!, rd)} ${unit}/decade before and ${signed(cp.after!, rd)} ${unit}/decade from ${cp.year} on (${cp.phrase}).`
		);
	} else if (cp.kind === 'shift' && cp.year !== undefined) {
		parts.push(
			`The average level shifted around ${cp.year} (Pettitt p = ${formatP(cp.p!)}): ${formatNumber(cp.before!, variable.decimals)} ${unit} before, ${formatNumber(cp.after!, variable.decimals)} ${unit} after.`
		);
	} else {
		parts.push('No single clear change point stands out.');
	}
	if (spatial && spatial.cells.length > 1) {
		const where = spatial.strongest
			? compassPart(region, spatial.strongest.lon, spatial.strongest.lat)
			: '';
		parts.push(
			`${spatial.significantCount} of ${spatial.cells.length} grid cells show a significant trend after false-discovery-rate control${spatial.significantCount && where ? `, strongest in the ${where}` : ''}.`
		);
	}
	parts.push(
		`Data coverage ${Math.round(reliability.coverage * 100)}%, dataset agreement ${reliability.agreement.level.toLowerCase()}, confidence ${reliability.confidence.toLowerCase()}.`
	);

	// --- Everyday voice
	const e: string[] = [];
	const seasonWords = season.id === 'annual' ? '' : ` in the ${seasonPhrase(season)}`;
	const thing = variable.everydayName;
	if (trend.direction === 'no trend') {
		e.push(
			`${capitalise(thing)}${seasonWords}${inRegion} has gone up and down from year to year since ${trend.firstYear}, but there is no clear long-term rise or fall.`
		);
	} else {
		e.push(
			`${namesPlace ? capitalise(thing) : `In ${regionName}, ${thing}`}${seasonWords} went ${trend.direction === 'increasing' ? 'up' : 'down'} by about ${formatNumber(Math.abs(trend.totalChange), variable.decimals)} ${unit} between ${trend.firstYear} and ${trend.lastYear}${pct}.`
		);
	}
	if (cp.kind === 'rate' && cp.year !== undefined)
		e.push(`The biggest change started around ${cp.year} (${cp.phrase}).`);
	else if (cp.kind === 'shift' && cp.year !== undefined)
		e.push(`Things changed most around ${cp.year}.`);
	if (trend.direction !== 'no trend') {
		e.push(
			trend.evidence === 'very strong'
				? 'This is very unlikely to be just chance.'
				: 'This is unlikely to be just chance.'
		);
	} else if (trend.evidence === 'weak') {
		e.push('There is a small hint of a change, but not enough to be sure.');
	}
	const brk = reliability.agreement.breakYear;
	if (brk !== undefined) {
		parts.push(
			`Caution: the difference between this dataset and ${reliability.agreement.label} shifts abruptly around ${brk} (Pettitt p = ${formatP(reliability.agreement.breakP!)}), a sign of an inhomogeneity (for example a change in the observing system), so the trend may be partly artificial.`
		);
		e.push(
			`Be careful: a second, independent dataset tells a different story, and this data seems to jump around ${brk} because of changes in how it was made.`
		);
	}
	e.push(`How sure are we? ${reliability.confidence}.`);

	const tags = [
		{ label: 'Trend', value: capitalise(trend.direction) },
		{ label: 'Rate', value: rate },
		{
			label: 'Change point',
			value: cp.year !== undefined ? `${cp.year} (${cp.phrase})` : 'None detected'
		},
		{ label: 'Significance', value: significanceLabel(trend) },
		{ label: 'Data coverage', value: `${Math.round(reliability.coverage * 100)}%` },
		{ label: 'Dataset agreement', value: reliability.agreement.level },
		{ label: 'Confidence', value: reliability.confidence }
	];

	return { headline, research: parts.join(' '), everyday: e.join(' '), tags };
}

export function significanceLabel(trend: TrendResult): string {
	if (trend.evidence === 'very strong') return 'Highly significant (p < 0.01)';
	if (trend.evidence === 'strong') return 'Significant (p < 0.05)';
	if (trend.evidence === 'weak') return 'Weak evidence (p < 0.10)';
	return 'Not significant';
}

export function arrowFor(trend: TrendResult | null): string {
	if (!trend || trend.direction === 'no trend') return '→';
	return trend.direction === 'increasing' ? '↑' : '↓';
}

/** One line like 'Temperature ↑, Soil moisture ↓, NDVI →'. */
export function arrowsLine(items: { variable: Variable; trend: TrendResult | null }[]): string {
	return items
		.map(({ variable, trend }) => `${capitalise(variable.everydayName)} ${arrowFor(trend)}`)
		.join(', ');
}

export function associationSentence(pair: PairAssociation, nameA: string, nameB: string): string {
	const sig = pair.q < 0.05;
	if (pair.strength === 'none' || !sig) {
		return `${capitalise(nameA)} and ${nameB}: no reliable year-to-year association (r = ${pair.detrendedR.toFixed(2)}, q = ${formatP(pair.q)}).`;
	}
	const dir =
		pair.detrendedR > 0 ? 'tend to rise and fall together' : 'tend to move in opposite directions';
	return `${capitalise(nameA)} and ${nameB} ${dir} (${pair.strength}, r = ${pair.detrendedR.toFixed(2)}, q = ${formatP(pair.q)}). This is an association, not proof that one causes the other.`;
}

export function capitalise(s: string): string {
	return s ? s[0].toUpperCase() + s.slice(1) : s;
}
