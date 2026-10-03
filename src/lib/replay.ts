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
	describeGibsPeriod,
	gibsPeriodMilliseconds,
	isSubdailyGibsPeriod,
	isoDayDiff,
	normalizeGibsTimestamp,
	resolveAvailableDay,
	resolveAvailableTime,
	shiftIsoDay,
	shiftIsoMonth
} from './gibs';

export type ReplayStep = 'native' | '30m' | '1h' | '3h' | '6h' | '1d' | '3d' | '7d' | '16d' | '1M';

export interface ReplayStepDef {
	value: ReplayStep;
	label: string;
	/** Hours per step, for the forecast frames. */
	hours: number;
	/** Days per step, for the satellite archive (a month is walked as 30 days). */
	days: number;
}

export const REPLAY_STEPS: ReplayStepDef[] = [
	{ value: 'native', label: 'Native cadence', hours: 0, days: 0 },
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

const approximatePeriodMilliseconds = (period: GibsPeriod): number | undefined => {
	const subdaily = gibsPeriodMilliseconds(period);
	if (subdaily !== undefined) return subdaily;
	const match = /^P(\d+)(D|M|Y)$/.exec(period);
	if (!match) return undefined;
	const count = Number(match[1]);
	return (
		count *
		(match[2] === 'D' ? 86_400_000 : match[2] === 'M' ? 30 * 86_400_000 : 365.25 * 86_400_000)
	);
};

const replayStepMilliseconds = (step: ReplayStep): number => {
	if (step === 'native') return 0;
	const definition = replayStepDef(step);
	return definition.hours ? definition.hours * 3_600_000 : definition.days * 86_400_000;
};

/** Steps at least as coarse as the layer cadence; native covers unusual periods. */
export const stepsForLayer = (layer: GibsLayerDef): ReplayStep[] => {
	if (layer.period === 'static') return [];
	const nativeMs = approximatePeriodMilliseconds(layer.period);
	const candidates = [
		'30m',
		'1h',
		'3h',
		'6h',
		'1d',
		'3d',
		'7d',
		'16d',
		'1M'
	] as const satisfies readonly ReplayStep[];
	if (!nativeMs) return ['1d', '3d', '7d', '16d', '1M'];
	const coarseEnough = candidates.filter((step) => replayStepMilliseconds(step) >= nativeMs);
	const exactCadence = coarseEnough.some(
		(step) => Math.abs(replayStepMilliseconds(step) - nativeMs) < 1000
	);
	return exactCadence ? coarseEnough : ['native', ...coarseEnough];
};

/** Describe the special native option with the actual layer cadence. */
export const stepLabelForLayer = (step: ReplayStep, layer?: GibsLayerDef): string =>
	step === 'native' && layer ? `${describeGibsPeriod(layer.period)} (native)` : stepLabel(step);

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
	if (step === 'native') {
		const nativeFrames = new Set<string>();
		for (const range of ranges) {
			const lower = from > range.start ? from : range.start;
			const upper = to < range.end ? to : range.end;
			if (lower > upper) continue;
			const monthMatch = /^P(\d+)(M|Y)$/.exec(range.step);
			let candidate: string;
			let incrementMonths = 0;
			let incrementDays = 0;
			if (monthMatch) {
				incrementMonths = Number(monthMatch[1]) * (monthMatch[2] === 'Y' ? 12 : 1);
				const startMonth = new Date(`${range.start.slice(0, 7)}-01T00:00:00Z`);
				const lowerMonth = new Date(`${lower.slice(0, 7)}-01T00:00:00Z`);
				const monthsApart =
					(lowerMonth.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 +
					lowerMonth.getUTCMonth() -
					startMonth.getUTCMonth();
				candidate = shiftIsoMonth(
					range.start,
					Math.max(0, Math.ceil(monthsApart / incrementMonths) * incrementMonths)
				);
			} else {
				incrementDays = Math.max(1, range.stepDays || 1);
				const daysApart = Math.max(0, isoDayDiff(range.start, lower));
				candidate = shiftIsoDay(range.start, Math.ceil(daysApart / incrementDays) * incrementDays);
			}
			while (candidate <= upper) {
				const resolved = layer ? resolveAvailableDay(layer, candidate, [range]) : candidate;
				if (resolved) nativeFrames.add(resolved);
				candidate = incrementMonths
					? shiftIsoMonth(candidate, incrementMonths)
					: shiftIsoDay(candidate, incrementDays);
			}
		}
		return [...nativeFrames].sort();
	}
	const days = replayStepDef(step).days;
	// Sub-day strides belong to time-dimension layers and are handled by
	// `subdailyFrames`; don't let a stale setting spin a date-only archive.
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

	if (step === 'native') {
		for (const range of ranges) {
			const rangeStart = Date.parse(range.start);
			const rangeEnd = Date.parse(range.end);
			const lower = Math.max(start, rangeStart);
			const upper = Math.min(end, rangeEnd);
			if (lower > upper) continue;
			const firstIndex = Math.max(0, Math.ceil((lower - rangeStart) / range.stepMs));
			for (
				let candidate = rangeStart + firstIndex * range.stepMs;
				candidate <= upper;
				candidate += range.stepMs
			) {
				if (!add(formatUtcInstant(candidate))) return { frames: [], limitExceeded: true };
			}
		}
	} else if (step === '1M') {
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
			// Keep the requested pace while rounding to the nearest real native
			// frame. This also handles irregular intervals such as PT59M41S.
			while (candidate <= upper) {
				const nativeIndex = Math.round((candidate - rangeStart) / range.stepMs);
				const aligned = rangeStart + nativeIndex * range.stepMs;
				if (
					aligned >= lower &&
					aligned <= upper &&
					Math.abs(aligned - candidate) <= range.stepMs / 2 &&
					!add(formatUtcInstant(aligned))
				)
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

	if (temporalResolution && isSubdailyGibsPeriod(temporalResolution)) {
		const nativeMs = gibsPeriodMilliseconds(temporalResolution) ?? 30 * 60_000;
		const latestFrame = latestTime ?? `${last}T23:30:00Z`;
		const latestMs = Date.parse(latestFrame);
		const atUtcTime = latestFrame.slice(10);
		const shiftFrame = (minutes: number): string =>
			new Date(latestMs + minutes * 60_000).toISOString().replace('.000Z', 'Z');
		const standardSteps: ReplayStep[] = ['30m', '1h', '3h', '6h', '1d'];
		const stepDuration = (step: ReplayStep): number =>
			step === 'native' ? nativeMs : replayStepMilliseconds(step);
		const exactNativeStep = standardSteps.find(
			(step) => Math.abs(stepDuration(step) - nativeMs) < 1000
		);
		const nativeStep: ReplayStep = exactNativeStep ?? 'native';
		const hourlyStep =
			standardSteps.find(
				(step) => ['1h', '3h', '6h', '1d'].includes(step) && stepDuration(step) >= nativeMs
			) ?? 'native';
		const monthStep: ReplayStep = nativeMs <= 6 * 60 * 60_000 ? '6h' : '1d';
		const cadenceName = describeGibsPeriod(temporalResolution);

		presets.push(
			{
				id: 'satellite-24h',
				label: `Last 24 hours · ${nativeStep === 'native' ? cadenceName : stepLabel(nativeStep)}`,
				hint: `Every available native ${cadenceName} frame in the latest day`,
				mode: 'satellite',
				from: shiftFrame(-24 * 60),
				to: latestFrame,
				step: nativeStep
			},
			{
				id: 'satellite-week',
				label: `Last 7 days · ${stepLabel(hourlyStep)}`,
				hint: `Sample the most recent seven days at ${stepLabel(hourlyStep).toLowerCase()} cadence`,
				mode: 'satellite',
				from: shiftFrame(-7 * 24 * 60),
				to: latestFrame,
				step: hourlyStep
			}
		);

		for (const preset of presets) {
			switch (preset.id) {
				case 'satellite-month':
					preset.label = `Last 30 days · ${stepLabel(monthStep)}`;
					preset.hint = `Samples across the latest 30 days at ${stepLabel(monthStep).toLowerCase()} cadence`;
					preset.from = shiftFrame(-29 * 24 * 60);
					preset.to = latestFrame;
					preset.step = monthStep;
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
					preset.hint = `One frame per month across the ${cadenceName} record`;
					preset.from = `${coverageStart ?? `${year}-01-01`}${atUtcTime}`;
					preset.to = latestFrame;
					break;
			}
		}
	} else if (temporalResolution) {
		const nativeMs = approximatePeriodMilliseconds(temporalResolution);
		if (nativeMs !== undefined && nativeMs > 86_400_000) {
			const candidates: ReplayStep[] = ['1d', '3d', '7d', '16d', '1M'];
			const cadenceStep =
				candidates.find((step) => Math.abs(replayStepMilliseconds(step) - nativeMs) < 1000) ??
				'native';
			const cadenceName = describeGibsPeriod(temporalResolution);
			for (const preset of presets) {
				switch (preset.id) {
					case 'satellite-month':
						preset.label = `Last 30 days · ${cadenceName}`;
						preset.hint = `Show frames at the layer's ${cadenceName} cadence`;
						preset.step = cadenceStep;
						break;
					case 'satellite-monsoon':
						preset.label = `Monsoon · ${cadenceName}`;
						preset.hint = `Show available frames at the layer's ${cadenceName} cadence during monsoon`;
						preset.step = cadenceStep;
						break;
					case 'satellite-year':
						preset.label = `This year · ${cadenceName}`;
						preset.hint = `Show available frames at the layer's ${cadenceName} cadence this year`;
						preset.step = cadenceStep;
						break;
					case 'satellite-all':
						preset.label = `Whole archive · ${cadenceName}`;
						preset.hint = `Walk the full archive at its native ${cadenceName} cadence`;
						preset.step = cadenceStep;
						break;
				}
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
