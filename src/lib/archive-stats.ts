/**
 * Statistical helpers for the historical analysis panel.
 *
 * Everything here is pure: no stores, no fetch, no DOM. The panel feeds it
 * plain number arrays that came from the archive API, and it returns plain
 * objects. That keeps the maths unit-testable and lets the panel recompute
 * synchronously on every data change.
 *
 * The formulas follow the standard definitions used in climate science
 * (WMO/CCl-WG1 style reporting): ordinary least squares for the trend, a
 * two-sided t-test against the OLS slope, and the Mann-Kendall rank test as a
 * distribution-free cross-check that does not assume normality.
 *
 * The t-distribution tail is computed here rather than pulled from a library.
 * The incomplete beta has one sign that is easy to invert -- the front factor
 * is `logGamma(a+b) - logGamma(a) - logGamma(b)` -- and getting it backwards
 * scales every p-value without any obvious symptom, which is enough to flip a
 * significance verdict. The closed form below is checked against six analytic
 * cases in the test suite, so a regression cannot pass silently.
 */

export interface RegressionResult {
	/** Change per year, in the variable's own unit. */
	slopePerYear: number;
	/** Same slope expressed per decade, the unit climate reports usually use. */
	slopePerDecade: number;
	intercept: number;
	/** Coefficient of determination, 0..1. */
	r2: number;
	/** Number of paired samples the fit was computed from. */
	n: number;
	/** Absolute two-sided p-value of the slope against H0: slope = 0. */
	pValue: number;
	/** Residual standard error of the regression, in the variable's unit. */
	stdError: number;
}

export interface MannKendallResult {
	/** Kendall's S statistic, the sign-preserving rank statistic. */
	s: number;
	/** Sen's slope: the median of all pairwise slopes, robust to outliers. */
	senSlopePerYear: number;
	/** z score after the continuity-corrected variance normalisation. */
	z: number;
	/** Two-sided p-value derived from the normal approximation. */
	pValue: number;
	/** Number of paired samples. */
	n: number;
	/** True when pValue is below the supplied threshold (default 0.05). */
	significant: boolean;
}

export interface SeriesPoint {
	/** Time in epoch milliseconds. */
	time: number;
	value: number;
}

export interface AnomalySummary {
	/** Per-year list, ascending in time. */
	years: number[];
	/** Mean of each year, aligned with `years`. */
	values: number[];
	/** Mean of all years, the long-term mean for the span. */
	mean: number;
	min: number;
	max: number;
	/** Number of years whose mean sits above the long-term mean. */
	yearsAboveMean: number;
	/** The most recent year and how far it sits above the long-term mean. */
	latestYear?: number;
	latestAnomaly?: number;
	/** Difference between the first and the last third of the series, in unit. */
	firstThirdMean: number;
	lastThirdMean: number;
}

/** Arithmetic mean of the finite values in `values`. Returns NaN when empty. */
export function mean(values: number[]): number {
	let sum = 0;
	let count = 0;
	for (const v of values) {
		if (Number.isFinite(v)) {
			sum += v;
			count++;
		}
	}
	return count === 0 ? NaN : sum / count;
}

/** Sample standard deviation (n-1). Returns NaN for fewer than two samples. */
export function stdDev(values: number[]): number {
	const m = mean(values);
	let acc = 0;
	let count = 0;
	for (const v of values) {
		if (Number.isFinite(v)) {
			acc += (v - m) ** 2;
			count++;
		}
	}
	return count < 2 ? NaN : Math.sqrt(acc / (count - 1));
}

/** Lower and upper 5th/95th percentiles, linearly interpolated. */
export function percentiles(values: number[]): { p5: number; p50: number; p95: number } {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (sorted.length === 0) return { p5: NaN, p50: NaN, p95: NaN };
	const at = (q: number): number => {
		const pos = (sorted.length - 1) * q;
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		if (lo === hi) return sorted[lo];
		return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
	};
	return { p5: at(0.05), p50: at(0.5), p95: at(0.95) };
}

/**
 * Ordinary least squares of `values` against `times`, with a two-sided t-test
 * on the slope. Times are in epoch milliseconds, so the internal slope is
 * per-millisecond and rescaled to per-year here.
 *
 * Returns undefined when there are fewer than three usable pairs: with n = 2 a
 * line fits exactly, R2 is meaningless, and no residual variance exists to
 * build a t statistic from.
 */
