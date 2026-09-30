/**
 * Replay math: turning a range plus a cadence into the list of frames that can
 * really be shown, and the presets the timeline offers on top of it.
 *
 * Everything here is pure, so the rules that matter — which days exist, which
 * step a layer can even move in, which presets are honest for a dataset — are
 * testable without a map or a browser. The store and the UI only sequence
 * these results.
 *
 * A frame is identified by its clock value: `YYYY-MM-DD` in the satellite
 * archive (GIBS publishes daily imagery) and `YYYY-MM-DDTHHMM` in the forecast,
 * the same shape the app already puts in its `time` URL parameter.
 */
import {
	type GibsAvailabilityRange,
	type GibsLayerDef,
	isoDayDiff,
	resolveAvailableDay,
	shiftIsoDay
} from './gibs';

export type ReplayStep = '1h' | '3h' | '6h' | '1d' | '3d' | '7d' | '16d' | '1M';

export interface ReplayStepDef {
	value: ReplayStep;
	label: string;
	/** Hours per step, for the forecast frames. */
	hours: number;
	/** Days per step, for the satellite archive (a month is walked as 30 days). */
	days: number;
}

export const REPLAY_STEPS: ReplayStepDef[] = [
	{ value: '1h', label: '1 hour', hours: 1, days: 1 },
	{ value: '3h', label: '3 hours', hours: 3, days: 1 },
	{ value: '6h', label: '6 hours', hours: 6, days: 1 },
	{ value: '1d', label: '1 day', hours: 24, days: 1 },
	{ value: '3d', label: '3 days', hours: 72, days: 3 },
	{ value: '7d', label: '7 days', hours: 168, days: 7 },
	{ value: '16d', label: '16 days', hours: 384, days: 16 },
	{ value: '1M', label: '1 month', hours: 720, days: 30 }
];

export const replayStepDef = (step: ReplayStep): ReplayStepDef =>
	REPLAY_STEPS.find((entry) => entry.value === step) ?? REPLAY_STEPS[3];

export const stepLabel = (step: ReplayStep): string => replayStepDef(step).label;

/** Steps that only make sense in the forecast: the imagery is daily at best. */
export const isHourlyStep = (step: ReplayStep): boolean => step.endsWith('h');

/** Steps the layer itself moves in (a monthly composite has no daily change). */
export const stepsForLayer = (layer: GibsLayerDef): ReplayStep[] => {
	if (layer.period === 'P1M') return ['1M', '16d', '7d'];
	if (layer.period === 'P16D') return ['16d', '1M', '7d'];
	return ['1d', '3d', '7d', '16d', '1M'];
};

export type ReplayMode = 'forecast' | 'satellite';
export type ReplayFrame = string;

/** A day is inside the archive when some published range covers it. */
export const isDayInRanges = (day: string, ranges: GibsAvailabilityRange[]): boolean =>
	ranges.some((range) => day >= range.start && day <= range.end);

/**
 * Satellite frames: walk the requested days, keep only the ones the layer
 * really published, and collapse days that resolve to the same composite.
 *
 * The collapse matters for the 16-day and monthly layers: stepping "one day"
 * through a monthly composite would otherwise replay the very same picture
 * thirty times, which looks like a frozen animation rather than a record.
 */
export const satelliteFrames = (
	ranges: GibsAvailabilityRange[],
	from: string,
	to: string,
	step: ReplayStep,
	layer?: GibsLayerDef
): ReplayFrame[] => {
	if (!ranges.length || from > to) return [];
	const days = replayStepDef(step).days;
	const frames: ReplayFrame[] = [];
	let previous: string | undefined;

	for (let day = from; day <= to; day = shiftIsoDay(day, days)) {
		if (!isDayInRanges(day, ranges)) continue;
		// Clamp/snap into the archive exactly like the timeline does, so a frame
		// can never point at a day that has no imagery.
		const resolved = layer ? resolveAvailableDay(layer, day, ranges) : day;
		if (!resolved || resolved === previous) continue;
		frames.push(resolved);
		previous = resolved;
	}

	// A coarse walk stops just short of the end (a month-long step cannot land on
	// it exactly), so the last day of the range is added when it is close enough:
	// a replay should end where the user drew the end, not weeks earlier.
	const lastWalked = frames[frames.length - 1];
	if (lastWalked && lastWalked < to && isoDayDiff(lastWalked, to) < days) {
		const resolvedTo = layer ? resolveAvailableDay(layer, to, ranges) : to;
		if (resolvedTo && resolvedTo !== lastWalked) frames.push(resolvedTo);
	}

	return frames;
};

/**
 * Forecast frames: the run's own `valid_times` are the only steps that exist,
 * so the requested cadence is applied by taking every step-th hour instead of
 * by generating clock values that may have no file behind them.
 */
export const forecastFrames = (
	validTimes: Date[],
	from: string,
	to: string,
	step: ReplayStep
): ReplayFrame[] => {
	const wanted = replayStepDef(step).hours;
	const sorted = [...validTimes].sort((a, b) => a.getTime() - b.getTime());
	const frames: ReplayFrame[] = [];
	let lastKept: number | undefined;

	for (const time of sorted) {
		const day = time.toISOString().slice(0, 10);
		if (day < from || day > to) continue;
		if (lastKept !== undefined && (time.getTime() - lastKept) / 3_600_000 < wanted) continue;
		frames.push(`${day}T${time.toISOString().slice(11, 16).replace(':', '')}`);
		lastKept = time.getTime();
	}

	return frames;
};

