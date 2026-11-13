import { describe, expect, it } from 'vitest';

import {
	MIN_MONTH_YEARS,
	anomalyGrid,
	explainDrivers,
	monthlyTrends,
	regionGap,
	ridge,
	solve
} from '$lib/trend/insights';

// Expected values come from pymannkendall, SciPy and NumPy
// (scripts/insights-reference.py writes this file).
import reference from './fixtures/insights-reference.json';

/** Park-Miller generator, the same as scripts/insights-reference.py. */
function* lcg(seed: number) {
	let s = seed;
	while (true) {
		s = (s * 16807) % 2147483647;
		yield s / 2147483647;
	}
}

function syntheticMonthly() {
	const g = lcg(42);
	const m = new Map<number, number>();
	for (let y = 1990; y < 2020; y++) {
		for (let mo = 1; mo <= 12; mo++) {
			const trend = [6, 7, 8].includes(mo) ? 0.05 * (y - 1990) : 0;
			m.set(
				y * 100 + mo,
				20 + 5 * Math.sin((mo / 12) * 2 * Math.PI) + trend + (g.next().value! - 0.5) * 2
			);
		}
	}
	return m;
}

describe('monthlyTrends', () => {
	const trends = monthlyTrends(syntheticMonthly(), 1990, 2019);

	it('matches Sen slope, Hamed-Rao p and Benjamini-Hochberg q for every month', () => {
		expect(trends).toHaveLength(12);
		for (const ref of reference.months) {
			const t = trends.find((x) => x.month === ref.month)!;
			expect(t.perDecade).toBeCloseTo(ref.slope10, 9);
			expect(t.perDecadeLow).toBeCloseTo(ref.low10, 9);
			expect(t.perDecadeHigh).toBeCloseTo(ref.high10, 9);
			expect(t.p).toBeCloseTo(ref.p, 6);
			expect(t.q).toBeCloseTo(ref.q, 6);
		}
	});

	it('flags the summer months that really trend', () => {
		const flagged = trends.filter((t) => t.significant).map((t) => t.month);
		expect(flagged).toEqual(expect.arrayContaining([6, 7, 8]));
		expect(flagged.length).toBeLessThanOrEqual(4);
	});

	it('skips months with too few years', () => {
		const m = new Map<number, number>();
		for (let y = 2000; y < 2000 + MIN_MONTH_YEARS - 1; y++) m.set(y * 100 + 1, y);
		for (let y = 2000; y < 2000 + MIN_MONTH_YEARS; y++) m.set(y * 100 + 2, y);
		const r = monthlyTrends(m, 2000, 2030);
		expect(r.map((t) => t.month)).toEqual([2]);
		expect(r[0].perDecade).toBeCloseTo(10, 9);
	});
});

describe('anomalyGrid', () => {
	it('subtracts each month average and reports coverage', () => {
		const m = new Map<number, number>([
			[200001, 1],
			[200101, 3],
			[200002, 10]
		]);
		const g = anomalyGrid(m, 2000, 2001);
		expect(g.years).toEqual([2000, 2001]);
		expect(g.baseline[0]).toBe(2);
		expect(g.baseline[1]).toBe(10);
		expect(g.baseline[2]).toBeNull();
		expect(g.values[0][0]).toBe(-1);
		expect(g.values[1][0]).toBe(1);
		expect(g.values[0][1]).toBe(0);
		expect(g.values[1][1]).toBeNull();
		expect(g.coverage).toBeCloseTo(3 / 24, 12);
		expect(g.limit).toBe(1);
	});
});

describe('regionGap', () => {
	it('tests the trend of the yearly difference over shared years', () => {
		const years = Array.from({ length: 20 }, (_, i) => 2000 + i);
		const a = { years, values: years.map((y) => y * 0.1 + 5), monthsPresent: 0, monthsExpected: 0 };
		const b = {
			years,
			values: years.map((_, i) => (i === 3 ? null : 5)),
			monthsPresent: 0,
			monthsExpected: 0
		};
		const g = regionGap(a, b)!;
		expect(g.years).toHaveLength(19);
		expect(g.perDecade).toBeCloseTo(1, 9);
		expect(g.significant).toBe(true);
	});

	it('needs at least 8 shared years', () => {
		const s = { years: [1, 2, 3], values: [1, 2, 3], monthsPresent: 0, monthsExpected: 0 };
		expect(regionGap(s, s)).toBeNull();
	});
});

describe('ridge and explainDrivers', () => {
	it('solves a linear system', () => {
		const x = solve(
			[
				[4, 1],
				[1, 3]
			],
			[1, 2]
		);
		expect(x[0]).toBeCloseTo(1 / 11, 12);
		expect(x[1]).toBeCloseTo(7 / 11, 12);
	});

	it('shrinks towards zero with the penalty', () => {
		const x = [[1], [2], [3]];
		const y = [2, 4, 6];
		expect(ridge(x, y, 0)[0]).toBeCloseTo(2, 12);
		expect(ridge(x, y, 14)[0]).toBeCloseTo(1, 12);
	});

	const d = reference.ridge_data;
	const series = (id: string, values: number[]) => ({ id, years: d.years, values });
	const model = explainDrivers(series('y', d.y), [
		series('x1', d.x1),
		series('x2', d.x2),
		series('x3', d.x3)
	])!;

	it('matches the NumPy leave-one-year-out ridge model', () => {
		expect(model.n).toBe(25);
		expect(model.r2).toBeCloseTo(reference.ridge.r2, 9);
		const byId = Object.fromEntries(model.drivers.map((x) => [x.id, x]));
		['x1', 'x2', 'x3'].forEach((id, j) => {
			expect(byId[id].importance).toBeCloseTo(reference.ridge.importance[j], 9);
			expect(byId[id].coefficient).toBeCloseTo(reference.ridge.beta[j], 9);
		});
	});

	it('ranks the real drivers first and gives noise almost no credit', () => {
		expect(model.drivers.map((x) => x.id)).toEqual(['x1', 'x2', 'x3']);
		expect(model.skill).toBe('useful');
		expect(model.drivers[2].share).toBeLessThan(0.01);
		expect(model.drivers[0].coefficient).toBeGreaterThan(0);
		expect(model.drivers[1].coefficient).toBeLessThan(0);
	});

	it('does not credit a variable that only shares the trend', () => {
		const years = Array.from({ length: 25 }, (_, i) => 2000 + i);
		const g = lcg(3);
		const noise = years.map(() => g.next().value!);
		const target = years.map((y, i) => y * 0.5 + noise[i]);
		const trendOnly = years.map((y) => y * 2);
		const m = explainDrivers({ id: 't', years, values: target }, [
			{ id: 'trend', years, values: trendOnly }
		])!;
		expect(m.skill).toBe('none');
		expect(m.drivers[0].importance).toBe(0);
	});

	it('returns null with too few shared years', () => {
		const years = [2000, 2001, 2002];
		expect(
			explainDrivers({ id: 't', years, values: [1, 2, 3] }, [{ id: 'a', years, values: [3, 1, 2] }])
		).toBeNull();
	});
});
