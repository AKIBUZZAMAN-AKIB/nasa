import { describe, expect, it } from 'vitest';

import {
	autocorrelation,
	benjaminiHochberg,
	detrend,
	effectiveSampleSize,
	hamedRaoMannKendall,
	mannKendall,
	median,
	normalQuantile,
	normalTwoSidedP,
	pearson,
	pettitt,
	rank,
	segmentedTrend,
	sensSlope,
	spearman,
	studentTwoSidedP,
	tfpwMannKendall
} from '$lib/trend/stats';

// Expected values come from pymannkendall 1.4.3 and SciPy 1.18.1
// (scripts/trend-reference.py writes this file).
import reference from './fixtures/trend-reference.json';

type Case = (typeof reference.cases)[number];

const close = (actual: number, expected: number, digits = 6) =>
	expect(actual).toBeCloseTo(expected, digits);

describe('distributions', () => {
	it('matches SciPy normal and t tails', () => {
		close(studentTwoSidedP(2.1, 12), reference.t[0], 6);
		close(normalTwoSidedP(1.7), reference.t[1], 6);
		close(normalQuantile(0.975), reference.t[2], 6);
		close(normalQuantile(0.001), reference.t[3], 6);
	});
});

describe('Mann-Kendall family against pymannkendall', () => {
	reference.cases.forEach((c: Case, i: number) => {
		it(`case ${i}: original test`, () => {
			const r = mannKendall(c.values);
			expect(r.s).toBe(c.mk.s);
			close(r.varS, c.mk.var, 6);
			close(r.z, c.mk.z, 6);
			close(r.p, c.mk.p, 6);
			close(r.tau, c.mk.tau, 6);
		});
		it(`case ${i}: Hamed-Rao modified test`, () => {
			const r = hamedRaoMannKendall(c.values);
			close(r.varS, c.hr.var, 4);
			close(r.z, c.hr.z, 5);
			close(r.p, c.hr.p, 6);
		});
		it(`case ${i}: trend-free pre-whitening test`, () => {
			const r = tfpwMannKendall(c.values);
			expect(r.s).toBe(c.tfpw.s);
			close(r.varS, c.tfpw.var, 6);
			close(r.z, c.tfpw.z, 6);
			close(r.p, c.tfpw.p, 6);
		});
		it(`case ${i}: Sen's slope and its 95% interval match scipy.stats.theilslopes`, () => {
			const r = sensSlope(c.values);
			close(r.slope, c.sen.slope, 9);
			close(r.intercept, c.sen.intercept, 9);
			close(r.low, c.sen.low, 9);
			close(r.high, c.sen.high, 9);
		});
	});

	it('finds no trend in a constant series', () => {
		const r = mannKendall([5, 5, 5, 5, 5, 5]);
		expect(r.s).toBe(0);
		expect(r.p).toBe(1);
		expect(sensSlope([5, 5, 5, 5]).slope).toBe(0);
	});

	it('reports a perfectly increasing series as significant', () => {
		const values = Array.from({ length: 20 }, (_, i) => i * 2);
		const r = mannKendall(values);
		expect(r.tau).toBe(1);
		expect(r.p).toBeLessThan(1e-6);
		expect(sensSlope(values).slope).toBe(2);
	});

	it('inflates the variance for a positively autocorrelated series', () => {
		// A slow oscillation: strongly autocorrelated, no real trend.
		const values = Array.from({ length: 40 }, (_, i) => Math.sin(i / 4) + i * 0.01);
		const original = mannKendall(values);
		const modified = hamedRaoMannKendall(values);
		expect(modified.correction).toBeGreaterThan(1);
		expect(modified.p).toBeGreaterThan(original.p);
	});

	it('honours explicit x values in Sen slope', () => {
		const r = sensSlope([1, 3, 5], [2000, 2001, 2002]);
		expect(r.slope).toBe(2);
		expect(r.intercept).toBe(3 - 2 * 2001);
	});
});

describe('helpers', () => {
	it('ranks ties with their average rank', () => {
		expect(rank([10, 20, 10, 30])).toEqual([1.5, 3, 1.5, 4]);
	});
	it('takes the true median', () => {
		expect(median([4, 1, 3, 2])).toBe(2.5);
		expect(median([3, 1, 2])).toBe(2);
	});
	it('computes the biased autocorrelation', () => {
		const acf = autocorrelation([1, 2, 3, 4], 1);
		expect(acf[0]).toBe(1);
		close(acf[1], 0.25, 9);
	});
	it('removes the Sen trend', () => {
		const residuals = detrend([1, 2, 3, 4, 5]);
		residuals.forEach((r) => close(r, 0, 9));
	});
});

describe('change points', () => {
	it('locates a level shift with Pettitt', () => {
		const values = [
			...Array(15)
				.fill(0)
				.map((_, i) => 10 + (i % 3) * 0.1),
			...Array(15)
				.fill(0)
				.map((_, i) => 12 + (i % 3) * 0.1)
		];
		const r = pettitt(values)!;
		expect(r.index).toBe(14);
		expect(r.p).toBeLessThan(0.01);
		close(r.meanAfter - r.meanBefore, 2, 6);
	});

	it('returns null for very short series', () => {
		expect(pettitt([1, 2, 3])).toBeNull();
		expect(segmentedTrend([1, 2, 3, 4])).toBeNull();
	});

	it('finds the break between a flat and a rising segment', () => {
		const x = Array.from({ length: 40 }, (_, i) => 1981 + i);
		const y = x.map(
			(year, i) => (year <= 2004 ? 20 : 20 + (year - 2004) * 0.3) + ((i * 7) % 5) * 0.02
		);
		const r = segmentedTrend(y, x)!;
		expect(x[r.index]).toBeGreaterThanOrEqual(2003);
		expect(x[r.index]).toBeLessThanOrEqual(2005);
		expect(r.preferred).toBe(true);
		expect(r.after.slope).toBeGreaterThan(0.25);
		expect(Math.abs(r.before.slope)).toBeLessThan(0.02);
	});

	it('prefers a single line when the trend is steady', () => {
		const y = Array.from({ length: 40 }, (_, i) => i * 0.1 + ((i * 7) % 5) * 0.05);
		expect(segmentedTrend(y)!.preferred).toBe(false);
	});
});

describe('multiple testing and association', () => {
	it('matches scipy.stats.false_discovery_control', () => {
		const q = benjaminiHochberg(reference.bh.p);
		q.forEach((v, i) => close(v, reference.bh.q[i], 9));
	});

	it('matches SciPy Pearson and Spearman', () => {
		const p = pearson(reference.corr.a, reference.corr.b);
		close(p.r, reference.pearson[0], 9);
		close(p.p, reference.pearson[1], 6);
		const s = spearman(reference.corr.a, reference.corr.b);
		close(s.r, reference.spearman[0], 9);
		close(s.p, reference.spearman[1], 6);
	});

	it('shrinks the effective sample size for two persistent series', () => {
		const a = Array.from({ length: 30 }, (_, i) => Math.sin(i / 3));
		const b = Array.from({ length: 30 }, (_, i) => Math.cos(i / 3));
		expect(effectiveSampleSize(a, b)).toBeLessThan(15);
		const weaker = pearson(a, b, effectiveSampleSize(a, b));
		expect(weaker.p).toBeGreaterThan(pearson(a, b).p);
	});
});
