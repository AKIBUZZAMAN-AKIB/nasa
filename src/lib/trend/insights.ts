/**
 * Extra views on one analysis: which calendar months are changing, a year by
 * month anomaly grid, whether the gap between two regions is changing, and an
 * explainable machine-learning check of which related variables help predict
 * the year-to-year ups and downs. Pure functions only.
 */
import { benjaminiHochberg, hamedRaoMannKendall, linearFit, mean, sensSlope } from './stats';

import type { Monthly, SeasonalSeries } from './analyze';

export const MONTH_NAMES = [
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
] as const;

/** Fewest years a calendar month needs before its own trend is tested. */
export const MIN_MONTH_YEARS = 10;

export interface MonthTrend {
	/** 1-12. */
	month: number;
	n: number;
	perDecade: number;
	perDecadeLow: number;
	perDecadeHigh: number;
	/** Hamed-Rao modified Mann-Kendall p-value. */
	p: number;
	/** Benjamini-Hochberg adjusted p-value across the tested months. */
	q: number;
	/** Significant after the false discovery rate correction (q < 0.05). */
	significant: boolean;
	meanValue: number;
}

/**
 * Trend of each calendar month on its own over fromYear..toYear: Sen's slope
 * and the autocorrelation-corrected Mann-Kendall test, with Benjamini-Hochberg
 * across the twelve tests so that one month in twelve is not 'significant'
 * by chance alone. Months with fewer than MIN_MONTH_YEARS values are left out.
 */
export function monthlyTrends(monthly: Monthly, fromYear: number, toYear: number): MonthTrend[] {
	const raw: Omit<MonthTrend, 'q' | 'significant'>[] = [];
	for (let month = 1; month <= 12; month++) {
		const years: number[] = [];
		const values: number[] = [];
		for (let y = fromYear; y <= toYear; y++) {
			const v = monthly.get(y * 100 + month);
			if (v !== undefined && Number.isFinite(v)) {
				years.push(y);
				values.push(v);
			}
		}
		if (values.length < MIN_MONTH_YEARS) continue;
		const sen = sensSlope(values, years);
		const hr = hamedRaoMannKendall(values);
		raw.push({
			month,
			n: values.length,
			perDecade: sen.slope * 10,
			perDecadeLow: sen.low * 10,
			perDecadeHigh: sen.high * 10,
			p: hr.p,
			meanValue: mean(values)
		});
	}
	const q = benjaminiHochberg(raw.map((r) => r.p));
	return raw.map((r, i) => ({
		...r,
		q: q[i],
		significant: q[i] < 0.05 && r.perDecade !== 0
	}));
}

export interface AnomalyGrid {
	years: number[];
	/** values[yearIndex][month - 1]: difference from that month's average, or null. */
	values: (number | null)[][];
	/** Average of each calendar month over the same years (the baseline). */
	baseline: (number | null)[];
	/** Colour scale limit: the 95th percentile of the absolute anomalies. */
	limit: number;
	/** Share of the year-month cells that have a value. */
	coverage: number;
}

/** Year x month anomalies against each month's own average over the same years. */
export function anomalyGrid(monthly: Monthly, fromYear: number, toYear: number): AnomalyGrid {
	const years: number[] = [];
	for (let y = fromYear; y <= toYear; y++) years.push(y);
	const baseline: (number | null)[] = [];
	for (let m = 1; m <= 12; m++) {
		const vals = years
			.map((y) => monthly.get(y * 100 + m))
			.filter((v): v is number => v !== undefined && Number.isFinite(v));
		baseline.push(vals.length ? mean(vals) : null);
	}
	const abs: number[] = [];
	let present = 0;
	const values = years.map((y) =>
		baseline.map((b, i) => {
			const v = monthly.get(y * 100 + i + 1);
			if (v === undefined || !Number.isFinite(v) || b === null) return null;
			present++;
			abs.push(Math.abs(v - b));
			return v - b;
		})
	);
	abs.sort((a, b) => a - b);
	const limit = abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] : 0;
	return {
		years,
		values,
		baseline,
		limit: limit > 0 ? limit : 1,
		coverage: years.length ? present / (years.length * 12) : 0
	};
}

export interface RegionGap {
	years: number[];
	/** First region minus second region, per year. */
	difference: number[];
	meanDifference: number;
	perDecade: number;
	perDecadeLow: number;
	perDecadeHigh: number;
	p: number;
	significant: boolean;
}