/** Nearest frame index to a clock value, so a replay can pick up where the map is. */
export const frameIndexFor = (frames: ReplayFrame[], value?: string): number => {
	if (!frames.length) return 0;
	if (!value) return frames.length - 1;
	const day = value.slice(0, 10);
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	frames.forEach((frame, index) => {
		const distance = Math.abs(isoDayDiff(frame.slice(0, 10), day));
		if (distance < bestDistance) {
			bestDistance = distance;
			best = index;
		}
	});
	return best;
};

/** `1 Jun 2024` style label for the range summary. */
export const formatReplayDay = (day: string): string =>
	new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${day}T00:00:00Z`));

export interface ReplayPreset {
	id: string;
	label: string;
	/** What the preset does, shown as the button's tooltip. */
	hint: string;
	mode: ReplayMode;
	from: string;
	to: string;
	step: ReplayStep;
}

/**
 * The presets the timeline offers. They are built from the layer's real
 * record, so "whole archive" ends on the last day that exists instead of on
 * today, and "monsoon" never reaches into a season the layer cannot show.
 */
export const replayPresets = (options: {
	latestDay?: string;
	coverageStart?: string;
	forecastStart?: string;
	today: string;
}): ReplayPreset[] => {
	const { latestDay, coverageStart, forecastStart, today } = options;
	const last = latestDay ?? today;
	const year = Number(last.slice(0, 4));
	// Before this year's monsoon has started, the useful season is last year's:
	// an empty preset would be dropped, a past one is exactly what floods are
	// studied against.
	const seasonYear = last < `${year}-06-01` ? year - 1 : year;
	const monsoonEnd = `${seasonYear}-09-30`;
	const presets: ReplayPreset[] = [
		{
			id: 'forecast-week',
			label: 'Last 7 days',
			hint: 'The forecast run hour by hour, from the start of the archive window to now',
			mode: 'forecast',
			from: forecastStart ?? shiftIsoDay(today, -6),
			to: today,
			step: '1h'
		},
		{
			id: 'forecast-run',
			label: 'Whole run',
			hint: 'Every hourly step of the loaded model run',
			mode: 'forecast',
			from: forecastStart ?? shiftIsoDay(today, -6),
			to: today,
			step: '1h'
		},
		{
			id: 'satellite-month',
			label: 'Last 30 days',
			hint: 'One frame per day over the last month of imagery',
			mode: 'satellite',
			from: shiftIsoDay(last, -29),
			to: last,
			step: '1d'
		},
		{
			id: 'satellite-monsoon',
			label: 'Monsoon',
			hint: 'June to September — the season floods, rivers and vegetation are made by',
			mode: 'satellite',
			from: `${seasonYear}-06-01`,
			to: last < monsoonEnd ? last : monsoonEnd,
			step: '1d'
		},
		{
			id: 'satellite-year',
			label: 'This year',
			hint: 'January to now, one frame per day',
			mode: 'satellite',
			from: `${year}-01-01`,
			to: last,
			step: '1d'
		},
		{
			id: 'satellite-all',
			label: 'Whole archive',
			hint: 'Every month of the layer’s record, from its first day of coverage',
			mode: 'satellite',
			from: coverageStart ?? `${year}-01-01`,
			to: last,
			step: '1M'
		}
	];

	// A preset that cannot show anything (an unknown archive, a range that runs
	// backwards) is dropped rather than offered as a dead button.
	return presets.filter((preset) => preset.from <= preset.to);
};

/** Address-bar keys, so a replay range survives a reload and can be shared. */
export const REPLAY_URL_FROM = 'replay-from';
export const REPLAY_URL_TO = 'replay-to';
export const REPLAY_URL_STEP = 'replay-step';

/** The replay range as URL parameters; an unset range writes nothing. */
export const replayUrlParams = (state: {
	open: boolean;
	from?: string;
	to?: string;
	step: ReplayStep;
}): Record<string, string> => {
	if (!state.open) return {};
	const params: Record<string, string> = {};
	if (state.from) params[REPLAY_URL_FROM] = state.from;
	if (state.to) params[REPLAY_URL_TO] = state.to;
	if (state.step !== '1d') params[REPLAY_URL_STEP] = state.step;
	return params;
};

const VALID_STEPS = REPLAY_STEPS.map((entry) => entry.value) as string[];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A shared replay range back from a location search string. */
export const parseReplayUrl = (
	search: string
): {
	from?: string;
	to?: string;
	step?: ReplayStep;
} => {
	const params = new URLSearchParams(search);
	const from = params.get(REPLAY_URL_FROM);
	const to = params.get(REPLAY_URL_TO);
	const step = params.get(REPLAY_URL_STEP);
	const valid = (value: string | null): value is string => !!value && ISO_DAY.test(value);
	return {
		from: valid(from) ? from : undefined,
		to: valid(to) ? to : undefined,
		step: step && VALID_STEPS.includes(step) ? (step as ReplayStep) : undefined
	};
};

/**
 * The wall-clock span of a frame list, for warming the forecast files up ahead
 * of a play-through. Frames are clock strings, so the span is just the first
 * and the last one widened to the whole day.
 */
export const warmupRange = (frames: ReplayFrame[]): { start: Date; end: Date } | undefined => {
	const first = frames[0];
	const last = frames[frames.length - 1];
	if (!first || !last) return undefined;
	const start = new Date(`${first.slice(0, 10)}T00:00:00Z`);
	const end = new Date(`${last.slice(0, 10)}T23:59:59Z`);
	return start <= end ? { start, end } : undefined;
};
