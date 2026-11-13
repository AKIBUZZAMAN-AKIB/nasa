import { describe, expect, it } from 'vitest';

import {
	type Monthly,
	climatology,
	differenceBreak,
	lastCompleteYear,
	seasonalSeries
} from '$lib/trend/analyze';
import { analyzeTrend, assessReliability } from '$lib/trend/analyze';
import { SEASONS, VARIABLES, seasonById, variableById } from '$lib/trend/catalog';
import { REGIONS, regionById } from '$lib/trend/regions';
import { regionsFor } from '$lib/trend/run';
import {
	DEFAULT_SELECTION,
	FARMER_STORY,
	QUICK_STARTS,
	parseSelection,
	selectionQuery
} from '$lib/trend/state';
import { buildStory, lowerName } from '$lib/trend/story';

function monthlyFrom(
	fn: (year: number, month: number) => number | undefined,
	from: number,
	to: number
): Monthly {
	const m: Monthly = new Map();
	for (let y = from; y <= to; y++)
		for (let mo = 1; mo <= 12; mo++) {
			const v = fn(y, mo);
			if (v !== undefined) m.set(y * 100 + mo, v);
		}
	return m;
}

describe('seasonalSeries', () => {
	const annual = seasonById('annual');

	it('averages complete years', () => {
		const m = monthlyFrom((_, mo) => mo, 2000, 2001);
		const s = seasonalSeries(m, annual, 'mean', 2000, 2001);
		expect(s.values).toEqual([6.5, 6.5]);
		expect(s.monthsPresent).toBe(24);
	});

	it('bridges a missing month with climatology instead of biasing the mean', () => {
		// Strong seasonal cycle; 2002 misses its warmest month.
		const m = monthlyFrom(
			(y, mo) => (y === 2002 && mo === 7 ? undefined : mo === 7 ? 30 : 10),
			2000,
			2002
		);
		const s = seasonalSeries(m, annual, 'mean', 2000, 2002);
		const full = (30 + 11 * 10) / 12;
		expect(s.values[0]).toBeCloseTo(full, 10);
		expect(s.values[2]).toBeCloseTo(full, 10);
		// A plain mean of the 11 present months would have said 10.
		expect(s.values[2]).not.toBeCloseTo(10, 3);
	});

	it('needs every month for a total, and three quarters for a mean', () => {
		const m = monthlyFrom((y, mo) => (y === 2001 && mo <= 4 ? undefined : 1), 2000, 2001);
		expect(seasonalSeries(m, annual, 'sum', 2000, 2001).values).toEqual([12, null]);
		// 8 of 12 months is below three quarters.
		expect(seasonalSeries(m, annual, 'mean', 2000, 2001).values[1]).toBeNull();
		// ...but enough with a lower threshold (used for cloudy ocean colour).
		expect(seasonalSeries(m, annual, 'mean', 2000, 2001, 0.5).values[1]).toBe(1);
	});

	it('takes December from the previous year for winter', () => {
		const winter = SEASONS.find((s) => s.decemberNextYear)!;
		const m = monthlyFrom((y, mo) => (mo === 12 ? y : 0), 2000, 2002);
		const s = seasonalSeries(m, winter, 'sum', 2001, 2002);
		expect(s.values).toEqual([2000, 2001]);
	});
});

describe('lastCompleteYear', () => {
	it('skips a season still in progress at the end of the record', () => {
		const m = monthlyFrom((y, mo) => (y === 2025 && mo > 10 ? undefined : 1), 2020, 2025);
		expect(lastCompleteYear(m, seasonById('annual'), 'mean', 0.75)).toBe(2024);
		expect(lastCompleteYear(m, seasonById('annual'), 'sum', 1)).toBe(2024);
	});

	it('accepts a finished year with a gap when a mean allows it', () => {
		const m = monthlyFrom((y, mo) => (y === 2025 && mo === 3 ? undefined : 1), 2020, 2025);
		expect(lastCompleteYear(m, seasonById('annual'), 'mean', 0.75)).toBe(2025);
		expect(lastCompleteYear(m, seasonById('annual'), 'sum', 1)).toBe(2024);
	});
});

describe('climatology', () => {
	it('averages each calendar month', () => {
		const m = monthlyFrom((y, mo) => y - 2000 + mo, 2000, 2002);
		const c = climatology(m);
		expect(c.get(1)).toBe(2);
		expect(c.get(12)).toBe(13);
	});
});

