import { describe, expect, it } from 'vitest';

import {
	GIBS_LAYERS,
	type GibsAvailabilityRange,
	gibsLayerById,
	resolveAvailableDay
} from '$lib/gibs';
import {
	type ReplayStep,
	forecastFrames,
	frameIndexFor,
	isDayInRanges,
	parseReplayUrl,
	replayPresets,
	replayStepDef,
	replayUrlParams,
	satelliteFrames,
	stepLabel,
	stepsForLayer,
	warmupRange
} from '$lib/replay';

const range = (start: string, end: string, step = 'P1D'): GibsAvailabilityRange => ({
	start,
	end,
	stepDays: step === 'P16D' ? 16 : 1,
	step
});

/** A daily layer with one gap, and monthly coverage before it. */
const DAILY: GibsAvailabilityRange[] = [
	range('2024-05-01', '2024-05-04'),
	range('2024-05-06', '2024-05-10')
];

describe('replayStepDef', () => {
	it('knows the cadence of every step', () => {
		expect(replayStepDef('1h')).toMatchObject({ hours: 1, days: 1 });
		expect(replayStepDef('16d')).toMatchObject({ hours: 384, days: 16 });
		expect(replayStepDef('1M')).toMatchObject({ days: 30 });
	});

	it('falls back to a day instead of returning nothing', () => {
		expect(replayStepDef('nonsense' as ReplayStep).value).toBe('1d');
		expect(stepLabel('7d')).toBe('7 days');
	});

	it('offers only the cadences a composite layer can actually change in', () => {
		const daily = gibsLayerById('MODIS_Terra_CorrectedReflectance_TrueColor')!;
		const sixteen = gibsLayerById('MODIS_Aqua_L3_NDVI_16Day')!;
		const monthly = gibsLayerById('MERRA2_2m_Air_Temperature_Monthly')!;
		expect(stepsForLayer(daily)).toContain('1d');
		expect(stepsForLayer(sixteen)[0]).toBe('16d');
		expect(stepsForLayer(sixteen)).not.toContain('1d');
		expect(stepsForLayer(monthly)[0]).toBe('1M');
		expect(stepsForLayer(monthly)).not.toContain('1d');
	});
});

describe('isDayInRanges', () => {
	it('accepts published days and rejects the gap', () => {
		expect(isDayInRanges('2024-05-01', DAILY)).toBe(true);
		expect(isDayInRanges('2024-05-04', DAILY)).toBe(true);
		expect(isDayInRanges('2024-05-05', DAILY)).toBe(false);
		expect(isDayInRanges('2024-04-30', DAILY)).toBe(false);
	});
});

describe('satelliteFrames', () => {
	it('walks the range a day at a time and skips the gap', () => {
		const frames = satelliteFrames(DAILY, '2024-05-01', '2024-05-10', '1d');
		expect(frames).toEqual([
			'2024-05-01',
			'2024-05-02',
			'2024-05-03',
			'2024-05-04',
			'2024-05-06',
			'2024-05-07',
			'2024-05-08',
			'2024-05-09',
			'2024-05-10'
		]);
		expect(frames).not.toContain('2024-05-05');
	});

	it('walks every third day when asked to', () => {
		expect(satelliteFrames(DAILY, '2024-05-01', '2024-05-10', '3d')).toEqual([
			'2024-05-01',
			'2024-05-04',
			'2024-05-07',
			'2024-05-10'
		]);
	});

	it('collapses frames that resolve to the same composite', () => {
		// A 16-day layer asked for a daily replay: every day inside one composite
		// resolves to that composite's start day, so the replay must not repeat it.
		const sixteen = gibsLayerById('MODIS_Aqua_L3_NDVI_16Day')!;
		const ranges = [range('2024-05-01', '2024-06-30', 'P16D')];
		const frames = satelliteFrames(ranges, '2024-05-01', '2024-05-20', '1d', sixteen);
		expect(frames.length).toBeLessThan(20);
		expect(new Set(frames).size).toBe(frames.length);
		for (const frame of frames) {
			expect(resolveAvailableDay(sixteen, frame, ranges)).toBe(frame);
		}
	});

	it('returns nothing for an empty archive or a backwards range', () => {
		expect(satelliteFrames([], '2024-05-01', '2024-05-10', '1d')).toEqual([]);
		expect(satelliteFrames(DAILY, '2024-05-10', '2024-05-01', '1d')).toEqual([]);
	});

	it('ends where the range ends, even on a coarse monthly walk', () => {
		const ranges = [range('2000-01-01', '2026-01-01', 'P1M')];
		const frames = satelliteFrames(ranges, '2019-01-01', '2020-01-05', '1M');
		expect(frames[0]).toBe('2019-01-01');
		// Thirty-day steps cannot land on 5 Jan, so the end is added explicitly;
		// without it the most recent month of the archive would be missing.
		expect(frames[frames.length - 1]).toBe('2020-01-05');
		for (const frame of frames) expect(frame <= '2020-01-05').toBe(true);
		expect(frames.length).toBeGreaterThan(12);
	});
});