/**
 * Is the gap between two places changing? Tests the trend of the yearly
 * difference (A minus B) over the years both have, with Sen's slope and the
 * autocorrelation-corrected Mann-Kendall test. Null with fewer than 8 years.
 */
export function regionGap(a: SeasonalSeries, b: SeasonalSeries): RegionGap | null {
	const byYear = new Map<number, number>();
	a.years.forEach((y, i) => {
		const v = a.values[i];
		if (v !== null) byYear.set(y, v);
	});
	const years: number[] = [];
	const difference: number[] = [];
	b.years.forEach((y, i) => {
		const vb = b.values[i];
		const va = byYear.get(y);
		if (vb !== null && va !== undefined) {
			years.push(y);
			difference.push(va - vb);
		}
	});
	if (years.length < 8) return null;
	const sen = sensSlope(difference, years);
	const hr = hamedRaoMannKendall(difference);
	return {
		years,
		difference,
		meanDifference: mean(difference),
		perDecade: sen.slope * 10,
		perDecadeLow: sen.low * 10,
		perDecadeHigh: sen.high * 10,
		p: hr.p,
		significant: hr.p < 0.05 && sen.slope !== 0
	};
}

// ---------------------------------------------------------------------------
// Explainable machine learning: which related variables help predict the
// year-to-year ups and downs?
// ---------------------------------------------------------------------------

export interface YearSeries {
	id: string;
	years: number[];
	values: (number | null)[];
}

export interface DriverScore {
	id: string;
	/** Ridge coefficient on standardised, detrended data, fitted on all years. */
	coefficient: number;
	/** Drop in cross-validated R² when this variable is left out (0 when it does not help). */
	importance: number;
	/** Importance as a share of the summed importances, 0-1. */
	share: number;
}

export interface DriverModel {
	years: number[];
	n: number;
	/** Leave-one-year-out R² against a trend-only forecast: skill beyond the trend. */
	r2: number;
	skill: 'useful' | 'weak' | 'none';
	lambda: number;
	drivers: DriverScore[];
	/** Leave-one-year-out predictions and actual values of the detrended target. */
	predicted: number[];
	actual: number[];
}

/** Fewest shared years before a model is fitted at all. */
export const MIN_MODEL_YEARS = 12;

/** Ridge penalty on standardised predictors; fixed, so there is no tuning to overfit. */
export const RIDGE_LAMBDA = 1;

/** Solve A x = b for a small symmetric positive definite A (Gaussian elimination). */
export function solve(a: number[][], b: number[]): number[] {
	const n = b.length;
	const m = a.map((row, i) => [...row, b[i]]);
	for (let c = 0; c < n; c++) {
		let pivot = c;
		for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
		[m[c], m[pivot]] = [m[pivot], m[c]];
		const d = m[c][c];
		if (Math.abs(d) < 1e-12) throw new Error('singular system');
		for (let r = 0; r < n; r++) {
			if (r === c) continue;
			const f = m[r][c] / d;
			for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
		}
	}
	return m.map((row, i) => row[n] / row[i]);
}

/** Ridge regression without intercept on already centred columns. */
export function ridge(x: number[][], y: number[], lambda: number): number[] {
	const p = x[0]?.length ?? 0;
	const xtx = Array.from({ length: p }, () => new Array<number>(p).fill(0));
	const xty = new Array<number>(p).fill(0);
	for (let i = 0; i < y.length; i++) {
		for (let j = 0; j < p; j++) {
			xty[j] += x[i][j] * y[i];
			for (let k = 0; k < p; k++) xtx[j][k] += x[i][j] * x[i][k];
		}
	}
	for (let j = 0; j < p; j++) xtx[j][j] += lambda;
	return solve(xtx, xty);
}

interface Prepared {
	/** Residuals from a straight line fitted on the training years. */
	residual: (i: number) => number;
}

/** Fit a straight line on the training rows and return detrend + scale helpers. */
function prepare(years: number[], values: number[], train: number[]): Prepared & { sd: number } {
	const fit = linearFit(
		train.map((i) => years[i]),
		train.map((i) => values[i])
	);
	const res = (i: number) => values[i] - (fit.intercept + fit.slope * years[i]);
	const r = train.map(res);
	const m = mean(r);
	const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, r.length - 1)) || 1;
	return { residual: (i) => (res(i) - m) / sd, sd };
}

