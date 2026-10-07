import { describe, expect, it } from 'vitest';

import {
	type TimePoint,
	aggregateAnnual,
	aggregateMonthly,
	aggregateUnits,
	angularDifference,
	annualAnomalies,
	annualTrend,
	compareSources,
	distributionSplit,
	exceedanceCounts,
	extent,
	lag1Autocorrelation,
	lttb,
	monthlyClimatology,
	movingAverage,
	pettitt,
	quantileSorted,
	senTrend,
	sliceYears,
	tCritical
} from '$lib/analysis/analysis-stats';

const DAY = 86_400_000;

function daily(startYear: number, endYear: number, f: (t: Date, i: number) => number): TimePoint[] {
	const out: TimePoint[] = [];
	let i = 0;
	for (let t = Date.UTC(startYear, 0, 1); t < Date.UTC(endYear + 1, 0, 1); t += DAY) {
		out.push({ time: t, value: f(new Date(t), i++) });
	}
	return out;
}

/** Deterministic pseudo-random noise in [-0.5, 0.5). */
function noise(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296;
		return s / 4294967296 - 0.5;
	};
}

describe('extent and quantiles', () => {
	it('handles 400k samples without stack overflow', () => {
		const big = new Float64Array(400_000).map((_, i) => Math.sin(i));
		const [lo, hi] = extent(big);
		expect(lo).toBeGreaterThanOrEqual(-1);
		expect(hi).toBeLessThanOrEqual(1);
	});
	it('interpolates quantiles like type 7', () => {
		expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
		expect(quantileSorted([1, 2, 3, 4], 0)).toBe(1);
		expect(quantileSorted([1, 2, 3, 4], 1)).toBe(4);
	});
});

describe('monthly and annual aggregation', () => {
	it('means daily temperatures and sums daily precipitation', () => {
		const pts = daily(2001, 2001, (d) => (d.getUTCMonth() === 0 ? 10 : 20));
		const mean = aggregateMonthly(pts, 'daily', 'mean');
		expect(mean).toHaveLength(12);
		expect(mean[0].value).toBe(10);
		const rate = aggregateMonthly(
			daily(2001, 2001, () => 2),
			'daily',
			'rate'
		);
		expect(rate[0].value).toBe(62); // 31 days × 2 mm
		expect(rate[1].value).toBe(56); // 28 days × 2 mm
		const annual = aggregateAnnual(rate, 'rate');
		expect(annual[0].value).toBe(730);
		expect(annual[0].complete).toBe(true);
	});

	it('scales sums for a few missing days but flags months below 80 % coverage', () => {
		const pts = daily(2001, 2001, () => 1).filter((_, i) => i >= 3); // drop 3 Jan days
		const months = aggregateMonthly(pts, 'daily', 'rate');
		expect(months[0].value).toBeCloseTo(31, 6);
		expect(months[0].complete).toBe(true);
		const sparse = daily(2001, 2001, () => 1).filter(
			(p) => !(new Date(p.time).getUTCMonth() === 5 && new Date(p.time).getUTCDate() > 10)
		);
		const annual = aggregateAnnual(aggregateMonthly(sparse, 'daily', 'rate'), 'rate');
		expect(annual[0].complete).toBe(false);
	});

	it('multiplies monthly POWER rates by days and keeps counts as totals', () => {
		const jul = [{ time: Date.UTC(2020, 6, 15), value: 14.58 }];
		// POWER PRECTOTCORR_SUM for the same month is 451.89 mm (rounding of the daily mean).
		expect(aggregateMonthly(jul, 'monthly', 'rate')[0].value).toBeCloseTo(451.98, 2);
		expect(aggregateMonthly(jul, 'monthly', 'count')[0].value).toBe(14.58);
	});

	it('vector-averages wind direction', () => {
		const pts = daily(2001, 2001, (_, i) => (i % 2 === 0 ? 350 : 10));
		const months = aggregateMonthly(pts, 'daily', 'circular');
		expect(Math.min(months[0].value, 360 - months[0].value)).toBeLessThan(1);
		expect(angularDifference(350, 10)).toBe(-20);
		expect(angularDifference(10, 350)).toBe(20);
	});

	it('reports aggregate units', () => {
		expect(aggregateUnits('mm/day', 'rate')).toEqual({
			sample: 'mm/day',
			monthly: 'mm/month',
			annual: 'mm/yr'
		});
		expect(aggregateUnits('C', 'mean').annual).toBe('°C');
		expect(aggregateUnits('degree-day-c', 'count').annual).toBe('°C·day/yr');
	});

	it('slices by year with binary search', () => {
		const pts = daily(2000, 2003, () => 1);
		const s = sliceYears(pts, 2001, 2002);
		expect(new Date(s[0].time).getUTCFullYear()).toBe(2001);
		expect(new Date(s[s.length - 1].time).getUTCFullYear()).toBe(2002);
		expect(s).toHaveLength(365 + 365);
	});
});

