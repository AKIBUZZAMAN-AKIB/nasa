/**
 * Turns monthly data into the answers the explorer shows: what is changing,
 * where, how much, when, whether it is significant and how reliable it is.
 * Pure functions only; the fetching lives in data.ts.
 */
import {
	type MannKendallResult,
	benjaminiHochberg,
	detrend,
	effectiveSampleSize,
	hamedRaoMannKendall,
	mannKendall,
	mean,
	pearson,
	pettitt,
	segmentedTrend,
	sensSlope,
	spearman,
	tfpwMannKendall
} from './stats';

import type { Aggregation, Season } from './catalog';

/** Monthly values keyed by year * 100 + month. */
export type Monthly = Map<number, number>;

export const SIGNIFICANCE_LEVEL = 0.05;

export interface SeasonalSeries {
	years: number[];
	/** One value per year, null when too many months are missing. */
	values: (number | null)[];
	monthsPresent: number;
	monthsExpected: number;
}

/**
 * Combine the months of a season into one value per year. Means need at
 * least `minShare` of the months (three quarters by default); totals need
 * every month, because a missing month would make the total look smaller.
 * When a mean has gaps, the missing months are bridged with the month's
 * long-term average (climatology + mean anomaly), so a cloudy monsoon month
 * cannot pull the yearly mean towards the dry-season values.
 */
export function seasonalSeries(
	monthly: Monthly,
	season: Season,
	agg: Aggregation,
	fromYear: number,
	toYear: number,
	minShare = 0.75
): SeasonalSeries {
	const years: number[] = [];
	const values: (number | null)[] = [];
	let present = 0;
	let expected = 0;
	const need = monthsNeeded(season, agg, minShare);
	const clim = agg === 'mean' ? climatology(monthly) : new Map<number, number>();
	for (let year = fromYear; year <= toYear; year++) {
		const found: number[] = [];
		const anomalies: number[] = [];
		for (const month of season.months) {
			const y = season.decemberNextYear && month === 12 ? year - 1 : year;
			const v = monthly.get(y * 100 + month);
			if (v !== undefined && Number.isFinite(v)) {
				found.push(v);
				const c = clim.get(month);
				if (c !== undefined) anomalies.push(v - c);
			}
		}
		expected += season.months.length;
		present += found.length;
		years.push(year);
		if (found.length >= need && found.length > 0) {
			const total = found.reduce((a, b) => a + b, 0);
			if (agg === 'sum') values.push(total);
			else if (found.length === season.months.length || anomalies.length !== found.length) {
				values.push(total / found.length);
			} else {
				const climMean = mean(season.months.map((m) => clim.get(m) ?? NaN));
				values.push(Number.isFinite(climMean) ? climMean + mean(anomalies) : total / found.length);
			}
		} else {
			values.push(null);
		}
	}
	return { years, values, monthsPresent: present, monthsExpected: expected };
}

function monthsNeeded(season: Season, agg: Aggregation, minShare: number): number {
	return agg === 'sum'
		? season.months.length
		: Math.max(1, Math.ceil(season.months.length * minShare));
}

/** Long-term average of each calendar month (1-12). */
export function climatology(monthly: Monthly): Map<number, number> {
	const sums = new Map<number, { s: number; n: number }>();
	for (const [k, v] of monthly) {
		if (!Number.isFinite(v)) continue;
		const m = k % 100;
		const e = sums.get(m) ?? { s: 0, n: 0 };
		e.s += v;
		e.n++;
		sums.set(m, e);
	}
	return new Map([...sums].map(([m, e]) => [m, e.s / e.n]));
}

/** Series for yearly-only data (one value per year, no months). */
export function annualOnlySeries(
	annual: Map<number, number>,
	fromYear: number,
	toYear: number
): SeasonalSeries {
	const years: number[] = [];
	const values: (number | null)[] = [];
	let present = 0;
	for (let year = fromYear; year <= toYear; year++) {
		years.push(year);
		const v = annual.get(year);
		if (v !== undefined && Number.isFinite(v)) {
			values.push(v);
			present++;
		} else values.push(null);
	}
	return { years, values, monthsPresent: present, monthsExpected: years.length };
}

