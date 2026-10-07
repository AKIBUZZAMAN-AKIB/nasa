/**
 * Source-agnostic statistics for the Historical analysis panel.
 *
 * Everything here is pure and operates on `{ time, value }` samples in epoch
 * milliseconds, so Open-Meteo (ERA5 family) and NASA POWER series go through
 * exactly the same code path. Design decisions, with references:
 *
 * - Trends are fitted to *annual* aggregates, never to daily samples. Daily
 *   samples are strongly autocorrelated and the seasonal cycle dominates their
 *   variance, so a daily OLS fit reports absurdly small p-values.
 * - The OLS p-value is additionally corrected for lag-1 autocorrelation of
 *   the residuals with the effective sample size of Santer et al. (2000,
 *   JGR 105(D6) 7337–7356): n_eff = n (1 − r1) / (1 + r1), df = n_eff − 2.
 * - Mann-Kendall / Sen's slope give the distribution-free cross-check.
 * - The Pettitt (1979) test locates the most likely single change point. In
 *   reanalysis-derived series a significant change point often signals an
 *   inhomogeneity (input/observing-system change) rather than climate.
 * - Long series are drawn with Largest-Triangle-Three-Buckets downsampling
 *   (Steinarsson 2013), which keeps peaks and returns only real samples.
 * - All extrema use loops; `Math.min(...array)` overflows the call stack for
 *   hourly multi-decade series (~400k samples).
 */
import { type MannKendallResult, mannKendall, tPValue } from '$lib/archive-stats';

export type AggregateKind = 'mean' | 'rate' | 'count' | 'circular';
export type SampleResolution = 'hourly' | 'daily' | 'monthly';

export interface TimePoint {
	/** Epoch milliseconds, UTC. */
	time: number;
	value: number;
}

export const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = 365.25 * MS_PER_DAY;

// ---------------------------------------------------------------------------
// Basic helpers
// ---------------------------------------------------------------------------

export function extent(values: ArrayLike<number>): [number, number] {
	let lo = Infinity;
	let hi = -Infinity;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (!Number.isFinite(v)) continue;
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	return [lo, hi];
}

export function meanOf(values: ArrayLike<number>): number {
	let sum = 0;
	let n = 0;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (Number.isFinite(v)) {
			sum += v;
			n++;
		}
	}
	return n ? sum / n : NaN;
}

export function stdOf(values: ArrayLike<number>): number {
	const m = meanOf(values);
	let ss = 0;
	let n = 0;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (Number.isFinite(v)) {
			ss += (v - m) * (v - m);
			n++;
		}
	}
	return n > 1 ? Math.sqrt(ss / (n - 1)) : NaN;
}

/** Linear-interpolated quantile of an ascending-sorted array (type 7, as in R/NumPy). */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
	const n = sorted.length;
	if (n === 0) return NaN;
	if (n === 1) return sorted[0];
	const h = (n - 1) * Math.min(1, Math.max(0, p));
	const lo = Math.floor(h);
	const hi = Math.min(n - 1, lo + 1);
	return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function sortedFinite(values: ArrayLike<number>): Float64Array {
	const out: number[] = [];
	for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) out.push(values[i]);
	const arr = Float64Array.from(out);
	arr.sort();
	return arr;
}

export function pearsonR(a: ArrayLike<number>, b: ArrayLike<number>): number {
	const n = Math.min(a.length, b.length);
	let sa = 0;
	let sb = 0;
	let k = 0;
	for (let i = 0; i < n; i++) {
		if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
			sa += a[i];
			sb += b[i];
			k++;
		}
	}
	if (k < 3) return NaN;
	const ma = sa / k;
	const mb = sb / k;
	let cov = 0;
	let va = 0;
	let vb = 0;
	for (let i = 0; i < n; i++) {
		if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
			const da = a[i] - ma;
			const db = b[i] - mb;
			cov += da * db;
			va += da * da;
			vb += db * db;
		}
	}
	return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN;
}

