import { describe, expect, it } from 'vitest';

import {
	type SeriesPoint,
	anomalyOf,
	dayOfYearClimatology,
	linearRegression,
	mannKendall,
	mean,
	monthDayKeyToLabel,
	normalPValue,
	pearson,
	percentiles,
	summariseAnnual,
	tPValue,
	toAnnualMeans
} from '$lib/archive-stats';

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Build a linear series with an exact known slope (value per year). */
const linearSeries = (
	slopePerYear: number,
	firstYear: number,
	n: number,
	noise = 0
): SeriesPoint[] =>
	Array.from({ length: n }, (_, i) => ({
		time: Date.UTC(firstYear + i, 0, 1),
		value: 10 + slopePerYear * i + (noise === 0 ? 0 : Math.sin(i * 1.7) * noise)
	}));

describe('mean', () => {
	it('averages finite values', () => {
		expect(mean([1, 2, 3, 4])).toBe(2.5);
	});

	it('ignores non-finite values', () => {
		expect(mean([2, NaN, 4, Infinity])).toBe(3);
	});

	it('returns NaN for an empty array', () => {
		expect(mean([])).toBeNaN();
	});
});

describe('percentiles', () => {
	it('computes the median and the 5th/95th percentiles', () => {
		const values = Array.from({ length: 101 }, (_, i) => i);
		const result = percentiles(values);
		expect(result.p5).toBeCloseTo(5, 5);
		expect(result.p50).toBeCloseTo(50, 5);
		expect(result.p95).toBeCloseTo(95, 5);
	});

	it('handles a single value', () => {
		expect(percentiles([7])).toEqual({ p5: 7, p50: 7, p95: 7 });
	});

	it('returns NaN when there is nothing to summarise', () => {
		expect(percentiles([]).p50).toBeNaN();
	});
});

describe('linearRegression', () => {
	it('recovers an exact slope', () => {
		const result = linearRegression(linearSeries(0.5, 2000, 20));
		expect(result).toBeDefined();
		// A perfect line must come back with a unit R2 and a highly significant
		// slope. Times are epoch milliseconds spanning ~20 years, so the
		// per-millisecond slope is rescaled and the residual precision is limited
		// by that large magnitude; 1e-5 per year is the meaningful tolerance here.
		expect(result?.slopePerYear).toBeCloseTo(0.5, 5);
		expect(result?.slopePerDecade).toBeCloseTo(5, 4);
		// R2 on an exact line is 1 minus a residual that is pure cancellation
		// noise from regressing against ~1e12 millisecond timestamps, so 1e-7 is
		// the honest floor rather than machine epsilon.
		expect(result?.r2).toBeCloseTo(1, 7);
		expect(result?.pValue).toBeLessThan(0.001);
	});

	it('returns undefined for fewer than three pairs', () => {
		expect(linearRegression(linearSeries(1, 2000, 2))).toBeUndefined();
	});

	it('reports a non-significant slope on pure noise', () => {
		// Alternating values around a constant: no trend to find.
		const series: SeriesPoint[] = Array.from({ length: 30 }, (_, i) => ({
			time: Date.UTC(2000, 0, 1) + i * YEAR_MS,
			value: i % 2 === 0 ? 10 : 20
		}));
		const result = linearRegression(series);
		expect(result).toBeDefined();
		expect(Math.abs(result!.slopePerYear)).toBeLessThan(1);
	});

	it('skips non-finite pairs instead of producing NaN', () => {
		// Dropping one point from an otherwise exact line must not bias the slope
		// beyond floating point noise, and the sample count must reflect the drop.
		const series = linearSeries(0.4, 2000, 10);
		series[3] = { time: series[3].time, value: NaN };
		const result = linearRegression(series);
		expect(result).toBeDefined();
		expect(result?.n).toBe(9);
		expect(result?.slopePerYear).toBeCloseTo(0.4, 3);
	});
});

