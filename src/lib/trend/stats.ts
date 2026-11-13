/**
 * Statistics for the Earth System Trend Explorer.
 *
 * Every function takes plain arrays and is free of I/O so it can be unit
 * tested against reference implementations (pyMannKendall, SciPy). Missing
 * values must be removed by the caller; the time axis is the array index
 * unless an explicit `x` is given.
 *
 * References:
 * - Mann (1945), Kendall (1975): Mann-Kendall trend test.
 * - Sen (1968): slope estimator and its confidence interval.
 * - Hamed & Rao (1998): variance correction for autocorrelated series.
 * - Yue, Pilon, Phinney & Cavadias (2002): trend-free pre-whitening (TFPW).
 * - Pettitt (1979): non-parametric change-point test.
 * - Benjamini & Hochberg (1995): false discovery rate control.
 * - Bretherton et al. (1999): effective sample size for correlated series.
 */

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

/** Complementary error function for x >= 0 (Numerical Recipes erfc, rel. err < 1.2e-7). */
function erfcPositive(x: number): number {
	const t = 1 / (1 + 0.5 * x);
	const y =
		t *
		Math.exp(
			-x * x -
				1.26551223 +
				t *
					(1.00002368 +
						t *
							(0.37409196 +
								t *
									(0.09678418 +
										t *
											(-0.18628806 +
												t *
													(0.27886807 +
														t *
															(-1.13520398 +
																t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
		);
	return y;
}

/** Standard normal cumulative distribution function. */
export function normalCdf(z: number): number {
	if (z < -8) return 0;
	if (z > 8) return 1;
	return z >= 0 ? 1 - 0.5 * erfcPositive(z / Math.SQRT2) : 0.5 * erfcPositive(-z / Math.SQRT2);
}

/** Two-sided p-value of a standard normal statistic. */
export function normalTwoSidedP(z: number): number {
	if (!Number.isFinite(z)) return Number.NaN;
	return Math.min(1, erfcPositive(Math.abs(z) / Math.SQRT2));
}

/** Inverse standard normal CDF (Acklam's algorithm, rel. err ~1e-9). */
export function normalQuantile(p: number): number {
	if (p <= 0) return -Infinity;
	if (p >= 1) return Infinity;
	const a = [
		-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
		-3.066479806614716e1, 2.506628277459239
	];
	const b = [
		-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
		-1.328068155288572e1
	];
	const c = [
		-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
		4.374664141464968, 2.938163982698783
	];
	const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
	const lo = 0.02425;
	if (p < lo) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (
			(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
			((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
		);
	}
	if (p > 1 - lo) return -normalQuantile(1 - p);
	const q = p - 0.5;
	const r = q * q;
	return (
		((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
		(((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
	);
}

function logGamma(x: number): number {
	const g = [
		76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
		0.1208650973866179e-2, -0.5395239384953e-5
	];
	let y = x;
	const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
	let ser = 1.000000000190015;
	for (const c of g) ser += c / ++y;
	return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued fraction for the regularised incomplete beta function. */
function betacf(a: number, b: number, x: number): number {
	const maxIt = 300;
	const eps = 3e-14;
	const fpmin = 1e-300;
	const qab = a + b;
	const qap = a + 1;
	const qam = a - 1;
	let c = 1;
	let d = 1 - (qab * x) / qap;
	if (Math.abs(d) < fpmin) d = fpmin;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= maxIt; m++) {
		const m2 = 2 * m;
		let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < fpmin) d = fpmin;
		c = 1 + aa / c;
		if (Math.abs(c) < fpmin) c = fpmin;
		d = 1 / d;
		h *= d * c;
		aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
		d = 1 + aa * d;
		if (Math.abs(d) < fpmin) d = fpmin;
		c = 1 + aa / c;
		if (Math.abs(c) < fpmin) c = fpmin;
		d = 1 / d;
		const del = d * c;
		h *= del;
		if (Math.abs(del - 1) < eps) break;
	}
	return h;
}

function incompleteBeta(a: number, b: number, x: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const bt = Math.exp(
		logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
	);
	if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
	return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a Student t statistic with `df` degrees of freedom. */
export function studentTwoSidedP(t: number, df: number): number {
	if (!Number.isFinite(t) || !(df > 0)) return Number.NaN;
	return Math.min(1, incompleteBeta(df / 2, 0.5, df / (df + t * t)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function mean(values: readonly number[]): number {
	if (!values.length) return Number.NaN;
	let s = 0;
	for (const v of values) s += v;
	return s / values.length;
}

/** True median (mean of the two middle values for even n), as numpy.median. */
export function median(values: readonly number[]): number {
	if (!values.length) return Number.NaN;
	const s = [...values].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function standardDeviation(values: readonly number[]): number {
	if (values.length < 2) return Number.NaN;
	const m = mean(values);
	let s = 0;
	for (const v of values) s += (v - m) ** 2;
	return Math.sqrt(s / (values.length - 1));
}

/** Average ranks (1-based) with ties sharing their mean rank, as scipy.stats.rankdata. */
export function rank(values: readonly number[]): number[] {
	const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
	const ranks = new Array<number>(values.length);
	let i = 0;
	while (i < order.length) {
		let j = i;
		while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
		const r = (i + j) / 2 + 1;
		for (let k = i; k <= j; k++) ranks[order[k][1]] = r;
		i = j + 1;
	}
	return ranks;
}

/** Sizes of the groups of tied values (only groups larger than one). */
function tieGroups(values: readonly number[]): number[] {
	const counts = new Map<number, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	return [...counts.values()].filter((c) => c > 1);
}

/** Sample autocorrelation function (biased estimator, as statsmodels/pyMannKendall). */
export function autocorrelation(values: readonly number[], maxLag: number): number[] {
	const n = values.length;
	const m = mean(values);
	const y = values.map((v) => v - m);
	let c0 = 0;
	for (const v of y) c0 += v * v;
	const out: number[] = [];
	for (let lag = 0; lag <= Math.min(maxLag, n - 1); lag++) {
		let c = 0;
		for (let i = 0; i + lag < n; i++) c += y[i] * y[i + lag];
		out.push(c0 === 0 ? 0 : c / c0);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Mann-Kendall family
// ---------------------------------------------------------------------------

export interface MannKendallResult {
	n: number;
	/** Mann-Kendall S statistic. */
	s: number;
	/** Variance of S (tie-corrected, and autocorrelation-corrected for the modified tests). */
	varS: number;
	z: number;
	p: number;
	/** Kendall's tau = S / (n(n-1)/2). */
	tau: number;
	/** For the Hamed-Rao test: the variance inflation factor n/n*. 1 for the original test. */
	correction: number;
}

function mkScore(values: readonly number[]): number {
	let s = 0;
	for (let i = 0; i < values.length - 1; i++) {
		for (let j = i + 1; j < values.length; j++) s += Math.sign(values[j] - values[i]);
	}
	return s;
}

function mkVariance(values: readonly number[]): number {
	const n = values.length;
	let v = n * (n - 1) * (2 * n + 5);
	for (const t of tieGroups(values)) v -= t * (t - 1) * (2 * t + 5);
	return v / 18;
}

function mkZ(s: number, varS: number): number {
	if (!(varS > 0)) return 0;
	if (s > 0) return (s - 1) / Math.sqrt(varS);
	if (s < 0) return (s + 1) / Math.sqrt(varS);
	return 0;
}

function mkResult(s: number, varS: number, n: number, correction = 1): MannKendallResult {
	const z = mkZ(s, varS);
	return {
		n,
		s,
		varS,
		z,
		p: varS > 0 ? normalTwoSidedP(z) : 1,
		tau: n > 1 ? s / ((n * (n - 1)) / 2) : 0,
		correction
	};
}

/** Original Mann-Kendall test (assumes independent observations). */
export function mannKendall(values: readonly number[]): MannKendallResult {
	return mkResult(mkScore(values), mkVariance(values), values.length);
}

/**
 * Hamed & Rao (1998) modified Mann-Kendall test. The variance of S is
 * inflated by n/n* computed from the significant autocorrelations of the
 * ranks of the Sen-detrended series. Matches
 * pymannkendall.hamed_rao_modification_test with alpha = 0.05.
 */
export function hamedRaoMannKendall(values: readonly number[], alpha = 0.05): MannKendallResult {
	const n = values.length;
	const s = mkScore(values);
	let varS = mkVariance(values);
	if (n < 4) return mkResult(s, varS, n);
	const { slope } = sensSlope(values);
	const detrended = values.map((v, i) => v - (i + 1) * slope);
	const acf = autocorrelation(rank(detrended), n - 1);
	const bound = normalQuantile(1 - alpha / 2) / Math.sqrt(n);
	let sum = 0;
	for (let i = 1; i < n; i++) {
		if (acf[i] > bound || acf[i] < -bound) sum += (n - i) * (n - i - 1) * (n - i - 2) * acf[i];
	}
	const correction = 1 + (2 / (n * (n - 1) * (n - 2))) * sum;
	varS *= correction;
	return mkResult(s, varS, n, correction);
}

/**
 * Trend-free pre-whitening Mann-Kendall test (Yue et al. 2002). Removes the
 * Sen trend, removes the lag-1 autocorrelation, adds the trend back and runs
 * the original test on the n-1 values. Matches
 * pymannkendall.trend_free_pre_whitening_modification_test.
 */
export function tfpwMannKendall(values: readonly number[]): MannKendallResult & { lag1: number } {
	const n = values.length;
	if (n < 4) return { ...mannKendall(values), lag1: 0 };
	const { slope } = sensSlope(values);
	const detrended = values.map((v, i) => v - (i + 1) * slope);
	const lag1 = autocorrelation(detrended, 1)[1] ?? 0;
	const whitened: number[] = [];
	for (let i = 1; i < n; i++) whitened.push(detrended[i] - detrended[i - 1] * lag1 + i * slope);
	return { ...mannKendall(whitened), lag1 };
}

// ---------------------------------------------------------------------------
// Sen's slope
// ---------------------------------------------------------------------------

export interface SensSlopeResult {
	/** Median of the pairwise slopes, per unit of x. */
	slope: number;
	/** Intercept: median(y) - slope * median(x) (the pyMannKendall / SciPy 'separate' convention). */
	intercept: number;
	/** Lower and upper bounds of the confidence interval of the slope (Sen 1968). */
	low: number;
	high: number;
}

/**
 * Sen's slope estimator with the Sen (1968) confidence interval. Matches
 * scipy.stats.theilslopes(y, x, alpha) with method='separate'.
 */
export function sensSlope(
	values: readonly number[],
	x?: readonly number[],
	confidence = 0.95
): SensSlopeResult {
	const n = values.length;
	const xs = x ?? values.map((_, i) => i + 1);
	const slopes: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		for (let j = i + 1; j < n; j++) {
			const dx = xs[j] - xs[i];
			if (dx > 0) slopes.push((values[j] - values[i]) / dx);
			else if (dx < 0) slopes.push((values[i] - values[j]) / -dx);
		}
	}
	if (!slopes.length) {
		return { slope: Number.NaN, intercept: Number.NaN, low: Number.NaN, high: Number.NaN };
	}
	slopes.sort((a, b) => a - b);
	const slope = median(slopes);
	const intercept = median(values) - slope * median(xs);

	const z = normalQuantile((1 - confidence) / 2); // negative
	let sigsq = n * (n - 1) * (2 * n + 5);
	for (const t of tieGroups(xs)) sigsq -= t * (t - 1) * (2 * t + 5);
	for (const t of tieGroups(values)) sigsq -= t * (t - 1) * (2 * t + 5);
	const sigma = Math.sqrt(sigsq / 18);
	const nt = slopes.length;
	const upper = Math.min(roundHalfEven((nt - z * sigma) / 2), nt - 1);
	const lower = Math.max(roundHalfEven((nt + z * sigma) / 2) - 1, 0);
	return { slope, intercept, low: slopes[lower], high: slopes[upper] };
}

/** numpy.round: halves go to the nearest even integer. */
function roundHalfEven(x: number): number {
	const r = Math.round(x);
	return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// ---------------------------------------------------------------------------
// Change points
// ---------------------------------------------------------------------------

export interface PettittResult {
	/** Index of the last value before the change (0-based). */
	index: number;
	/** Pettitt's K = max |U_t|. */
	k: number;
	/** Approximate two-sided p-value, 2 exp(-6K^2 / (n^3 + n^2)), capped at 1. */
	p: number;
	meanBefore: number;
	meanAfter: number;
}

/** Pettitt (1979) test for a single shift in the median. */
export function pettitt(values: readonly number[]): PettittResult | null {
	const n = values.length;
	if (n < 6) return null;
	// U_t = sum_{i<=t} sum_{j>t} sgn(x_i - x_j), updated incrementally.
	let u = 0;
	let best = -1;
	let bestIndex = 0;
	for (let t = 0; t < n - 1; t++) {
		for (let j = 0; j < n; j++) {
			if (j !== t) u += Math.sign(values[t] - values[j]);
		}
		if (Math.abs(u) > best) {
			best = Math.abs(u);
			bestIndex = t;
		}
	}
	const p = Math.min(1, 2 * Math.exp((-6 * best * best) / (n ** 3 + n ** 2)));
	return {
		index: bestIndex,
		k: best,
		p,
		meanBefore: mean(values.slice(0, bestIndex + 1)),
		meanAfter: mean(values.slice(bestIndex + 1))
	};
}

export interface LinearFit {
	slope: number;
	intercept: number;
	sse: number;
}

export function linearFit(x: readonly number[], y: readonly number[]): LinearFit {
	const n = x.length;
	const mx = mean(x);
	const my = mean(y);
	let sxx = 0;
	let sxy = 0;
	for (let i = 0; i < n; i++) {
		sxx += (x[i] - mx) ** 2;
		sxy += (x[i] - mx) * (y[i] - my);
	}
	const slope = sxx > 0 ? sxy / sxx : 0;
	const intercept = my - slope * mx;
	let sse = 0;
	for (let i = 0; i < n; i++) sse += (y[i] - intercept - slope * x[i]) ** 2;
	return { slope, intercept, sse };
}

export interface SegmentedTrendResult {
	/** Index of the last value of the first segment (0-based). */
	index: number;
	before: LinearFit;
	after: LinearFit;
	single: LinearFit;
	/** BIC(single line) - BIC(two segments). Positive favours the break. */
	deltaBic: number;
	/** True when the two-segment model is clearly better (deltaBic > 6, 'strong' on Kass & Raftery's scale). */
	preferred: boolean;
}

/**
 * Search for the single break that best splits the series into two separate
 * linear trends (each segment keeps at least `minSegment` points), then
 * compare it with one straight line by BIC. This catches changes in the
 * rate of change, which the Mann-Kendall test (monotonic) and Pettitt
 * (shift in level) both miss.
 */
export function segmentedTrend(
	values: readonly number[],
	x?: readonly number[],
	minSegment = 6
): SegmentedTrendResult | null {
	const n = values.length;
	if (n < minSegment * 2) return null;
	const xs = x ?? values.map((_, i) => i);
	const single = linearFit(xs, values);
	let best: { index: number; before: LinearFit; after: LinearFit } | null = null;
	for (let k = minSegment - 1; k <= n - minSegment - 1; k++) {
		const before = linearFit(xs.slice(0, k + 1), values.slice(0, k + 1));
		const after = linearFit(xs.slice(k + 1), values.slice(k + 1));
		if (!best || before.sse + after.sse < best.before.sse + best.after.sse) {
			best = { index: k, before, after };
		}
	}
	if (!best) return null;
	const floor = 1e-12;
	// Parameters: line = 2 + variance; two segments = 4 + break + variance.
	const bicSingle = n * Math.log(Math.max(single.sse, floor) / n) + 3 * Math.log(n);
	const bicSplit =
		n * Math.log(Math.max(best.before.sse + best.after.sse, floor) / n) + 6 * Math.log(n);
	const deltaBic = bicSingle - bicSplit;
	return { ...best, single, deltaBic, preferred: deltaBic > 6 };
}

// ---------------------------------------------------------------------------
// Multiple testing and association
// ---------------------------------------------------------------------------

/** Benjamini-Hochberg adjusted p-values (q-values), in the input order. */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
	const m = pValues.length;
	const order = pValues.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
	const q = new Array<number>(m);
	let running = 1;
	for (let k = m - 1; k >= 0; k--) {
		const [p, i] = order[k];
		running = Math.min(running, (p * m) / (k + 1));
		q[i] = Math.min(1, running);
	}
	return q;
}

export interface CorrelationResult {
	n: number;
	r: number;
	p: number;
}

/** Pearson correlation with a t-test p-value; `nEffective` overrides n in the test. */
export function pearson(
	a: readonly number[],
	b: readonly number[],
	nEffective?: number
): CorrelationResult {
	const n = a.length;
	if (n < 3) return { n, r: Number.NaN, p: Number.NaN };
	const ma = mean(a);
	const mb = mean(b);
	let sab = 0;
	let saa = 0;
	let sbb = 0;
	for (let i = 0; i < n; i++) {
		sab += (a[i] - ma) * (b[i] - mb);
		saa += (a[i] - ma) ** 2;
		sbb += (b[i] - mb) ** 2;
	}
	if (saa === 0 || sbb === 0) return { n, r: Number.NaN, p: Number.NaN };
	const r = Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb)));
	const ne = Math.max(3, nEffective ?? n);
	const df = ne - 2;
	const p = Math.abs(r) >= 1 ? 0 : studentTwoSidedP(r * Math.sqrt(df / (1 - r * r)), df);
	return { n, r, p };
}

/** Spearman rank correlation (Pearson on average ranks), t-approximation p-value. */
export function spearman(a: readonly number[], b: readonly number[]): CorrelationResult {
	return pearson(rank(a), rank(b));
}

/**
 * Bretherton et al. (1999) effective sample size for the correlation of two
 * autocorrelated series: n (1 - r1a r1b) / (1 + r1a r1b), bounded to [3, n].
 */
export function effectiveSampleSize(a: readonly number[], b: readonly number[]): number {
	const n = a.length;
	const ra = autocorrelation(a, 1)[1] ?? 0;
	const rb = autocorrelation(b, 1)[1] ?? 0;
	const product = ra * rb;
	if (product <= 0) return n;
	return Math.max(3, Math.min(n, (n * (1 - product)) / (1 + product)));
}

/** Residuals after removing each series' Sen trend. */
export function detrend(values: readonly number[], x?: readonly number[]): number[] {
	const xs = x ?? values.map((_, i) => i + 1);
	const { slope, intercept } = sensSlope(values, xs);
	return values.map((v, i) => v - (intercept + slope * xs[i]));
}