export function daysInMonth(year: number, month0: number): number {
	return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function daysInYear(year: number): number {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** Vector mean of angles in degrees, returned in [0, 360). */
export function circularMeanDeg(sinSum: number, cosSum: number): number {
	if (sinSum === 0 && cosSum === 0) return NaN;
	const deg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
	return (deg + 360) % 360;
}

// ---------------------------------------------------------------------------
// Units of aggregated values
// ---------------------------------------------------------------------------

/** Human-friendly unit strings for the units NASA POWER and Open-Meteo report. */
export function prettyUnit(unit: string | undefined): string {
	if (!unit) return '';
	const map: Record<string, string> = {
		C: '°C',
		'MJ/m^2/day': 'MJ/m²/day',
		'kW-hr/m^2/day': 'kWh/m²/day',
		'm3 m-3': 'm³/m³',
		'kg m-2': 'kg/m²',
		'kg m-3': 'kg/m³',
		'W m-2': 'W/m²',
		'W/m^2': 'W/m²',
		'W m-2 x 40': 'UV index',
		Degrees: '°',
		dimensionless: '',
		'1': '',
		Days: 'days',
		'degree-day-c': '°C·day',
		Dobsons: 'DU'
	};
	return map[unit] ?? unit;
}

export interface AggregateUnits {
	sample: string;
	monthly: string;
	annual: string;
}

/**
 * Units after aggregation. A `rate` is a per-sample amount (mm/day, mm per
 * hour step, mm per day for daily sums) whose monthly/annual aggregate is a
 * total; a `count` (degree-days, frost days) is summed as-is.
 */
export function aggregateUnits(unit: string | undefined, kind: AggregateKind): AggregateUnits {
	const sample = prettyUnit(unit);
	if (kind === 'rate') {
		const base = sample.replace(/\/(day|hour|h|d)$/i, '') || sample;
		return { sample, monthly: `${base}/month`, annual: `${base}/yr` };
	}
	if (kind === 'count') {
		const base = sample || 'count';
		return { sample, monthly: `${base}/month`, annual: `${base}/yr` };
	}
	return { sample, monthly: sample, annual: sample };
}

// ---------------------------------------------------------------------------
// Monthly and annual aggregation with completeness
// ---------------------------------------------------------------------------

export interface MonthCell {
	year: number;
	/** 0–11 */
	month: number;
	value: number;
	/** Fraction of expected samples present, 0–1. */
	coverage: number;
	complete: boolean;
}

export interface AnnualPoint {
	year: number;
	value: number;
	/** Complete months / 12. */
	coverage: number;
	complete: boolean;
}

/** Monthly completeness threshold (fraction of expected daily/hourly samples). */
export const MONTH_COMPLETENESS = 0.8;

const monthKey = (year: number, month0: number) => year * 12 + month0;

/**
 * Aggregate samples into calendar months.
 *
 * - `mean`: arithmetic mean of samples.
 * - `circular`: vector mean (wind direction); arithmetic means of angles are
 *   wrong near north (350° and 10° average to 180°).
 * - `rate`: daily/hourly amounts are summed, then scaled to the full month
 *   when a few samples are missing; monthly POWER rates (mm/day) are
 *   multiplied by the days in the month.
 * - `count`: summed; monthly POWER counts are already monthly totals.
 */
export function aggregateMonthly(
	points: readonly TimePoint[],
	resolution: SampleResolution,
	kind: AggregateKind
): MonthCell[] {
	if (resolution === 'monthly') {
		const out: MonthCell[] = [];
		for (const p of points) {
			const d = new Date(p.time);
			const year = d.getUTCFullYear();
			const month = d.getUTCMonth();
			const value = kind === 'rate' ? p.value * daysInMonth(year, month) : p.value;
			out.push({ year, month, value, coverage: 1, complete: true });
		}
		out.sort((a, b) => monthKey(a.year, a.month) - monthKey(b.year, b.month));
		return out;
	}

	const perDay = resolution === 'hourly' ? 24 : 1;
	const acc = new Map<number, { n: number; sum: number; sin: number; cos: number }>();
	for (const p of points) {
		const d = new Date(p.time);
		const key = monthKey(d.getUTCFullYear(), d.getUTCMonth());
		let a = acc.get(key);
		if (!a) {
			a = { n: 0, sum: 0, sin: 0, cos: 0 };
			acc.set(key, a);
		}
		a.n++;
		if (kind === 'circular') {
			const r = (p.value * Math.PI) / 180;
			a.sin += Math.sin(r);
			a.cos += Math.cos(r);
		} else {
			a.sum += p.value;
		}
	}

	const out: MonthCell[] = [];
	for (const [key, a] of acc) {
		const year = Math.floor(key / 12);
		const month = key - year * 12;
		const expected = daysInMonth(year, month) * perDay;
		const coverage = Math.min(1, a.n / expected);
		let value: number;
		if (kind === 'circular') value = circularMeanDeg(a.sin, a.cos);
		else if (kind === 'mean') value = a.sum / a.n;
		else value = (a.sum * expected) / a.n;
		out.push({ year, month, value, coverage, complete: coverage >= MONTH_COMPLETENESS });
	}
	out.sort((a, b) => monthKey(a.year, a.month) - monthKey(b.year, b.month));
	return out;
}

/**
 * Annual aggregates from monthly cells. A year counts as complete only when
 * all 12 months are complete: dropping a monsoon month from a precipitation
 * total, or a winter month from a temperature mean, biases the year far more
 * than excluding it.
 */
export function aggregateAnnual(months: readonly MonthCell[], kind: AggregateKind): AnnualPoint[] {
	const byYear = new Map<number, MonthCell[]>();
	for (const m of months) {
		let list = byYear.get(m.year);
		if (!list) {
			list = [];
			byYear.set(m.year, list);
		}
		list.push(m);
	}
	const out: AnnualPoint[] = [];
	for (const [year, list] of byYear) {
		const valid = list.filter((m) => m.complete && Number.isFinite(m.value));
		const coverage = valid.length / 12;
		if (valid.length === 0) continue;
		let value: number;
		if (kind === 'rate' || kind === 'count') {
			value = 0;
			for (const m of valid) value += m.value;
		} else if (kind === 'circular') {
			let s = 0;
			let c = 0;
			for (const m of valid) {
				const w = daysInMonth(year, m.month);
				const r = (m.value * Math.PI) / 180;
				s += w * Math.sin(r);
				c += w * Math.cos(r);
			}
			value = circularMeanDeg(s, c);
		} else {
			let sum = 0;
			let w = 0;
			for (const m of valid) {
				const days = daysInMonth(year, m.month);
				sum += m.value * days;
				w += days;
			}
			value = sum / w;
		}
		out.push({ year, value, coverage, complete: valid.length === 12 });
	}
	out.sort((a, b) => a.year - b.year);
	return out;
}

/** Select samples whose UTC year lies within [startYear, endYear]. */
export function sliceYears<T extends { time: number }>(
	points: readonly T[],
	startYear: number,
	endYear: number
): T[] {
	const t0 = Date.UTC(startYear, 0, 1);
	const t1 = Date.UTC(endYear + 1, 0, 1);
	// Binary search: points are sorted ascending.
	let lo = 0;
	let hi = points.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (points[mid].time < t0) lo = mid + 1;
		else hi = mid;
	}
	const start = lo;
	hi = points.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (points[mid].time < t1) lo = mid + 1;
		else hi = mid;
	}
	return points.slice(start, lo);
}