/** Last year that has enough months of the season to give a value. */
export function lastCompleteYear(
	monthly: Monthly,
	season: Season,
	agg: Aggregation = 'sum',
	minShare = 0.75
): number | undefined {
	let best: number | undefined;
	const need = monthsNeeded(season, agg, minShare);
	const keys = [...monthly.keys()];
	const years = new Set(keys.map((k) => Math.floor(k / 100)));
	const lastKey = Math.max(...keys);
	for (const year of years) {
		const count = season.months.filter((m) => {
			const y = season.decemberNextYear && m === 12 ? year - 1 : year;
			return monthly.has(y * 100 + m);
		}).length;
		// A season still in progress at the end of the record is not a year yet.
		const lastMonth = Math.max(
			...season.months.map((m) => (season.decemberNextYear && m === 12 ? year - 1 : year) * 100 + m)
		);
		if (lastMonth > lastKey) continue;
		if (count >= need && (best === undefined || year > best)) best = year;
	}
	return best;
}

export function firstYearOf(monthly: Monthly): number | undefined {
	let first: number | undefined;
	for (const k of monthly.keys()) {
		const y = Math.floor(k / 100);
		if (first === undefined || y < first) first = y;
	}
	return first;
}

export type Direction = 'increasing' | 'decreasing' | 'no trend';
export type Evidence = 'very strong' | 'strong' | 'weak' | 'none';

export interface ChangePoint {
	/** 'rate' = the slope changed; 'shift' = the average level jumped; 'none'. */
	kind: 'rate' | 'shift' | 'none';
	/** First year of the new behaviour. */
	year?: number;
	/** Per-decade Sen slopes before and after (rate) or means before and after (shift). */
	before?: number;
	after?: number;
	/** Words for what happened after the change, e.g. 'faster increase'. */
	phrase?: string;
	p?: number;
	deltaBic?: number;
}

export interface TrendResult {
	years: number[];
	values: number[];
	n: number;
	firstYear: number;
	lastYear: number;
	mk: MannKendallResult;
	/** Hamed-Rao modified test: the primary test, robust to autocorrelation. */
	hr: MannKendallResult;
	tfpw: MannKendallResult & { lag1: number };
	slopePerYear: number;
	perDecade: number;
	perDecadeLow: number;
	perDecadeHigh: number;
	intercept: number;
	/** Sen slope times the length of the record. */
	totalChange: number;
	meanValue: number;
	direction: Direction;
	evidence: Evidence;
	significant: boolean;
	pettitt: ReturnType<typeof pettitt>;
	segmented: ReturnType<typeof segmentedTrend>;
	changePoint: ChangePoint;
}

export function evidenceFor(p: number): Evidence {
	if (p < 0.01) return 'very strong';
	if (p < SIGNIFICANCE_LEVEL) return 'strong';
	if (p < 0.1) return 'weak';
	return 'none';
}

function validPairs(series: SeasonalSeries): { years: number[]; values: number[] } {
	const years: number[] = [];
	const values: number[] = [];
	series.values.forEach((v, i) => {
		if (v !== null) {
			years.push(series.years[i]);
			values.push(v);
		}
	});
	return { years, values };
}

export const MIN_YEARS = 8;