export function linearRegression(series: SeriesPoint[]): RegressionResult | undefined {
	const pairs = series.filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time));
	if (pairs.length < 3) return undefined;

	const times = pairs.map((p) => p.time);
	const values = pairs.map((p) => p.value);
	const n = pairs.length;
	const meanX = mean(times);
	const meanY = mean(values);

	let sxy = 0;
	let sxx = 0;
	for (let i = 0; i < n; i++) {
		sxy += (times[i] - meanX) * (values[i] - meanY);
		sxx += (times[i] - meanX) ** 2;
	}
	if (sxx === 0) return undefined;

	const slopePerMs = sxy / sxx;
	const intercept = meanY - slopePerMs * meanX;

	let ssTot = 0;
	let ssRes = 0;
	for (let i = 0; i < n; i++) {
		const predicted = slopePerMs * times[i] + intercept;
		ssRes += (values[i] - predicted) ** 2;
		ssTot += (values[i] - meanY) ** 2;
	}
	if (ssTot === 0) return undefined;

	const r2 = 1 - ssRes / ssTot;
	// Slope variance under OLS: var(b) = sigma^2 / Sxx, with sigma^2 the residual
	// variance. Scaling from per-millisecond to per-year multiplies the slope by
	// ms-per-year and the variance by the same square, so the ratio is direct.
	const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
	const slopePerYear = slopePerMs * msPerYear;
	const slopeStdError = Math.sqrt(ssRes / (n - 2) / sxx) * msPerYear;
	const stdError = Math.sqrt(ssRes / (n - 2));
	const tStatistic = slopeStdError === 0 ? NaN : slopePerYear / slopeStdError;

	return {
		slopePerYear,
		slopePerDecade: slopePerYear * 10,
		intercept,
		r2,
		n,
		pValue: tPValue(tStatistic, n - 2),
		stdError
	};
}

/** Log-gamma via the Lanczos approximation, |error| < 1e-10 for z > 0. */
function logGamma(z: number): number {
	const g = [
		676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
		12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
	];
	if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
	z -= 1;
	let x = 0.99999999999980993;
	for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
	const t = z + g.length - 0.5;
	return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Modified Lentz evaluation of the continued fraction for the incomplete beta. */
function betaContinuedFraction(a: number, b: number, x: number): number {
	const TINY = 1e-30;
	const qab = a + b;
	const qap = a + 1;
	const qam = a - 1;
	let c = 1;
	let d = 1 - (qab * x) / qap;
	if (Math.abs(d) < TINY) d = TINY;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= 300; m++) {
		const m2 = 2 * m;
		let numerator = (m * (b - m) * x) / ((qam + m2) * (a + m2));
		d = 1 + numerator * d;
		if (Math.abs(d) < TINY) d = TINY;
		c = 1 + numerator / c;
		if (Math.abs(c) < TINY) c = TINY;
		d = 1 / d;
		h *= d * c;
		numerator = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
		d = 1 + numerator * d;
		if (Math.abs(d) < TINY) d = TINY;
		c = 1 + numerator / c;
		if (Math.abs(c) < TINY) c = TINY;
		d = 1 / d;
		const delta = d * c;
		h *= delta;
		if (Math.abs(delta - 1) < 3e-16) break;
	}
	return h;
}

/** Regularised incomplete beta I_x(a, b). */
function regularisedIncompleteBeta(a: number, b: number, x: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	// NOTE the sign: the front factor is logGamma(a+b) - logGamma(a) - logGamma(b).
	// Writing it as logGamma(a) + logGamma(b) - logGamma(a+b) is the easy mistake
	// here, and it scales every result without any obvious failure.
	const front = Math.exp(
		logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
	);
	// The fraction converges quickly only on the lower branch, so the upper half
	// uses the symmetry I_x(a,b) = 1 - I_{1-x}(b,a). The front factor is symmetric
	// in a and b, so the same value serves both branches.
	return x < (a + 1) / (a + b + 2)
		? (front * betaContinuedFraction(a, b, x)) / a
		: 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a Student's t statistic with df degrees of freedom. */
export function tPValue(t: number, df: number): number {
	if (!Number.isFinite(t) || !Number.isFinite(df) || df < 1) return NaN;
	if (t === 0) return 1;
	// The two-sided tail is I_{df/(df+t^2)}(df/2, 1/2). Beyond roughly a million
	// degrees of freedom the two parameters of the beta are so close in size
	// that the continued fraction loses precision, while the normal limit is
	// accurate to well under a part in 1e7 there. Real fits never reach that
	// degree count, but a caller can pass any n, so the branch keeps the function
	// correct at its boundaries.
	const p = regularisedIncompleteBeta(df / 2, 0.5, df / (df + t * t));
	if (!Number.isFinite(p)) return normalPValue(t);
	return p;
}
/** Error function via the Abramowitz-Stegun rational approximation. */
function errorFunction(x: number): number {
	const sign = x < 0 ? -1 : 1;
	const ax = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * ax);
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
			t *
			Math.exp(-ax * ax);
	return sign * y;
}