// ---------------------------------------------------------------------------
// Trend tests on annual values
// ---------------------------------------------------------------------------

/** Lag-1 autocorrelation coefficient of a sequence. */
export function lag1Autocorrelation(values: ArrayLike<number>): number {
	const n = values.length;
	if (n < 3) return NaN;
	const m = meanOf(values);
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		const d = values[i] - m;
		den += d * d;
		if (i > 0) num += d * (values[i - 1] - m);
	}
	return den > 0 ? num / den : NaN;
}

/** Two-sided Student-t critical value for confidence `level`, found by bisection. */
export function tCritical(df: number, level = 0.95): number {
	if (!Number.isFinite(df) || df < 1) return NaN;
	const alpha = 1 - level;
	let lo = 0;
	let hi = 100;
	for (let i = 0; i < 80; i++) {
		const mid = (lo + hi) / 2;
		if (tPValue(mid, df) > alpha) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

export interface AnnualTrend {
	n: number;
	slopePerYear: number;
	slopePerDecade: number;
	/** Value of the fitted line at `x = year`: intercept + slope * year. */
	intercept: number;
	r2: number;
	/** Naive two-sided p-value, df = n − 2. */
	pValue: number;
	/** Lag-1 autocorrelation of residuals. */
	r1: number;
	/** Santer et al. (2000) effective sample size. */
	nEff: number;
	/** Autocorrelation-adjusted p-value, df = n_eff − 2. */
	pValueAdjusted: number;
	/** Half-width of the adjusted 95 % confidence interval, per decade. */
	ci95PerDecade: number;
}

export function annualTrend(
	years: readonly number[],
	values: readonly number[]
): AnnualTrend | undefined {
	const n = Math.min(years.length, values.length);
	if (n < 5) return undefined;
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < n; i++) {
		sx += years[i];
		sy += values[i];
	}
	const mx = sx / n;
	const my = sy / n;
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	for (let i = 0; i < n; i++) {
		const dx = years[i] - mx;
		const dy = values[i] - my;
		sxx += dx * dx;
		sxy += dx * dy;
		syy += dy * dy;
	}
	if (sxx === 0) return undefined;
	const slope = sxy / sxx;
	const intercept = my - slope * mx;
	const residuals = new Float64Array(n);
	let sse = 0;
	for (let i = 0; i < n; i++) {
		residuals[i] = values[i] - (intercept + slope * years[i]);
		sse += residuals[i] * residuals[i];
	}
	const r2 = syy > 0 ? 1 - sse / syy : 0;
	const dfNaive = n - 2;
	const se = Math.sqrt(sse / dfNaive / sxx);
	const t = se > 0 ? slope / se : slope === 0 ? 0 : Infinity;
	const pValue = se > 0 ? tPValue(t, dfNaive) : slope === 0 ? 1 : 0;

	const r1Raw = lag1Autocorrelation(residuals);
	const r1 = Number.isFinite(r1Raw) ? r1Raw : 0;
	// Only positive autocorrelation reduces the information content; a negative
	// r1 would inflate n_eff above n, which Santer et al. do not permit.
	const r1Used = Math.max(0, r1);
	const nEff = Math.max(2.5, (n * (1 - r1Used)) / (1 + r1Used));
	const dfAdj = Math.max(1, nEff - 2);
	// Residual variance uses the effective degrees of freedom as well.
	const seAdj = Math.sqrt(sse / dfAdj / sxx);
	const tAdj = seAdj > 0 ? slope / seAdj : 0;
	const pValueAdjusted = seAdj > 0 ? tPValue(tAdj, dfAdj) : pValue;
	const ci95PerDecade = seAdj * tCritical(dfAdj) * 10;

	return {
		n,
		slopePerYear: slope,
		slopePerDecade: slope * 10,
		intercept,
		r2,
		pValue,
		r1,
		nEff,
		pValueAdjusted,
		ci95PerDecade
	};
}

export interface SenTrend extends MannKendallResult {
	senSlopePerDecade: number;
	/** Conover intercept: median(value − slope·year). */
	intercept: number;
}

/** Mann-Kendall test and Sen's slope on whole years (exact year spacing). */
export function senTrend(
	years: readonly number[],
	values: readonly number[]
): SenTrend | undefined {
	const n = Math.min(years.length, values.length);
	if (n < 4) return undefined;
	const series = [];
	for (let i = 0; i < n; i++)
		series.push({ time: (years[i] - 1970) * MS_PER_YEAR, value: values[i] });
	const mk = mannKendall(series);
	if (!mk || !Number.isFinite(mk.senSlopePerYear)) return undefined;
	const residuals: number[] = [];
	for (let i = 0; i < n; i++) residuals.push(values[i] - mk.senSlopePerYear * years[i]);
	const sorted = sortedFinite(residuals);
	return {
		...mk,
		senSlopePerDecade: mk.senSlopePerYear * 10,
		intercept: quantileSorted(sorted, 0.5)
	};
}

export interface PettittResult {
	/** Index of the last sample of the first segment. */
	index: number;
	/** Pettitt K = max |U_t|. */
	k: number;
	/** Approximate two-sided p-value 2·exp(−6K²/(n³+n²)), capped at 1. */
	pValue: number;
	meanBefore: number;
	meanAfter: number;
	/** meanAfter − meanBefore. */
	shift: number;
	/** U_t for t = 1..n−1, useful for plotting. */
	u: number[];
}

/**
 * Pettitt (1979) non-parametric single change-point test using the rank form
 * U_k = 2·Σ_{i≤k} r_i − k(n+1), which equals the double sign sum and handles
 * ties through average ranks. The p-value is the asymptotic approximation and
 * is conservative-to-liberal for very short series; treat n < 20 with care.
 */
export function pettitt(values: readonly number[]): PettittResult | undefined {
	const n = values.length;
	if (n < 8) return undefined;
	const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
	const ranks = new Float64Array(n);
	for (let i = 0; i < n;) {
		let j = i;
		while (j + 1 < n && order[j + 1].v === order[i].v) j++;
		const avg = (i + j) / 2 + 1;
		for (let k = i; k <= j; k++) ranks[order[k].i] = avg;
		i = j + 1;
	}
	const u: number[] = [];
	let cumulative = 0;
	let k = 0;
	let index = 0;
	for (let t = 0; t < n - 1; t++) {
		cumulative += ranks[t];
		const ut = 2 * cumulative - (t + 1) * (n + 1);
		u.push(ut);
		if (Math.abs(ut) > k) {
			k = Math.abs(ut);
			index = t;
		}
	}
	const pValue = Math.min(1, 2 * Math.exp((-6 * k * k) / (n ** 3 + n ** 2)));
	const meanBefore = meanOf(values.slice(0, index + 1));
	const meanAfter = meanOf(values.slice(index + 1));
	return { index, k, pValue, meanBefore, meanAfter, shift: meanAfter - meanBefore, u };
}

// ---------------------------------------------------------------------------
// Climatology, anomalies, matrices
// ---------------------------------------------------------------------------

export interface MonthClimatology {
	month: number;
	n: number;
	mean: number;
	min: number;
	p10: number;
	p25: number;
	p50: number;
	p75: number;
	p90: number;
	max: number;
}

/** Per-calendar-month distribution of complete monthly values within [y0, y1]. */
export function monthlyClimatology(
	months: readonly MonthCell[],
	startYear: number,
	endYear: number,
	kind: AggregateKind
): MonthClimatology[] {
	const buckets: number[][] = Array.from({ length: 12 }, () => []);
	for (const m of months) {
		if (m.complete && m.year >= startYear && m.year <= endYear && Number.isFinite(m.value)) {
			buckets[m.month].push(m.value);
		}
	}
	return buckets.map((values, month) => {
		const sorted = sortedFinite(values);
		let mean = meanOf(values);
		if (kind === 'circular' && values.length) {
			let s = 0;
			let c = 0;
			for (const v of values) {
				s += Math.sin((v * Math.PI) / 180);
				c += Math.cos((v * Math.PI) / 180);
			}
			mean = circularMeanDeg(s, c);
		}
		return {
			month,
			n: values.length,
			mean,
			min: sorted.length ? sorted[0] : NaN,
			p10: quantileSorted(sorted, 0.1),
			p25: quantileSorted(sorted, 0.25),
			p50: quantileSorted(sorted, 0.5),
			p75: quantileSorted(sorted, 0.75),
			p90: quantileSorted(sorted, 0.9),
			max: sorted.length ? sorted[sorted.length - 1] : NaN
		};
	});
}

/** Signed smallest angular difference a − b in degrees, in (−180, 180]. */
export function angularDifference(a: number, b: number): number {
	let d = ((((a - b) % 360) + 540) % 360) - 180;
	if (d === -180) d = 180;
	return d;
}

export interface MatrixCell {
	year: number;
	month: number;
	value: number;
	anomaly: number;
}

/** Year × month matrix with anomalies against the per-month baseline mean. */
export function monthMatrix(
	months: readonly MonthCell[],
	climatology: readonly MonthClimatology[],
	startYear: number,
	endYear: number,
	kind: AggregateKind
): MatrixCell[] {
	const out: MatrixCell[] = [];
	for (const m of months) {
		if (!m.complete || m.year < startYear || m.year > endYear) continue;
		const base = climatology[m.month]?.mean;
		const anomaly =
			kind === 'circular' ? angularDifference(m.value, base) : m.value - (base ?? NaN);
		out.push({ year: m.year, month: m.month, value: m.value, anomaly });
	}
	return out;
}

export interface AnnualAnomalies {
	baselineLabel: string;
	baselineMean: number;
	/** True when the baseline window was fully available; otherwise period mean. */
	usesBaseline: boolean;
	years: number[];
	anomalies: number[];
	/** Ranked (descending) years by anomaly. */
	ranking: { year: number; anomaly: number }[];
	aboveCount: number;
}

export function annualAnomalies(
	annual: readonly AnnualPoint[],
	baselineStart: number,
	baselineEnd: number,
	kind: AggregateKind,
	periodStart = -Infinity,
	periodEnd = Infinity
): AnnualAnomalies | undefined {
	const allComplete = annual.filter((a) => a.complete);
	const complete = allComplete.filter((a) => a.year >= periodStart && a.year <= periodEnd);
	if (complete.length < 2) return undefined;
	// The baseline may lie partly outside the displayed period.
	const baseline = allComplete.filter((a) => a.year >= baselineStart && a.year <= baselineEnd);
	const expected = baselineEnd - baselineStart + 1;
	const usesBaseline = baseline.length >= Math.max(10, Math.floor(expected * 0.8));
	const reference = usesBaseline ? baseline : complete;
	let baselineMean: number;
	if (kind === 'circular') {
		let s = 0;
		let c = 0;
		for (const a of reference) {
			s += Math.sin((a.value * Math.PI) / 180);
			c += Math.cos((a.value * Math.PI) / 180);
		}
		baselineMean = circularMeanDeg(s, c);
	} else {
		baselineMean = meanOf(reference.map((a) => a.value));
	}
	const years = complete.map((a) => a.year);
	const anomalies = complete.map((a) =>
		kind === 'circular' ? angularDifference(a.value, baselineMean) : a.value - baselineMean
	);
	const ranking = years
		.map((year, i) => ({ year, anomaly: anomalies[i] }))
		.sort((a, b) => b.anomaly - a.anomaly);
	return {
		baselineLabel: usesBaseline
			? `${baselineStart}–${baselineEnd}`
			: `period mean ${years[0]}–${years[years.length - 1]}`,
		baselineMean,
		usesBaseline,
		years,
		anomalies,
		ranking,
		aboveCount: anomalies.filter((a) => a > 0).length
	};
}

// ---------------------------------------------------------------------------
// Extremes: ETCCDI-style percentile exceedance counts
// ---------------------------------------------------------------------------

export interface ExceedanceResult {
	label: string;
	lowLabel?: string;
	thresholdNote: string;
	years: number[];
	high: number[];
	low?: number[];
}

/** Day of year 0..365 with Feb 29 folded onto Feb 28 so calendars align. */
function dayIndex(time: number): number {
	const d = new Date(time);
	const y = d.getUTCFullYear();
	const start = Date.UTC(y, 0, 1);
	let doy = Math.floor((time - start) / MS_PER_DAY);
	const leap = daysInYear(y) === 366;
	if (leap && doy >= 59) doy -= 1; // 0-based 59 = Feb 29
	return doy; // 0..364
}

/**
 * Yearly counts of days beyond baseline percentiles, following the ETCCDI
 * TX90p/TN10p construction: a calendar-day threshold from a ±7-day window
 * over the baseline years. For precipitation-like `rate` series the
 * R95p-style count is used instead: days exceeding the 95th percentile of
 * baseline wet days (≥ 1 mm), plus the count of wet days.
 * Only daily series are supported; hourly/monthly return undefined.
 */
export function exceedanceCounts(
	points: readonly TimePoint[],
	resolution: SampleResolution,
	kind: AggregateKind,
	baselineStart: number,
	baselineEnd: number,
	completeYears: ReadonlySet<number>
): ExceedanceResult | undefined {
	if (resolution !== 'daily' || kind === 'circular' || kind === 'count') return undefined;
	const baseline = sliceYears(points, baselineStart, baselineEnd);
	if (baseline.length < 365 * 10) return undefined;

	const years = [...completeYears].sort((a, b) => a - b);
	const yearIndex = new Map(years.map((y, i) => [y, i]));

	if (kind === 'rate') {
		const wet = sortedFinite(baseline.filter((p) => p.value >= 1).map((p) => p.value));
		if (wet.length < 50) return undefined;
		const p95 = quantileSorted(wet, 0.95);
		const high = new Array(years.length).fill(0);
		const low = new Array(years.length).fill(0);
		for (const p of points) {
			const i = yearIndex.get(new Date(p.time).getUTCFullYear());
			if (i === undefined) continue;
			if (p.value > p95) high[i]++;
			if (p.value >= 1) low[i]++;
		}
		return {
			label: `Very wet days (> ${p95.toFixed(1)}, baseline wet-day p95)`,
			lowLabel: 'Wet days (≥ 1)',
			thresholdNote: `R95p-style threshold from ${baselineStart}–${baselineEnd} wet days`,
			years,
			high,
			low
		};
	}

	// Calendar-day percentiles with a ±7-day window.
	const byDay: number[][] = Array.from({ length: 365 }, () => []);
	for (const p of baseline) byDay[dayIndex(p.time)].push(p.value);
	const p90 = new Float64Array(365);
	const p10 = new Float64Array(365);
	for (let d = 0; d < 365; d++) {
		const window: number[] = [];
		for (let k = -7; k <= 7; k++) {
			const list = byDay[(d + k + 365) % 365];
			for (const v of list) window.push(v);
		}
		const sorted = sortedFinite(window);
		p90[d] = quantileSorted(sorted, 0.9);
		p10[d] = quantileSorted(sorted, 0.1);
	}
	const high = new Array(years.length).fill(0);
	const low = new Array(years.length).fill(0);
	for (const p of points) {
		const i = yearIndex.get(new Date(p.time).getUTCFullYear());
		if (i === undefined) continue;
		const d = dayIndex(p.time);
		if (p.value > p90[d]) high[i]++;
		if (p.value < p10[d]) low[i]++;
	}
	return {
		label: 'Days above calendar-day p90',
		lowLabel: 'Days below calendar-day p10',
		thresholdNote: `ETCCDI-style thresholds, ${baselineStart}–${baselineEnd}, ±7-day window (expected ≈ 36.5 days/yr each)`,
		years,
		high,
		low
	};
}

// ---------------------------------------------------------------------------
// Distribution shift
// ---------------------------------------------------------------------------

export interface DistributionSplit {
	earlyLabel: string;
	lateLabel: string;
	early: Float64Array;
	late: Float64Array;
	earlyStats: { p10: number; p50: number; p90: number; mean: number };
	lateStats: { p10: number; p50: number; p90: number; mean: number };
	note?: string;
}

/**
 * Compare the first and last third of the complete years. For precipitation
 * (`rate`) only wet samples (≥ 1 unit) are used because the dry-day spike at
 * zero hides every change in intensity.
 */
export function distributionSplit(
	points: readonly TimePoint[],
	completeYears: readonly number[],
	kind: AggregateKind
): DistributionSplit | undefined {
	const years = [...completeYears].sort((a, b) => a - b);
	if (years.length < 6) return undefined;
	const third = Math.max(2, Math.floor(years.length / 3));
	const earlyYears = new Set(years.slice(0, third));
	const lateYears = new Set(years.slice(-third));
	const early: number[] = [];
	const late: number[] = [];
	for (const p of points) {
		if (kind === 'rate' && p.value < 1) continue;
		const y = new Date(p.time).getUTCFullYear();
		if (earlyYears.has(y)) early.push(p.value);
		else if (lateYears.has(y)) late.push(p.value);
	}
	if (early.length < 10 || late.length < 10) return undefined;
	const e = sortedFinite(early);
	const l = sortedFinite(late);
	const stats = (s: Float64Array) => ({
		p10: quantileSorted(s, 0.1),
		p50: quantileSorted(s, 0.5),
		p90: quantileSorted(s, 0.9),
		mean: meanOf(s)
	});
	const ey = years.slice(0, third);
	const ly = years.slice(-third);
	return {
		earlyLabel: `${ey[0]}–${ey[ey.length - 1]}`,
		lateLabel: `${ly[0]}–${ly[ly.length - 1]}`,
		early: e,
		late: l,
		earlyStats: stats(e),
		lateStats: stats(l),
		note: kind === 'rate' ? 'Wet samples only (≥ 1).' : undefined
	};
}

// ---------------------------------------------------------------------------
// Two-source comparison
// ---------------------------------------------------------------------------

export interface SourceComparison {
	/** Annual values aligned on common complete years. */
	years: number[];
	primary: number[];
	secondary: number[];
	/** primary − secondary per year. */
	difference: number[];
	annualR: number;
	annualBias: number;
	annualRmse: number;
	/** Monthly anomalies (each source against its own monthly means). */
	monthlyR: number;
	monthlyN: number;
	monthlyBias: number;
	monthlyRmse: number;
	monthly: { year: number; month: number; primary: number; secondary: number }[];
	/** Daily metrics when both sources are daily. */
	dailyN?: number;
	dailyR?: number;
	dailyBias?: number;
	dailyRmse?: number;
	primaryTrend?: SenTrend;
	secondaryTrend?: SenTrend;
	differenceTrend?: SenTrend;
	differencePettitt?: PettittResult;
}

function rmse(diffs: readonly number[]): number {
	if (!diffs.length) return NaN;
	let s = 0;
	for (const d of diffs) s += d * d;
	return Math.sqrt(s / diffs.length);
}

export function compareSources(
	primaryMonths: readonly MonthCell[],
	secondaryMonths: readonly MonthCell[],
	kind: AggregateKind,
	startYear: number,
	endYear: number,
	primaryDaily?: readonly TimePoint[],
	secondaryDaily?: readonly TimePoint[]
): SourceComparison | undefined {
	const diff = (a: number, b: number) => (kind === 'circular' ? angularDifference(a, b) : a - b);
	const pa = aggregateAnnual(primaryMonths, kind).filter(
		(a) => a.complete && a.year >= startYear && a.year <= endYear
	);
	const sa = new Map(
		aggregateAnnual(secondaryMonths, kind)
			.filter((a) => a.complete)
			.map((a) => [a.year, a.value])
	);
	const years: number[] = [];
	const primary: number[] = [];
	const secondary: number[] = [];
	for (const a of pa) {
		const s = sa.get(a.year);
		if (s === undefined || !Number.isFinite(s)) continue;
		years.push(a.year);
		primary.push(a.value);
		secondary.push(s);
	}
	if (years.length < 3) return undefined;
	const difference = primary.map((p, i) => diff(p, secondary[i]));

	// Monthly anomalies, each against its own climatology over the common months.
	const sm = new Map(
		secondaryMonths.filter((m) => m.complete).map((m) => [m.year * 12 + m.month, m.value])
	);
	const monthly: SourceComparison['monthly'] = [];
	for (const m of primaryMonths) {
		if (!m.complete || m.year < startYear || m.year > endYear) continue;
		const s = sm.get(m.year * 12 + m.month);
		if (s === undefined || !Number.isFinite(s) || !Number.isFinite(m.value)) continue;
		monthly.push({ year: m.year, month: m.month, primary: m.value, secondary: s });
	}
	const pMean = new Array(12).fill(0);
	const sMean = new Array(12).fill(0);
	const cnt = new Array(12).fill(0);
	for (const m of monthly) {
		pMean[m.month] += m.primary;
		sMean[m.month] += m.secondary;
		cnt[m.month]++;
	}
	const pa2: number[] = [];
	const sa2: number[] = [];
	const md: number[] = [];
	for (const m of monthly) {
		pa2.push(m.primary - pMean[m.month] / cnt[m.month]);
		sa2.push(m.secondary - sMean[m.month] / cnt[m.month]);
		md.push(diff(m.primary, m.secondary));
	}

	const result: SourceComparison = {
		years,
		primary,
		secondary,
		difference,
		annualR: pearsonR(primary, secondary),
		annualBias: meanOf(difference),
		annualRmse: rmse(difference),
		monthlyR: kind === 'circular' ? NaN : pearsonR(pa2, sa2),
		monthlyN: monthly.length,
		monthlyBias: meanOf(md),
		monthlyRmse: rmse(md),
		monthly,
		primaryTrend: senTrend(years, primary),
		secondaryTrend: senTrend(years, secondary),
		differenceTrend: senTrend(years, difference),
		differencePettitt: pettitt(difference)
	};

	if (primaryDaily && secondaryDaily) {
		const byDay = new Map<number, number>();
		for (const p of sliceYears(secondaryDaily, startYear, endYear)) {
			byDay.set(Math.floor(p.time / MS_PER_DAY), p.value);
		}
		const a: number[] = [];
		const b: number[] = [];
		const d: number[] = [];
		for (const p of sliceYears(primaryDaily, startYear, endYear)) {
			const s = byDay.get(Math.floor(p.time / MS_PER_DAY));
			if (s === undefined) continue;
			a.push(p.value);
			b.push(s);
			d.push(diff(p.value, s));
		}
		if (a.length > 30) {
			result.dailyN = a.length;
			result.dailyR = kind === 'circular' ? NaN : pearsonR(a, b);
			result.dailyBias = meanOf(d);
			result.dailyRmse = rmse(d);
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Largest-Triangle-Three-Buckets downsampling (Steinarsson 2013). Keeps the
 * first and last samples and, from each bucket, the sample forming the
 * largest triangle with the previous pick and the next bucket's average.
 */
export function lttb<T extends TimePoint>(data: readonly T[], threshold: number): T[] {
	const n = data.length;
	if (threshold >= n || threshold < 3) return data.slice();
	const sampled: T[] = [data[0]];
	const every = (n - 2) / (threshold - 2);
	let a = 0;
	for (let i = 0; i < threshold - 2; i++) {
		const avgStart = Math.floor((i + 1) * every) + 1;
		const avgEnd = Math.min(n, Math.floor((i + 2) * every) + 1);
		let avgX = 0;
		let avgY = 0;
		const len = Math.max(1, avgEnd - avgStart);
		for (let j = avgStart; j < avgEnd; j++) {
			avgX += data[j].time;
			avgY += data[j].value;
		}
		avgX /= len;
		avgY /= len;
		const rangeStart = Math.floor(i * every) + 1;
		const rangeEnd = Math.floor((i + 1) * every) + 1;
		const ax = data[a].time;
		const ay = data[a].value;
		let maxArea = -1;
		let next = rangeStart;
		for (let j = rangeStart; j < rangeEnd; j++) {
			const area = Math.abs((ax - avgX) * (data[j].value - ay) - (ax - data[j].time) * (avgY - ay));
			if (area > maxArea) {
				maxArea = area;
				next = j;
			}
		}
		sampled.push(data[next]);
		a = next;
	}
	sampled.push(data[n - 1]);
	return sampled;
}

/** Centred moving average over `window` samples; edges use a shrinking window. */
export function movingAverage(points: readonly TimePoint[], window: number): TimePoint[] {
	if (window <= 1) return points.slice();
	const half = Math.floor(window / 2);
	const prefix = new Float64Array(points.length + 1);
	for (let i = 0; i < points.length; i++) prefix[i + 1] = prefix[i] + points[i].value;
	const out: TimePoint[] = [];
	for (let i = half; i < points.length - half; i++) {
		const lo = i - half;
		const hi = i + half + 1;
		out.push({ time: points[i].time, value: (prefix[hi] - prefix[lo]) / (hi - lo) });
	}
	return out;
}

/** Summary statistics of raw samples, loop-based. */
export function sampleSummary(points: readonly TimePoint[]) {
	const values = new Float64Array(points.length);
	for (let i = 0; i < points.length; i++) values[i] = points[i].value;
	const sorted = sortedFinite(values);
	let minIndex = 0;
	let maxIndex = 0;
	for (let i = 1; i < points.length; i++) {
		if (points[i].value < points[minIndex].value) minIndex = i;
		if (points[i].value > points[maxIndex].value) maxIndex = i;
	}
	return {
		n: points.length,
		mean: meanOf(values),
		sd: stdOf(values),
		p5: quantileSorted(sorted, 0.05),
		p50: quantileSorted(sorted, 0.5),
		p95: quantileSorted(sorted, 0.95),
		min: points.length ? points[minIndex] : undefined,
		max: points.length ? points[maxIndex] : undefined
	};
}