/** Full trend analysis of one seasonal series; null when fewer than MIN_YEARS valid years. */
export function analyzeTrend(series: SeasonalSeries): TrendResult | null {
	const { years, values } = validPairs(series);
	const n = values.length;
	if (n < MIN_YEARS) return null;
	const mk = mannKendall(values);
	const hr = hamedRaoMannKendall(values);
	const tfpw = tfpwMannKendall(values);
	const sen = sensSlope(values, years);
	const significant = hr.p < SIGNIFICANCE_LEVEL && sen.slope !== 0;
	const direction: Direction = significant ? (hr.s > 0 ? 'increasing' : 'decreasing') : 'no trend';
	const pt = pettitt(values);
	const seg = segmentedTrend(values, years, Math.max(5, Math.floor(n / 6)));
	return {
		years,
		values,
		n,
		firstYear: years[0],
		lastYear: years[n - 1],
		mk,
		hr,
		tfpw,
		slopePerYear: sen.slope,
		perDecade: sen.slope * 10,
		perDecadeLow: sen.low * 10,
		perDecadeHigh: sen.high * 10,
		intercept: sen.intercept,
		totalChange: sen.slope * (years[n - 1] - years[0]),
		meanValue: mean(values),
		direction,
		evidence: evidenceFor(hr.p),
		significant,
		pettitt: pt,
		segmented: seg,
		changePoint: describeChangePoint(years, values, pt, seg)
	};
}

/**
 * Pick the change point to report. A change in the rate of change (two
 * separate trends fit clearly better than one) is reported first, because a
 * steady trend also makes Pettitt find a 'shift' in the middle of the
 * record. A Pettitt level shift is reported only when no rate change wins.
 */
export function describeChangePoint(
	years: number[],
	values: number[],
	pt: ReturnType<typeof pettitt>,
	seg: ReturnType<typeof segmentedTrend>
): ChangePoint {
	if (seg?.preferred) {
		const k = seg.index;
		const before = sensSlope(values.slice(0, k + 1), years.slice(0, k + 1)).slope * 10;
		const after = sensSlope(values.slice(k + 1), years.slice(k + 1)).slope * 10;
		return {
			kind: 'rate',
			year: years[k + 1],
			before,
			after,
			phrase: ratePhrase(before, after, values),
			deltaBic: seg.deltaBic
		};
	}
	if (pt && pt.p < SIGNIFICANCE_LEVEL) {
		return {
			kind: 'shift',
			year: years[pt.index + 1],
			before: pt.meanBefore,
			after: pt.meanAfter,
			phrase: pt.meanAfter > pt.meanBefore ? 'higher average' : 'lower average',
			p: pt.p
		};
	}
	return { kind: 'none', p: pt?.p };
}

/** Words for how a trend behaved after a break, from per-decade slopes. */
export function ratePhrase(before: number, after: number, values: number[]): string {
	const scale = Math.max(1e-9, Math.abs(mean(values)) * 0.002, Math.abs(before), Math.abs(after));
	const flat = (s: number) => Math.abs(s) < scale * 0.15;
	if (flat(after) && !flat(before))
		return before > 0 ? 'increase levelled off' : 'decrease levelled off';
	if (flat(before) && !flat(after)) return after > 0 ? 'started increasing' : 'started decreasing';
	if (flat(before) && flat(after)) return 'little change';
	if (Math.sign(before) !== Math.sign(after))
		return after > 0 ? 'reversed to an increase' : 'reversed to a decrease';
	const ratio = Math.abs(after) / Math.abs(before);
	const word = after > 0 ? 'increase' : 'decrease';
	if (ratio >= 2) return `rapid ${word}`;
	if (ratio >= 1.25) return `faster ${word}`;
	if (ratio <= 0.5) return `much slower ${word}`;
	if (ratio <= 0.8) return `slower ${word}`;
	return `steady ${word}`;
}

// ---------------------------------------------------------------------------
// Reliability and confidence
// ---------------------------------------------------------------------------

export type Level = 'High' | 'Medium' | 'Low';

export interface Agreement {
	label: string;
	level: Level | 'Not available';
	years?: number;
	r?: number;
	sameDirection?: boolean;
	otherPerDecade?: number;
	otherP?: number;
	reason?: string;
	/** Year the difference between the two datasets jumps (a possible inhomogeneity). */
	breakYear?: number;
	breakP?: number;
	/** Size of the jump in standard deviations. */
	breakShift?: number;
}