describe('forecastFrames', () => {
	/** Three-hourly steps across two days, the shape a model run publishes. */
	const validTimes = Array.from(
		{ length: 16 },
		(_, index) => new Date(Date.UTC(2024, 4, 1 + Math.floor(index / 8), (index % 8) * 3))
	);

	it('samples the requested cadence out of the run’s own steps', () => {
		const frames = forecastFrames(validTimes, '2024-05-01', '2024-05-02', '6h');
		expect(frames).toEqual([
			'2024-05-01T0000',
			'2024-05-01T0600',
			'2024-05-01T1200',
			'2024-05-01T1800',
			'2024-05-02T0000',
			'2024-05-02T0600',
			'2024-05-02T1200',
			'2024-05-02T1800'
		]);
	});

	it('keeps every step when asked for the layer’s own cadence', () => {
		expect(forecastFrames(validTimes, '2024-05-01', '2024-05-01', '3h').length).toBe(8);
	});

	it('never invents a step the run does not have', () => {
		for (const frame of forecastFrames(validTimes, '2024-05-01', '2024-05-02', '1h')) {
			const stamp = `${frame.slice(0, 10)}T${frame.slice(11, 13)}:${frame.slice(13, 15)}`;
			expect(validTimes.map((time) => time.toISOString().slice(0, 16))).toContain(stamp);
		}
	});

	it('respects the range boundaries', () => {
		expect(forecastFrames(validTimes, '2024-05-02', '2024-05-02', '3h').length).toBe(8);
		expect(forecastFrames([], '2024-05-01', '2024-05-02', '1h')).toEqual([]);
	});
});

describe('frameIndexFor', () => {
	const frames = ['2024-05-01', '2024-05-02', '2024-05-03', '2024-05-04'];

	it('finds the frame closest to the day on screen', () => {
		expect(frameIndexFor(frames, '2024-05-01')).toBe(0);
		expect(frameIndexFor(frames, '2024-05-03')).toBe(2);
		// A day between frames (a gap, or a composite) picks the closer one.
		expect(frameIndexFor(frames, '2024-05-03T1200')).toBe(2);
	});

	it('falls back to the last frame when nothing is known', () => {
		expect(frameIndexFor(frames, undefined)).toBe(3);
		expect(frameIndexFor([], '2024-05-01')).toBe(0);
	});
});

