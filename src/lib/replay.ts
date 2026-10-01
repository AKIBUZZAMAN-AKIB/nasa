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
	type GibsPeriod,
	type GibsTimeRange,
	isoDayDiff,
	normalizeGibsTimestamp,
	resolveAvailableDay,
	resolveAvailableTime,
	shiftIsoDay
} from './gibs';

export type ReplayStep = '30m' | '1h' | '3h' | '6h' | '1d' | '3d' | '7d' | '16d' | '1M';

export interface ReplayStepDef {
	value: ReplayStep;
	label: string;
	/** Hours per step, for the forecast frames. */
	hours: number;
	/** Days per step, for the satellite archive (a month is walked as 30 days). */
	days: number;
}

export const REPLAY_STEPS: ReplayStepDef[] = [
	{ value: '30m', label: '30 minutes', hours: 0.5, days: 1 / 48 },
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
	REPLAY_STEPS.find((entry) => entry.value === step) ??
	REPLAY_STEPS.find((entry) => entry.value === '1d')!;

export const stepLabel = (step: ReplayStep): string => replayStepDef(step).label;

/** Hourly model steps; GIBS imagery has its own layer-specific choices. */
export const isHourlyStep = (step: ReplayStep): boolean =>
	step === '1h' || step === '3h' || step === '6h';

/** Steps the layer can show without repeating a coarser composite. */
export const stepsForLayer = (layer: GibsLayerDef): ReplayStep[] => {
	if (layer.period === 'PT30M') return ['30m', '1h', '3h', '6h', '1d', '3d', '7d', '16d', '1M'];
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
	// Sub-day steps are only meaningful on PT30M layers; never let a date-only
	// layer spin forever when given a malformed or stale fine-cadence setting.
	if (!Number.isFinite(days) || days < 1) return [];
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

/** A protective ceiling: a full half-hour archive is hundreds of thousands of frames. */
export const MAX_SUBDAILY_REPLAY_FRAMES = 5000;

export interface SubdailyFrameResult {
	frames: ReplayFrame[];
	limitExceeded: boolean;
}

const formatUtcInstant = (milliseconds: number): string =>
	new Date(milliseconds).toISOString().replace('.000Z', 'Z');

/** Calendar-month increment that clamps Jan 31 to the target month's last day. */
const shiftUtcMonth = (milliseconds: number, months: number): number => {
	const current = new Date(milliseconds);
	const wantedDay = current.getUTCDate();
	const target = new Date(
		Date.UTC(
			current.getUTCFullYear(),
			current.getUTCMonth() + months,
			1,
			current.getUTCHours(),
			current.getUTCMinutes(),
			current.getUTCSeconds()
		)
	);
	const endOfMonth = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	target.setUTCDate(Math.min(wantedDay, endOfMonth));
	return target.getTime();
};

/**
 * Time-aware satellite frames. The compact GIBS ranges stay compressed; only
 * the user-selected interval is sampled. Missing half-hours are skipped, never
 * synthesized. Very large 30-minute ranges stop at a visible 5,000-frame cap.
 */
export const subdailyFrames = (
	ranges: GibsTimeRange[],
	from: string,
	to: string,
	step: ReplayStep
): SubdailyFrameResult => {
	const bound = (value: string, endOfDay: boolean): string | undefined => {
		if (/^\d{4}-\d{2}-\d{2}$/.test(value))
			return normalizeGibsTimestamp(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
		return normalizeGibsTimestamp(value);
	};
	const normalizedFrom = bound(from, false);
	const normalizedTo = bound(to, true);
	if (!ranges.length || !normalizedFrom || !normalizedTo || normalizedFrom > normalizedTo)
		return { frames: [], limitExceeded: false };

	const start = Date.parse(normalizedFrom);
	const end = Date.parse(normalizedTo);
	const frames: ReplayFrame[] = [];
	const seen = new Set<string>();
	const add = (frame: string): boolean => {
		if (seen.has(frame)) return true;
		seen.add(frame);
		frames.push(frame);
		return frames.length <= MAX_SUBDAILY_REPLAY_FRAMES;
	};
	const availableStep = Math.min(...ranges.map((range) => range.stepMs));

	if (step === '1M') {
		for (let candidate = start; candidate <= end; candidate = shiftUtcMonth(candidate, 1)) {
			const resolved = resolveAvailableTime(ranges, formatUtcInstant(candidate));
			if (!resolved) continue;
			const resolvedMs = Date.parse(resolved);
			// A month sampled inside a long outage is not a valid frame: only snap
			// when the nearest published timestamp is within one native interval.
			if (Math.abs(resolvedMs - candidate) > availableStep / 2) continue;
			if (resolvedMs >= start && resolvedMs <= end && !add(resolved))
				return { frames: [], limitExceeded: true };
		}
	} else {
		const strideMs = replayStepDef(step).hours * 60 * 60 * 1000;
		if (strideMs < availableStep) return { frames: [], limitExceeded: false };

		for (const range of ranges) {
			const rangeStart = Date.parse(range.start);
			const rangeEnd = Date.parse(range.end);
			const lower = Math.max(start, rangeStart);
			const upper = Math.min(end, rangeEnd);
			if (lower > upper) continue;

			let index = Math.max(0, Math.ceil((lower - start) / strideMs));
			let candidate = start + index * strideMs;
			// Both the requested cadence and native cadence are UTC intervals.
			// Skip a misaligned candidate instead of letting GIBS silently snap it.
			while (candidate <= upper) {
				if ((candidate - rangeStart) % range.stepMs === 0 && !add(formatUtcInstant(candidate)))
					return { frames: [], limitExceeded: true };
				index += 1;
				candidate = start + index * strideMs;
			}
		}

		// Do not append an off-cadence endpoint: every emitted frame keeps the
		// selected interval (e.g. hourly stays hourly, even at the range edge).
	}

	frames.sort((a, b) => a.localeCompare(b));
	return { frames, limitExceeded: false };
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

const replayInstantMs = (value: string): number => {
	const normalized = normalizeGibsTimestamp(value);
	if (normalized) return Date.parse(normalized);
	// Forecast frame keys use the app's compact UTC shape: YYYY-MM-DDTHHMM.
	const compact = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})$/.exec(value);
	if (compact) return Date.parse(`${compact[1]}T${compact[2]}:${compact[3]}:00Z`);
	return Number.NaN;
};

/** Nearest exact frame, including clock time when the layer is sub-daily. */
export const frameIndexFor = (frames: ReplayFrame[], value?: string): number => {
	if (!frames.length) return 0;
	if (!value) return frames.length - 1;
	const target = replayInstantMs(value);
	if (!Number.isFinite(target)) return 0;
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	frames.forEach((frame, index) => {
		const frameMs = replayInstantMs(frame);
		const distance = Number.isFinite(frameMs)
			? Math.abs(frameMs - target)
			: Math.abs(isoDayDiff(frame.slice(0, 10), value.slice(0, 10))) * 86_400_000;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = index;
		}
	});
	return best;
};

/** Human-readable UTC label for a day or exact frame key. */
export const formatReplayDay = (value: string): string => {
	const day = value.slice(0, 10);
	const formatted = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${day}T00:00:00Z`));
	const normalized = normalizeGibsTimestamp(value);
	if (normalized && value.includes('T')) return `${formatted} ${normalized.slice(11, 16)} UTC`;
	const compact = /T(\d{2})(\d{2})$/.exec(value);
	return compact ? `${formatted} ${compact[1]}:${compact[2]} UTC` : formatted;
};

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
	latestTime?: string;
	coverageStart?: string;
	forecastStart?: string;
	temporalResolution?: GibsPeriod;
	today: string;
}): ReplayPreset[] => {
	const { latestDay, latestTime, coverageStart, forecastStart, temporalResolution, today } =
		options;
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

	if (temporalResolution === 'PT30M') {
		const latestFrame = latestTime ?? `${last}T23:30:00Z`;
		const latestMs = Date.parse(latestFrame);
		const atUtcTime = latestFrame.slice(10);
		const shiftFrame = (minutes: number): string =>
			new Date(latestMs + minutes * 60_000).toISOString().replace('.000Z', 'Z');
		presets.push(
			{
				id: 'satellite-24h',
				label: 'Last 24 hours · 30 min',
				hint: 'Every available 30-minute IMERG frame in the latest day',
				mode: 'satellite',
				from: shiftFrame(-24 * 60),
				to: latestFrame,
				step: '30m'
			},
			{
				id: 'satellite-week',
				label: 'Last 7 days · hourly',
				hint: 'Hourly samples of the most recent seven days of IMERG',
				mode: 'satellite',
				from: shiftFrame(-7 * 24 * 60),
				to: latestFrame,
				step: '1h'
			}
		);

		for (const preset of presets) {
			switch (preset.id) {
				case 'satellite-month':
					preset.label = 'Last 30 days · 6-hour';
					preset.hint = 'Six-hour samples across the latest 30 days';
					preset.from = shiftFrame(-29 * 24 * 60);
					preset.to = latestFrame;
					preset.step = '6h';
					break;
				case 'satellite-monsoon':
					preset.label = 'Monsoon · daily';
					preset.hint = 'One UTC-day sample from June to September';
					preset.from = `${seasonYear}-06-01${atUtcTime}`;
					preset.to = last < monsoonEnd ? latestFrame : `${monsoonEnd}${atUtcTime}`;
					break;
				case 'satellite-year':
					preset.label = 'This year · daily';
					preset.hint = 'One UTC-day sample from January to the latest published frame';
					preset.from = `${year}-01-01${atUtcTime}`;
					preset.to = latestFrame;
					break;
				case 'satellite-all':
					preset.label = 'Whole archive · monthly';
					preset.hint = 'One frame per month across the half-hourly record';
					preset.from = `${coverageStart ?? `${year}-01-01`}${atUtcTime}`;
					preset.to = latestFrame;
					break;
			}
		}
	}

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
	const parseBound = (value: string | null): string | undefined => {
		if (!value) return undefined;
		if (ISO_DAY.test(value)) return normalizeGibsTimestamp(value) ? value : undefined;
		return normalizeGibsTimestamp(value);
	};
	return {
		from: parseBound(from),
		to: parseBound(to),
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