/** Pettitt p-value below which a jump in the dataset difference is flagged. */
export const BREAK_P = 0.01;
/** Smallest jump, in standard deviations of the difference, that is flagged. */
export const BREAK_SHIFT = 1;

/**
 * Homogeneity check: standardise both series, take their difference and
 * look for a level shift with the Pettitt test. Real climate change shows up
 * in both datasets and cancels in the difference; a jump that only one
 * dataset has points to a change in how that dataset was made (new
 * satellites, fewer rain gauges, a model change).
 */
export function differenceBreak(
	a: readonly number[],
	b: readonly number[],
	years: readonly number[]
): { year: number; p: number; shift: number } | null {
	if (a.length < MIN_YEARS || a.length !== b.length) return null;
	const za = zScores([...a]) as (number | null)[];
	const zb = zScores([...b]) as (number | null)[];
	const d: number[] = [];
	const dy: number[] = [];
	za.forEach((v, i) => {
		const w = zb[i];
		if (v !== null && w !== null) {
			d.push(v - w);
			dy.push(years[i]);
		}
	});
	const pt = pettitt(d);
	if (!pt) return null;
	const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean(d)) ** 2, 0) / Math.max(1, d.length - 1));
	const shift = sd > 0 ? Math.abs(pt.meanAfter - pt.meanBefore) / sd : 0;
	if (pt.p >= BREAK_P || shift < BREAK_SHIFT) return null;
	const before = pt.index + 1;
	if (before < 5 || d.length - before < 5) return null;
	return { year: dy[before], p: pt.p, shift };
}

/** Compare the main series with an independent dataset over their common years. */
export function datasetAgreement(
	label: string,
	main: SeasonalSeries,
	other: SeasonalSeries | null
): Agreement {
	if (!other)
		return { label, level: 'Not available', reason: 'No independent dataset for this variable.' };
	const a: number[] = [];
	const b: number[] = [];
	const years: number[] = [];
	main.years.forEach((year, i) => {
		const j = other.years.indexOf(year);
		const va = main.values[i];
		const vb = j >= 0 ? other.values[j] : null;
		if (va !== null && vb !== null && vb !== undefined) {
			a.push(va);
			b.push(vb);
			years.push(year);
		}
	});
	if (a.length < MIN_YEARS) {
		return {
			label,
			level: 'Not available',
			years: a.length,
			reason: `Only ${a.length} overlapping years with ${label}.`
		};
	}
	const r = pearson(a, b).r;
	const ta = hamedRaoMannKendall(a);
	const tb = hamedRaoMannKendall(b);
	const sa = sensSlope(a, years).slope;
	const sb = sensSlope(b, years).slope;
	const sigA = ta.p < SIGNIFICANCE_LEVEL;
	const sigB = tb.p < SIGNIFICANCE_LEVEL;
	// Same conclusion: both significant the same way, or neither significant.
	const sameDirection = sigA && sigB ? Math.sign(sa) === Math.sign(sb) : !sigA && !sigB;
	const signsMatch = Math.sign(sa) === Math.sign(sb);
	let level: Level;
	if (r >= 0.7 && sameDirection) level = 'High';
	else if ((r >= 0.4 && signsMatch) || sameDirection) level = 'Medium';
	else level = 'Low';
	const brk = differenceBreak(a, b, years);
	if (brk) level = 'Low';
	return {
		label,
		level,
		years: a.length,
		r,
		sameDirection,
		otherPerDecade: sb * 10,
		otherP: tb.p,
		breakYear: brk?.year,
		breakP: brk?.p,
		breakShift: brk?.shift
	};
}

export interface Reliability {
	coverage: number;
	recordYears: number;
	agreement: Agreement;
	dataReliability: Level;
	confidence: Level;
	reasons: string[];
}

/**
 * Score how far the trend can be trusted. Points: statistical evidence (0-2),
 * robustness to the autocorrelation method (0-1), data coverage (0-2),
 * record length (0-2) and dataset agreement (0-2, skipped when unavailable).
 */