/** Leave-one-year-out predictions for the given predictor columns (ids). */
function looPredict(
	years: number[],
	target: number[],
	columns: number[][],
	lambda: number
): { predicted: number[]; actual: number[] } {
	const n = years.length;
	const predicted: number[] = [];
	const actual: number[] = [];
	for (let out = 0; out < n; out++) {
		const train = years.map((_, i) => i).filter((i) => i !== out);
		const ty = prepare(years, target, train);
		const tx = columns.map((col) => prepare(years, col, train));
		const x = train.map((i) => tx.map((p) => p.residual(i)));
		const y = train.map((i) => ty.residual(i));
		actual.push(ty.residual(out));
		if (!columns.length) {
			predicted.push(0);
			continue;
		}
		const beta = ridge(x, y, lambda);
		predicted.push(tx.reduce((s, p, j) => s + beta[j] * p.residual(out), 0));
	}
	return { predicted, actual };
}

function r2Of(predicted: number[], actual: number[]): number {
	const sse = predicted.reduce((s, p, i) => s + (actual[i] - p) ** 2, 0);
	const sst = actual.reduce((s, a) => s + a * a, 0);
	return sst > 0 ? 1 - sse / sst : 0;
}

/**
 * Which related variables help predict the target's year-to-year changes?
 *
 * Every series is detrended (a straight line fitted on the training years
 * only) and standardised, so a shared long-term trend cannot make two
 * variables look related. A ridge regression is scored by leave-one-year-out
 * cross-validation against a trend-only forecast, so R² is the skill on
 * years the model never saw. A variable's importance is how much that skill
 * drops when it is left out. Association only: it does not show causes.
 */
export function explainDrivers(
	target: YearSeries,
	predictors: YearSeries[],
	lambda = RIDGE_LAMBDA
): DriverModel | null {
	const maps = [target, ...predictors].map((s) => {
		const m = new Map<number, number>();
		s.years.forEach((y, i) => {
			const v = s.values[i];
			if (v !== null && Number.isFinite(v)) m.set(y, v);
		});
		return m;
	});
	const years = [...maps[0].keys()]
		.filter((y) => maps.every((m) => m.has(y)))
		.sort((a, b) => a - b);
	if (years.length < MIN_MODEL_YEARS || !predictors.length) return null;
	const y = years.map((yr) => maps[0].get(yr)!);
	const cols = predictors.map((_, j) => years.map((yr) => maps[j + 1].get(yr)!));
	// A predictor that is a straight line (or constant) has nothing left after
	// detrending: it carries no year-to-year information, so it is left out.
	const usable = cols.map((c) => {
		const fit = linearFit(years, c);
		const scale = Math.max(...c.map(Math.abs)) || 1;
		return Math.sqrt(fit.sse / c.length) > 1e-9 * scale;
	});
	const full = looPredict(
		years,
		y,
		cols.filter((_, j) => usable[j]),
		lambda
	);
	const r2 = r2Of(full.predicted, full.actual);
	const importance = predictors.map((_, j) => {
		if (!usable[j]) return 0;
		const rest = cols.filter((_, k) => k !== j && usable[k]);
		const without = looPredict(years, y, rest, lambda);
		return Math.max(0, r2 - r2Of(without.predicted, without.actual));
	});
	// Coefficients for the direction of each association, fitted on all years.
	const all = years.map((_, i) => i);
	const ty = prepare(years, y, all);
	const tx = cols.map((c) => prepare(years, c, all));
	const usedIdx = predictors.map((_, j) => j).filter((j) => usable[j]);
	const beta = usedIdx.length
		? ridge(
				all.map((i) => usedIdx.map((j) => tx[j].residual(i))),
				all.map((i) => ty.residual(i)),
				lambda
			)
		: [];
	const total = importance.reduce((s, v) => s + v, 0);
	const drivers = predictors
		.map((p, j) => ({
			id: p.id,
			coefficient: usable[j] ? beta[usedIdx.indexOf(j)] : 0,
			importance: importance[j],
			share: total > 0 ? importance[j] / total : 0
		}))
		.sort((a, b) => b.importance - a.importance);
	return {
		years,
		n: years.length,
		r2,
		skill: r2 >= 0.3 ? 'useful' : r2 >= 0.1 ? 'weak' : 'none',
		lambda,
		drivers,
		predicted: full.predicted,
		actual: full.actual
	};
}