describe('differenceBreak (homogeneity check)', () => {
	const years = Array.from({ length: 40 }, (_, i) => 1981 + i);
	// Deterministic "weather" noise shared by both datasets.
	const weather = years.map((_, i) => Math.sin(i * 1.7) + 0.5 * Math.cos(i * 0.9));

	it('finds no break when two datasets agree', () => {
		const a = weather.map((w, i) => 25 + 0.02 * i + w);
		const b = weather.map((w, i) => 24 + 0.02 * i + w * 0.9 + 0.05 * Math.sin(i * 3.1));
		expect(differenceBreak(a, b, years)).toBeNull();
	});

	it('flags a jump that only one dataset has', () => {
		const a = weather.map((w, i) => 25 + w + (years[i] >= 1998 ? 2.5 : 0));
		const b = weather.map((w) => 24 + w);
		const brk = differenceBreak(a, b, years);
		expect(brk).not.toBeNull();
		expect(brk!.year).toBe(1998);
		expect(brk!.p).toBeLessThan(0.01);
	});

	it('does not flag a real change that both datasets share', () => {
		// Each dataset also has its own measurement noise, as real ones do.
		const noiseA = years.map((_, i) => 0.3 * Math.sin(i * 2.3 + 1));
		const noiseB = years.map((_, i) => 0.3 * Math.cos(i * 1.3 + 2));
		const a = weather.map((w, i) => 25 + w + noiseA[i] + (years[i] >= 2005 ? 1.5 : 0));
		const b = weather.map((w, i) => 24 + w + noiseB[i] + (years[i] >= 2005 ? 1.5 : 0));
		expect(differenceBreak(a, b, years)).toBeNull();
	});
});

describe('selection in the URL', () => {
	it('round-trips a full selection', () => {
		const sel = {
			variableId: 'rain_imerg',
			regionId: 'rajshahi',
			seasonId: 'monsoon',
			from: 2001,
			to: 2024,
			mode: 'research' as const
		};
		expect(parseSelection(new URLSearchParams(selectionQuery(sel)))).toEqual(sel);
	});

	it('falls back to the defaults for unknown values', () => {
		const sel = parseSelection(new URLSearchParams('v=nope&r=atlantis&s=x&from=abc&mode=hack'));
		expect(sel).toEqual(DEFAULT_SELECTION);
	});

	it('accepts a tapped point and orders the years', () => {
		const sel = parseSelection(new URLSearchParams('r=point:24.40,88.60&from=2020&to=2001'));
		expect(sel.regionId).toBe('point:24.40,88.60');
		expect([sel.from, sel.to]).toEqual([2001, 2020]);
	});
});

describe('catalogue consistency', () => {
	it('every preset points to a real variable, region and season that fit together', () => {
		for (const p of [...QUICK_STARTS, ...FARMER_STORY]) {
			const v = variableById(p.selection.variableId);
			expect(v, p.id).toBeDefined();
			expect(regionById(p.selection.regionId), p.id).toBeDefined();
			expect(
				SEASONS.some((s) => s.id === p.selection.seasonId),
				p.id
			).toBe(true);
			expect(
				regionsFor(v!).some((r) => r.id === p.selection.regionId),
				`${p.id}: ${p.selection.regionId} not offered for ${v!.id}`
			).toBe(true);
		}
	});

	it('every variable has a region and full source details', () => {
		for (const v of VARIABLES) {
			expect(regionsFor(v).length, v.id).toBeGreaterThan(0);
			expect(v.dataset.url, v.id).toMatch(/^https:\/\//);
			expect(v.dataset.provider.length, v.id).toBeGreaterThan(3);
			expect(v.dataset.resolution.length, v.id).toBeGreaterThan(3);
		}
	});

	it('region ids are unique', () => {
		const ids = REGIONS.map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('headline names', () => {
	it('keeps acronyms and place names capitalised inside a sentence', () => {
		expect(lowerName('Arctic sea-ice extent')).toBe('Arctic sea-ice extent');
		expect(lowerName('Surface temperature anomaly (NASA GISTEMP, since 1951)')).toBe(
			'surface temperature anomaly'
		);
		expect(lowerName('Rainfall (MERRA-2, since 1981)')).toBe('rainfall');
	});

	it('drops a bare "(since year)" note but keeps other details', () => {
		expect(lowerName('Sea surface temperature (since 1981)')).toBe('sea surface temperature');
		expect(lowerName('Air temperature (2 m)')).toBe('air temperature (2 m)');
		expect(lowerName('Sea surface temperature (MUR satellite)')).toBe(
			'sea surface temperature (MUR satellite)'
		);
	});
});

describe('headline place names', () => {
	const years = Array.from({ length: 30 }, (_, i) => 1990 + i);
	const series = {
		years,
		values: years.map((y, i) => 10 - 0.05 * (y - 1990) + (i % 3) * 0.01),
		monthsPresent: 30,
		monthsExpected: 30
	};
	const trend = analyzeTrend(series)!;
	const rel = assessReliability(trend, series, { label: 'none', level: 'Not available' });

	it('does not repeat a place the variable already names', () => {
		const story = buildStory(
			variableById('sea_ice')!,
			regionById('arctic')!,
			seasonById('m9')!,
			trend,
			rel,
			null
		);
		expect(story.headline).not.toMatch(/ in Arctic/);
		expect(story.headline).toBe(
			'September average Arctic sea-ice extent decreased significantly (1990–2019)'
		);
	});

	it('still names the place for other variables', () => {
		const story = buildStory(
			variableById('t2m')!,
			regionById('rajshahi')!,
			seasonById('annual')!,
			trend,
			rel,
			null
		);
		expect(story.headline).toMatch(/ in Rajshahi/);
	});
});