export function assessReliability(
	trend: TrendResult,
	series: SeasonalSeries,
	agreement: Agreement
): Reliability {
	const coverage = series.monthsExpected ? series.monthsPresent / series.monthsExpected : 0;
	const recordYears = trend.lastYear - trend.firstYear + 1;
	const reasons: string[] = [];
	let data = 0;
	let dataMax = 4;
	if (coverage >= 0.95) data += 2;
	else if (coverage >= 0.8) {
		data += 1;
		reasons.push(`${Math.round(coverage * 100)}% of the months have data.`);
	} else reasons.push(`Only ${Math.round(coverage * 100)}% of the months have data.`);
	if (recordYears >= 30) data += 2;
	else if (recordYears >= 15) {
		data += 1;
		reasons.push(
			`The record is ${recordYears} years long; 30 or more is better for climate trends.`
		);
	} else reasons.push(`The record is only ${recordYears} years long.`);
	if (agreement.level !== 'Not available') {
		dataMax += 2;
		if (agreement.level === 'High') data += 2;
		else if (agreement.level === 'Medium') data += 1;
		if (agreement.level !== 'High')
			reasons.push(`Agreement with ${agreement.label} is ${agreement.level.toLowerCase()}.`);
	} else {
		reasons.push('No independent dataset was available to cross-check this variable.');
	}
	const dataRatio = data / dataMax;
	const dataReliability: Level = dataRatio >= 0.75 ? 'High' : dataRatio >= 0.45 ? 'Medium' : 'Low';

	let stat = 0;
	if (trend.hr.p < SIGNIFICANCE_LEVEL) stat += 2;
	else if (trend.hr.p < 0.1) stat += 1;
	const tfpwAgrees =
		trend.tfpw.p < SIGNIFICANCE_LEVEL && Math.sign(trend.tfpw.s) === Math.sign(trend.hr.s);
	if (tfpwAgrees && trend.significant) stat += 1;
	else if (trend.significant)
		reasons.push('The pre-whitened test does not confirm the trend at the 5% level.');
	if (!trend.significant)
		reasons.push('The trend is not statistically significant at the 5% level.');
	const ratio = (stat + data) / (3 + dataMax);
	let confidence: Level = ratio >= 0.75 ? 'High' : ratio >= 0.5 ? 'Medium' : 'Low';
	// A second dataset that tells a different story caps the confidence.
	if (agreement.level === 'Low' && confidence === 'High') confidence = 'Medium';
	if (agreement.breakYear !== undefined) {
		confidence = 'Low';
		reasons.unshift(
			`Possible data break around ${agreement.breakYear}: the gap between this dataset and ${agreement.label} jumps there, so part of the change may come from how the data were made, not from the Earth.`
		);
	}
	if (!trend.significant) confidence = 'Low';
	return { coverage, recordYears, agreement, dataReliability, confidence, reasons };
}

// ---------------------------------------------------------------------------
// Where: per-grid-cell trends with false discovery rate control
// ---------------------------------------------------------------------------

export interface CellTrend {
	lon: number;
	lat: number;
	perDecade: number;
	p: number;
	q: number;
	significant: boolean;
}

export interface SpatialSummary {
	cells: CellTrend[];
	significantCount: number;
	upCount: number;
	downCount: number;
	/** Cell with the largest significant change (or largest change when none is significant). */
	strongest?: CellTrend;
	min: number;
	max: number;
}