describe('replayPresets', () => {
	const presets = replayPresets({
		latestDay: '2026-09-28',
		coverageStart: '2000-02-24',
		forecastStart: '2026-09-23',
		today: '2026-09-30'
	});
	const byId = (id: string) => presets.find((preset) => preset.id === id)!;

	it('builds the forecast presets from the loaded run, not from today', () => {
		expect(byId('forecast-week')).toMatchObject({
			mode: 'forecast',
			from: '2026-09-23',
			to: '2026-09-30',
			step: '1h'
		});
	});

	it('ends the satellite presets on the last day that exists', () => {
		expect(byId('satellite-month')).toMatchObject({ from: '2026-08-30', to: '2026-09-28' });
		expect(byId('satellite-year').to).toBe('2026-09-28');
		expect(byId('satellite-all').from).toBe('2000-02-24');
		expect(byId('satellite-all').step).toBe('1M');
	});

	it('runs the monsoon preset to the end of the season, or to the record', () => {
		expect(byId('satellite-monsoon')).toMatchObject({
			from: '2026-06-01',
			to: '2026-09-28',
			step: '1d'
		});
	});

	it('falls back to last year’s monsoon when this year’s has not started', () => {
		const beforeMonsoon = replayPresets({
			latestDay: '2026-03-05',
			coverageStart: '2000-02-24',
			today: '2026-03-06'
		}).find((preset) => preset.id === 'satellite-monsoon')!;
		expect(beforeMonsoon.from).toBe('2025-06-01');
		expect(beforeMonsoon.to).toBe('2025-09-30');
	});

	it('drops presets that could not show anything', () => {
		const backwards = replayPresets({
			latestDay: '2026-09-28',
			coverageStart: '2030-01-01',
			today: '2026-09-30'
		});
		expect(backwards.map((preset) => preset.id)).not.toContain('satellite-all');
		for (const preset of backwards) expect(preset.from <= preset.to).toBe(true);
	});

	it('every preset has a distinct id, a label and a hint', () => {
		const ids = presets.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const preset of presets) {
			expect(preset.label.length).toBeGreaterThan(0);
			expect(preset.hint.length).toBeGreaterThan(0);
		}
	});
});

describe('replay URL round trip', () => {
	it('writes only a configured range', () => {
		expect(replayUrlParams({ open: false, from: '2024-01-01', step: '1d' })).toEqual({});
		expect(replayUrlParams({ open: true, step: '1d' })).toEqual({});
		expect(
			replayUrlParams({ open: true, from: '2024-01-01', to: '2024-02-01', step: '1M' })
		).toEqual({
			'replay-from': '2024-01-01',
			'replay-to': '2024-02-01',
			'replay-step': '1M'
		});
	});

	it('reads back what it wrote', () => {
		const params = replayUrlParams({
			open: true,
			from: '2024-01-01',
			to: '2024-02-01',
			step: '7d'
		});
		expect(parseReplayUrl(`?${new URLSearchParams(params).toString()}`)).toEqual({
			from: '2024-01-01',
			to: '2024-02-01',
			step: '7d'
		});
	});

	it('ignores a malformed range instead of failing', () => {
		expect(parseReplayUrl('')).toEqual({ from: undefined, to: undefined, step: undefined });
		expect(parseReplayUrl('?replay-from=when&replay-step=2w')).toEqual({
			from: undefined,
			to: undefined,
			step: undefined
		});
	});
});

describe('catalogue coverage', () => {
	it('answers for every layer with a plausible number of steps', () => {
		for (const layer of GIBS_LAYERS) {
			const steps = stepsForLayer(layer);
			expect(steps.length).toBeGreaterThan(0);
			for (const step of steps) expect(replayStepDef(step).days).toBeGreaterThan(0);
		}
	});
});

describe('warmupRange', () => {
	it('spans the whole first and last day of the frames', () => {
		const range = warmupRange(['2024-05-01T0600', '2024-05-02T1200', '2024-05-03T1800'])!;
		expect(range.start.toISOString()).toBe('2024-05-01T00:00:00.000Z');
		expect(range.end.toISOString()).toBe('2024-05-03T23:59:59.000Z');
	});

	it('works for day-only satellite frames too', () => {
		const range = warmupRange(['2024-05-01', '2024-05-01'])!;
		expect(range.start.toISOString()).toBe('2024-05-01T00:00:00.000Z');
		expect(range.end.toISOString()).toBe('2024-05-01T23:59:59.000Z');
	});

	it('returns nothing when there is nothing to warm up', () => {
		expect(warmupRange([])).toBeUndefined();
	});
});