describe('trend tests', () => {
	it('recovers an exact linear slope', () => {
		const years = Array.from({ length: 30 }, (_, i) => 1991 + i);
		const values = years.map((y) => 0.03 * y - 40);
		const t = annualTrend(years, values)!;
		expect(t.slopePerDecade).toBeCloseTo(0.3, 10);
		expect(t.intercept + t.slopePerYear * 2000).toBeCloseTo(0.03 * 2000 - 40, 8);
		const s = senTrend(years, values)!;
		expect(s.senSlopePerDecade).toBeCloseTo(0.3, 10);
		expect(s.intercept + s.senSlopePerYear * 2000).toBeCloseTo(20, 8);
	});

	it('shrinks the effective sample size for autocorrelated residuals', () => {
		const rnd = noise(7);
		const years = Array.from({ length: 45 }, (_, i) => 1981 + i);
		let ar = 0;
		const values = years.map((y) => {
			ar = 0.8 * ar + rnd();
			return 0.01 * (y - 1981) + ar;
		});
		const t = annualTrend(years, values)!;
		expect(t.r1).toBeGreaterThan(0.3);
		expect(t.nEff).toBeLessThan(t.n);
		expect(t.pValueAdjusted).toBeGreaterThan(t.pValue);
		expect(lag1Autocorrelation([1, 2, 3, 4, 5, 6])).toBeGreaterThan(0);
	});

	it('computes Student-t critical values', () => {
		expect(tCritical(10)).toBeCloseTo(2.228, 2);
		expect(tCritical(1000)).toBeCloseTo(1.962, 2);
	});
});

describe('Pettitt change point', () => {
	it('locates a step change', () => {
		const rnd = noise(3);
		const values = Array.from({ length: 40 }, (_, i) => (i < 18 ? 0 : 1.5) + rnd() * 0.6);
		const r = pettitt(values)!;
		expect(r.index).toBe(17);
		expect(r.pValue).toBeLessThan(0.01);
		expect(r.shift).toBeGreaterThan(1);
	});
	it('reports no significant change for noise', () => {
		const rnd = noise(11);
		const values = Array.from({ length: 40 }, () => rnd());
		expect(pettitt(values)!.pValue).toBeGreaterThan(0.05);
	});
	it('handles ties through average ranks', () => {
		const r = pettitt([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])!;
		expect(r.k).toBe(0);
		expect(r.pValue).toBe(1);
	});
});

describe('climatology, anomalies and extremes', () => {
	const seasonal = (d: Date) => 25 + 5 * Math.sin(((d.getUTCMonth() + 0.5) / 12) * 2 * Math.PI);

	it('builds monthly percentiles and anomalies against a baseline outside the period', () => {
		const pts = daily(1991, 2025, (d) => seasonal(d) + 0.02 * (d.getUTCFullYear() - 1991));
		const months = aggregateMonthly(pts, 'daily', 'mean');
		const clim = monthlyClimatology(months, 1991, 2020, 'mean');
		expect(clim[0].n).toBe(30);
		expect(clim[0].p10).toBeLessThanOrEqual(clim[0].p50);
		const annual = aggregateAnnual(months, 'mean');
		const an = annualAnomalies(annual, 1991, 2020, 'mean', 2021, 2025)!;
		expect(an.usesBaseline).toBe(true);
		expect(an.years).toEqual([2021, 2022, 2023, 2024, 2025]);
		expect(an.anomalies.every((a) => a > 0)).toBe(true);
	});

	it('counts more warm days after warming (ETCCDI-style)', () => {
		const rnd = noise(5);
		const pts = daily(
			1981,
			2025,
			(d) => seasonal(d) + rnd() * 2 + (d.getUTCFullYear() >= 2010 ? 1 : 0)
		);
		const years = new Set(Array.from({ length: 45 }, (_, i) => 1981 + i));
		const ex = exceedanceCounts(pts, 'daily', 'mean', 1981, 2000, years)!;
		const early = ex.high.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
		const late = ex.high.slice(-10).reduce((a, b) => a + b, 0) / 10;
		expect(early).toBeGreaterThan(20);
		expect(early).toBeLessThan(55);
		expect(late).toBeGreaterThan(early * 2);
	});

	it('uses wet days only for precipitation distributions', () => {
		const pts = daily(1981, 2010, (_, i) => (i % 3 === 0 ? 10 : 0));
		const years = Array.from({ length: 30 }, (_, i) => 1981 + i);
		const d = distributionSplit(pts, years, 'rate')!;
		expect(d.earlyStats.p50).toBe(10);
		expect(d.note).toMatch(/Wet/);
	});
});

describe('two-source comparison', () => {
	it('finds a step in the difference series', () => {
		const rnd = noise(9);
		const a = daily(1981, 2020, () => 25 + rnd());
		const b = a.map((p) => ({
			time: p.time,
			value: p.value + (new Date(p.time).getUTCFullYear() < 1998 ? 1 : 0)
		}));
		const ma = aggregateMonthly(a, 'daily', 'mean');
		const mb = aggregateMonthly(b, 'daily', 'mean');
		const c = compareSources(mb, ma, 'mean', 1981, 2020, b, a)!;
		expect(c.years).toHaveLength(40);
		expect(c.dailyN).toBe(a.length);
		expect(c.dailyRmse).toBeGreaterThan(0.5);
		const cp = c.differencePettitt!;
		expect(c.years[cp.index + 1]).toBe(1998);
		expect(cp.pValue).toBeLessThan(0.001);
	});
});

describe('display helpers', () => {
	it('LTTB keeps endpoints, size and a spike', () => {
		const pts = Array.from({ length: 10_000 }, (_, i) => ({
			time: i,
			value: i === 5000 ? 100 : Math.sin(i / 50)
		}));
		const out = lttb(pts, 500);
		expect(out).toHaveLength(500);
		expect(out[0]).toBe(pts[0]);
		expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
		expect(out.some((p) => p.value === 100)).toBe(true);
	});
	it('moving average of a constant is constant', () => {
		const out = movingAverage(
			Array.from({ length: 100 }, (_, i) => ({ time: i, value: 3 })),
			31
		);
		expect(out.every((p) => p.value === 3)).toBe(true);
		expect(out).toHaveLength(70);
	});
});