export function analyzeCells(
	cells: { lon: number; lat: number; monthly: Monthly }[],
	season: Season,
	agg: Aggregation,
	fromYear: number,
	toYear: number
): SpatialSummary | null {
	const raw: Omit<CellTrend, 'q' | 'significant'>[] = [];
	for (const cell of cells) {
		const { years, values } = validPairs(
			seasonalSeries(cell.monthly, season, agg, fromYear, toYear)
		);
		if (values.length < MIN_YEARS) continue;
		const p = hamedRaoMannKendall(values).p;
		const perDecade = sensSlope(values, years).slope * 10;
		raw.push({ lon: cell.lon, lat: cell.lat, perDecade, p });
	}
	if (!raw.length) return null;
	const q = benjaminiHochberg(raw.map((c) => c.p));
	const out: CellTrend[] = raw.map((c, i) => ({
		...c,
		q: q[i],
		significant: q[i] < SIGNIFICANCE_LEVEL && c.perDecade !== 0
	}));
	const sig = out.filter((c) => c.significant);
	const pool = sig.length ? sig : out;
	const strongest = pool.reduce((a, b) => (Math.abs(b.perDecade) > Math.abs(a.perDecade) ? b : a));
	return {
		cells: out,
		significantCount: sig.length,
		upCount: sig.filter((c) => c.perDecade > 0).length,
		downCount: sig.filter((c) => c.perDecade < 0).length,
		strongest,
		min: Math.min(...out.map((c) => c.perDecade)),
		max: Math.max(...out.map((c) => c.perDecade))
	};
}

// ---------------------------------------------------------------------------
// Cross-variable association
// ---------------------------------------------------------------------------

export interface PairAssociation {
	a: string;
	b: string;
	years: number;
	/** Spearman rank correlation of the raw yearly values. */
	rho: number;
	rhoP: number;
	/** Pearson correlation of the detrended values (year-to-year co-variation). */
	detrendedR: number;
	detrendedP: number;
	/** Effective sample size used for detrendedP (Bretherton et al. 1999). */
	nEffective: number;
	/** Benjamini-Hochberg q-value of detrendedP across all pairs. */
	q: number;
	strength: 'strong' | 'moderate' | 'weak' | 'none';
}

export function strengthOf(r: number): PairAssociation['strength'] {
	const a = Math.abs(r);
	if (a >= 0.6) return 'strong';
	if (a >= 0.4) return 'moderate';
	if (a >= 0.2) return 'weak';
	return 'none';
}

export function associate(
	series: { id: string; years: number[]; values: (number | null)[] }[]
): PairAssociation[] {
	const pairs: Omit<PairAssociation, 'q'>[] = [];
	for (let i = 0; i < series.length; i++) {
		for (let j = i + 1; j < series.length; j++) {
			const A = series[i];
			const B = series[j];
			const a: number[] = [];
			const b: number[] = [];
			const years: number[] = [];
			A.years.forEach((year, k) => {
				const m = B.years.indexOf(year);
				const va = A.values[k];
				const vb = m >= 0 ? B.values[m] : null;
				if (va !== null && vb !== null && vb !== undefined) {
					a.push(va);
					b.push(vb);
					years.push(year);
				}
			});
			if (a.length < MIN_YEARS) continue;
			const rs = spearman(a, b);
			const da = detrend(a, years);
			const db = detrend(b, years);
			const nEffective = effectiveSampleSize(da, db);
			const dp = pearson(da, db, nEffective);
			pairs.push({
				a: A.id,
				b: B.id,
				years: a.length,
				rho: rs.r,
				rhoP: rs.p,
				detrendedR: dp.r,
				detrendedP: dp.p,
				nEffective,
				strength: strengthOf(dp.r)
			});
		}
	}
	const q = benjaminiHochberg(pairs.map((p) => (Number.isFinite(p.detrendedP) ? p.detrendedP : 1)));
	return pairs.map((p, i) => ({ ...p, q: q[i] }));
}

/** Standardised anomalies (z-scores) so variables with different units share one chart. */
export function zScores(values: (number | null)[]): (number | null)[] {
	const valid = values.filter((v): v is number => v !== null);
	const m = mean(valid);
	const sd = Math.sqrt(valid.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, valid.length - 1));
	return values.map((v) => (v === null || !(sd > 0) ? null : (v - m) / sd));
}