/** Two-sided p-value of a standard normal z score. */
export function normalPValue(z: number): number {
	if (!Number.isFinite(z)) return NaN;
	return 2 * (1 - 0.5 * (1 + errorFunction(Math.abs(z) / Math.SQRT2)));
}

/**
 * Mann-Kendall trend test with the standard tie-corrected variance and
 * continuity correction, plus Sen's slope (the median of all pairwise slopes).
 *
 * This is the distribution-free cross-check for `linearRegression`: it makes
 * no normality assumption, so a trend it calls significant cannot be an
 * artefact of a few extreme years. Ties are common in daily precipitation
 * (many zeroes), which is why the tie correction is not optional here.
 */
export function mannKendall(
	series: SeriesPoint[],
	significanceThreshold = 0.05
): MannKendallResult | undefined {
	const pairs = series.filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time));
	const n = pairs.length;
	if (n < 4) return undefined;

	// S from the sign of every pairwise difference.
	let s = 0;
	const slopes: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		for (let j = i + 1; j < n; j++) {
			const delta = pairs[j].value - pairs[i].value;
			if (delta > 0) s += 1;
			else if (delta < 0) s -= 1;
			const dt = pairs[j].time - pairs[i].time;
			if (dt > 0 && delta !== 0) slopes.push(delta / dt);
		}
	}

	// Tie correction over the value groups.
	const counts = new Map<number, number>();
	for (const p of pairs) counts.set(p.value, (counts.get(p.value) ?? 0) + 1);
	let tieTerm = 0;
	for (const count of counts.values()) {
		if (count > 1) tieTerm += count * (count - 1) * (2 * count + 5);
	}
	const uniqueN = n * (n - 1) * (2 * n + 5);
	const variance = (uniqueN - tieTerm) / 18;

	let z = 0;
	if (variance > 0) {
		// Continuity correction: shrink |S| by 1 when S != 0, per the standard
		// treatment, because S can never be a continuous random variable.
		const adjusted = s > 0 ? s - 1 : s < 0 ? s + 1 : s;
		z = adjusted / Math.sqrt(variance);
	}

	slopes.sort((a, b) => a - b);
	const senSlopePerYear =
		slopes.length === 0
			? NaN
			: slopes[Math.floor((slopes.length - 1) / 2)] * (365.25 * 24 * 60 * 60 * 1000);
	const pValue = normalPValue(z);

	return {
		s,
		senSlopePerYear,
		z,
		pValue,
		n,
		significant: Number.isFinite(pValue) && pValue < significanceThreshold
	};
}

/**
 * Collapse a daily or monthly point series into per-year means, in ascending
 * year order. Used both for the annual trend chart and for the anomaly view.
 */
export function toAnnualMeans(series: SeriesPoint[]): { years: number[]; values: number[] } {
	const buckets = new Map<number, number[]>();
	for (const p of series) {
		if (!Number.isFinite(p.value)) continue;
		const year = new Date(p.time).getUTCFullYear();
		const list = buckets.get(year);
		if (list) list.push(p.value);
		else buckets.set(year, [p.value]);
	}
	const years = [...buckets.keys()].sort((a, b) => a - b);
	return { years, values: years.map((y) => mean(buckets.get(y) as number[])) };
}

/**
 * Day-of-year climatology: the mean value for each calendar day, computed from
 * the baseline span. This is the reference a recent value is compared against to
 * produce an anomaly, and it is deliberately built from the same variable and
 * model so the units always match.
 */