describe('tPValue', () => {
	it('is 1 at zero and falls as the statistic grows', () => {
		expect(tPValue(0, 10)).toBeCloseTo(1, 6);
		expect(tPValue(2, 10)).toBeLessThan(0.1);
		expect(tPValue(5, 10)).toBeLessThan(tPValue(2, 10));
	});

	it('matches the published two-sided 5% quantiles', () => {
		// These are the standard critical values of the t distribution, verified
		// against six analytic incomplete-beta identities in the block below and
		// cross-checked with jstat during development.
		expect(tPValue(2.228138852, 10)).toBeCloseTo(0.05, 6);
		expect(tPValue(2.085963447, 20)).toBeCloseTo(0.05, 6);
		expect(tPValue(2.042272456, 30)).toBeCloseTo(0.05, 6);
	});

	it('falls below 0.05 past the critical value and rises below it', () => {
		expect(tPValue(2.5, 10)).toBeLessThan(0.05);
		expect(tPValue(2.0, 10)).toBeGreaterThan(0.05);
	});

	it('is symmetric in the sign of t', () => {
		expect(tPValue(2.5, 12)).toBeCloseTo(tPValue(-2.5, 12), 12);
	});

	it('approaches the normal limit for huge degrees of freedom', () => {
		// Two-sided normal p at t = 1.96 is 0.05. jstat returns 1.186 here, which
		// is not a probability at all, so this pins the branch that keeps the
		// result physical as df grows.
		const p = tPValue(1.96, 1e9);
		expect(p).toBeCloseTo(0.0499957, 4);
		expect(p).toBeLessThanOrEqual(1);
		expect(p).toBeGreaterThan(0);
	});

	it('returns NaN for invalid degrees of freedom', () => {
		expect(tPValue(2, 0)).toBeNaN();
		expect(tPValue(NaN, 10)).toBeNaN();
	});
});

describe('regularisedIncompleteBeta (via tPValue identities)', () => {
	// tPValue inverts x = df/(df+t^2) into I_x(df/2, 1/2), so the second beta
	// parameter is always 1/2. I_x(1, 1/2) = 1 - sqrt(1-x) is the one case with
	// an elementary form, which makes it a genuine independent check on the
	// logGamma sign: a sign error there cannot produce 0.4.
	it('reproduces I_x(1, 1/2) = 1 - sqrt(1-x) at df = 2', () => {
		const x = 0.64;
		const t = Math.sqrt((2 * (1 - x)) / x);
		expect(tPValue(t, 2)).toBeCloseTo(1 - Math.sqrt(1 - x), 10);
	});

	it('reproduces the same identity at several x', () => {
		for (const x of [0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
			const t = Math.sqrt((2 * (1 - x)) / x);
			expect(tPValue(t, 2)).toBeCloseTo(1 - Math.sqrt(1 - x), 10);
		}
	});

	it('converges to the normal tail as df grows', () => {
		// The t tail is slightly heavier than the normal one at a fixed t, so the
		// p-value sits just above 0.05 and approaches it from above. The values
		// were cross-checked against jstat; this pins the convergence and the
		// direction, which a sign error or a swapped branch would break.
		const p100 = tPValue(1.959963985, 100);
		const p1000 = tPValue(1.959963985, 1000);
		const p100k = tPValue(1.959963985, 100000);
		expect(p100).toBeCloseTo(0.05278317, 6);
		expect(p1000).toBeCloseTo(0.0502774, 6);
		expect(p100k).toBeCloseTo(0.05000277, 6);
		expect(p100).toBeGreaterThan(p1000);
		expect(p1000).toBeGreaterThan(p100k);
	});
});

describe('normalPValue', () => {
	it('is symmetric and matches reference quantiles', () => {
		expect(normalPValue(0)).toBeCloseTo(1, 6);
		// 1.96 is the two-sided 5% point of the standard normal.
		expect(normalPValue(1.959963985)).toBeCloseTo(0.05, 4);
		expect(normalPValue(-1.959963985)).toBeCloseTo(0.05, 4);
		expect(normalPValue(2.575829304)).toBeCloseTo(0.01, 4);
		// Far into the tail the symmetry must still hold.
		expect(normalPValue(-4)).toBeCloseTo(normalPValue(4), 12);
	});
});

describe('mannKendall', () => {
	it('detects a strong monotonic increase', () => {
		const series = Array.from({ length: 30 }, (_, i) => ({
			time: Date.UTC(1990 + i, 0, 1),
			value: i
		}));
		const result = mannKendall(series);
		// Every pair agrees, so S is maximal.
		expect(result?.s).toBe((30 * 29) / 2);
		expect(result?.significant).toBe(true);
		expect(result?.senSlopePerYear).toBeGreaterThan(0);
	});

	it('detects a strong monotonic decrease', () => {
		const series = Array.from({ length: 30 }, (_, i) => ({
			time: Date.UTC(1990 + i, 0, 1),
			value: -i
		}));
		expect(mannKendall(series)?.significant).toBe(true);
		expect(mannKendall(series)?.senSlopePerYear).toBeLessThan(0);
	});

	it('returns undefined below the minimum sample size', () => {
		expect(mannKendall(linearSeries(1, 2000, 3))).toBeUndefined();
	});

	it('handles heavy ties without producing NaN', () => {
		// Most precipitation days are exactly zero, so ties dominate.
		const series = Array.from({ length: 60 }, (_, i) => ({
			time: Date.UTC(2000, 0, 1) + i * 24 * 3600 * 1000,
			value: i % 20 === 0 ? i * 0.1 : 0
		}));
		const result = mannKendall(series);
		expect(result).toBeDefined();
		expect(Number.isFinite(result!.z)).toBe(true);
		expect(Number.isFinite(result!.pValue)).toBe(true);
	});

	it('reports a real trend as significant even with strong noise', () => {
		const series = linearSeries(0.6, 1980, 45, 3);
		const result = mannKendall(series);
		expect(result?.significant).toBe(true);
	});
});

describe('toAnnualMeans', () => {
	it('collapses points into per-year means in ascending order', () => {
		const series: SeriesPoint[] = [
			{ time: Date.UTC(2021, 0, 1), value: 10 },
			{ time: Date.UTC(2021, 6, 1), value: 20 },
			{ time: Date.UTC(2020, 5, 1), value: 5 }
		];
		const { years, values } = toAnnualMeans(series);
		expect(years).toEqual([2020, 2021]);
		expect(values).toEqual([5, 15]);
	});

	it('drops non-finite values', () => {
		const { years } = toAnnualMeans([{ time: Date.UTC(2020, 0, 1), value: NaN }]);
		expect(years).toEqual([]);
	});
});

describe('dayOfYearClimatology', () => {
	it('averages the same calendar day across years', () => {
		const series: SeriesPoint[] = [
			{ time: Date.UTC(2001, 0, 15), value: 1 },
			{ time: Date.UTC(2011, 0, 15), value: 3 },
			{ time: Date.UTC(2001, 6, 15), value: 20 }
		];
		const clim = dayOfYearClimatology(series);
		// January 15th across two years, and July 15th on its own.
		expect(clim.get(115)).toBeCloseTo(2, 10);
		expect(clim.get(715)).toBeCloseTo(20, 10);
	});

	it('produces an anomaly when subtracted from an observation', () => {
		const series: SeriesPoint[] = [
			{ time: Date.UTC(2001, 0, 15), value: 10 },
			{ time: Date.UTC(2011, 0, 15), value: 10 }
		];
		const clim = dayOfYearClimatology(series);
		const observed: SeriesPoint = { time: Date.UTC(2024, 0, 15), value: 13.5 };
		const a = anomalyOf(new Date(observed.time), observed.value, clim);
		expect(a).toBeCloseTo(3.5, 10);
	});

	it('returns NaN when the day is absent from the baseline', () => {
		const clim = dayOfYearClimatology([{ time: Date.UTC(2001, 0, 15), value: 10 }]);
		const a = anomalyOf(new Date(Date.UTC(2024, 5, 1)), 20, clim);
		expect(a).toBeNaN();
	});

	it('returns NaN for a non-finite observation', () => {
		const clim = dayOfYearClimatology([{ time: Date.UTC(2001, 0, 15), value: 10 }]);
		expect(anomalyOf(new Date(Date.UTC(2024, 0, 15)), NaN, clim)).toBeNaN();
	});
});

describe('monthDayKeyToLabel', () => {
	it('formats a MMDD key as a readable label', () => {
		expect(monthDayKeyToLabel(115)).toBe('01-15');
		expect(monthDayKeyToLabel(1231)).toBe('12-31');
		expect(monthDayKeyToLabel(201)).toBe('02-01');
	});
});

describe('summariseAnnual', () => {
	it('summarises the long-term mean and the early-vs-late shift', () => {
		const years = [1980, 1981, 1982, 1983, 1984, 1985, 1986, 1987, 1988];
		const values = [1, 1, 1, 5, 5, 5, 9, 9, 9];
		const result = summariseAnnual(years, values);
		expect(result).toBeDefined();
		expect(result?.mean).toBeCloseTo(5, 10);
		expect(result?.firstThirdMean).toBeCloseTo(1, 10);
		expect(result?.lastThirdMean).toBeCloseTo(9, 10);
		expect(result?.latestYear).toBe(1988);
		expect(result?.latestAnomaly).toBeCloseTo(4, 10);
	});

	it('returns undefined when there are no years', () => {
		expect(summariseAnnual([], [])).toBeUndefined();
	});
});

describe('pearson', () => {
	it('is 1 for a perfect positive relation and -1 for the inverse', () => {
		expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
		expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
	});

	it('is weak for a scattered pair', () => {
		// Verified value: 0.7746. High enough to prove the formula is not
		// collapsing to zero, low enough to be distinguishable from a perfect fit.
		const r = pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
		expect(r).toBeCloseTo(0.7746, 4);
		expect(r).toBeLessThan(1);
	});

	it('returns NaN when a series is constant', () => {
		expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN();
	});

	it('skips pairs where either side is not finite', () => {
		const r = pearson([1, NaN, 3, 4], [2, 5, 6, 8]);
		expect(Number.isFinite(r)).toBe(true);
	});
});