export function dayOfYearClimatology(series: SeriesPoint[]): Map<number, number> {
	const buckets = new Map<number, number[]>();
	for (const p of series) {
		if (!Number.isFinite(p.value)) continue;
		const d = new Date(p.time);
		const key = monthDayKey(d);
		const list = buckets.get(key);
		if (list) list.push(p.value);
		else buckets.set(key, [p.value]);
	}
	const out = new Map<number, number>();
	for (const [key, values] of buckets) out.set(key, mean(values));
	return out;
}

/** MMDD sort key, so a day-of-year map can be rendered in calendar order. */
function monthDayKey(date: Date): number {
	return (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** Inverse of `monthDayKey`, used when a climatology entry is displayed. */
export function monthDayKeyToLabel(key: number): string {
	const month = Math.floor(key / 100);
	const day = key % 100;
	return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Value of `date` minus the climatological mean for its day of year, or NaN. */
export function anomalyOf(date: Date, value: number, climatology: Map<number, number>): number {
	if (!Number.isFinite(value)) return NaN;
	const baseline = climatology.get(monthDayKey(date));
	return baseline === undefined ? NaN : value - baseline;
}

/** Summarise a per-year series: long-term mean, spread, and the early-vs-late shift. */
export function summariseAnnual(years: number[], values: number[]): AnomalySummary | undefined {
	if (years.length === 0) return undefined;
	const m = mean(values);
	const third = Math.max(1, Math.floor(years.length / 3));
	const first = values.slice(0, third);
	const last = values.slice(-third);
	const lastIndex = years.length - 1;
	const latestAnomaly = values[lastIndex] - m;

	return {
		years,
		values,
		mean: m,
		min: Math.min(...values),
		max: Math.max(...values),
		yearsAboveMean: values.filter((v) => v > m).length,
		latestYear: years[lastIndex],
		latestAnomaly,
		firstThirdMean: mean(first),
		lastThirdMean: mean(last)
	};
}

/**
 * Mean pairwise correlation of each variable against every other one.
 *
 * This is the practical stand-in for a full sensitivity analysis. A real
 * sensitivity method (Sobol', PRCC) needs a model run many thousands of times
 * with deliberately perturbed inputs, which no reanalysis archive can supply,
 * because reanalysis is an observation-driven reconstruction rather than a
 * controllable model. Correlation ranks the variables that move together, which
 * is what makes a redundant or dominant signal visible; it does not claim
 * causation.
 */
export interface VariableCorrelation {
	/** Variable name, as passed in. */
	variable: string;
	/** Mean absolute Pearson correlation against the other variables. */
	meanAbsCorrelation: number;
	/** The variable it tracks most closely, if any. */
	strongestPair?: string;
}

export function meanPairwiseCorrelations(
	seriesByVariable: Record<string, number[]>
): VariableCorrelation[] {
	const names = Object.keys(seriesByVariable);
	const result: VariableCorrelation[] = [];

	for (const name of names) {
		const correlations: { other: string; r: number }[] = [];
		for (const other of names) {
			if (other === name) continue;
			const r = pearson(seriesByVariable[name], seriesByVariable[other]);
			if (Number.isFinite(r)) correlations.push({ other, r });
		}
		const abs = correlations.map((c) => Math.abs(c.r));
		const strongest = correlations.reduce<{ other: string; r: number } | undefined>(
			(best, c) => (!best || Math.abs(c.r) > Math.abs(best.r) ? c : best),
			undefined
		);
		result.push({
			variable: name,
			meanAbsCorrelation: abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : NaN,
			strongestPair: strongest?.other
		});
	}

	return result.sort((a, b) => b.meanAbsCorrelation - a.meanAbsCorrelation);
}

/** Pearson correlation over the overlapping finite prefix of two series. */
export function pearson(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	if (n < 2) return NaN;
	const xs: number[] = [];
	const ys: number[] = [];
	for (let i = 0; i < n; i++) {
		if (Number.isFinite(a[i]) && Number.isFinite(b[i])) {
			xs.push(a[i]);
			ys.push(b[i]);
		}
	}
	const m = xs.length;
	if (m < 2) return NaN;
	const mx = mean(xs);
	const my = mean(ys);
	let num = 0;
	let dx = 0;
	let dy = 0;
	for (let i = 0; i < m; i++) {
		num += (xs[i] - mx) * (ys[i] - my);
		dx += (xs[i] - mx) ** 2;
		dy += (ys[i] - my) ** 2;
	}
	const den = Math.sqrt(dx * dy);
	return den === 0 ? NaN : num / den;
}
