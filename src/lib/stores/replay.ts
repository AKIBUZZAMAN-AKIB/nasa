/**
 * Replay: the timeline playing a range of the archive instead of the user
 * stepping through it.
 *
 * The engine is deliberately thin — the frames come from `$lib/replay` (which
 * days exist, at which cadence), the drawing comes from the stores that already
 * own the map (satellite browsing in `stores/gibs`, forecast time in
 * `stores/time`), and this file only sequences them: pick a range, step through
 * its frames on a clock, keep the next frame warm, and keep the URL honest.
 *
 * Speed and loop are persisted because a replay is usually run several times in
 * a row; the range is not, because it belongs to whatever the user is looking at
 * (and a shared link carries it in the address bar).
 */
import { derived, get, writable } from 'svelte/store';

import { persisted } from 'svelte-persisted-store';
import { toast } from 'svelte-sonner';

import { browser } from '$app/environment';

import { gibsLayerById, isoDayOf, latestAvailableDay } from '$lib/gibs';
import {
	REPLAY_URL_FROM,
	REPLAY_URL_STEP,
	REPLAY_URL_TO,
	type ReplayFrame,
	type ReplayMode,
	type ReplayPreset,
	type ReplayStep,
	forecastFrames,
	frameIndexFor,
	isHourlyStep,
	parseReplayUrl,
	replayPresets,
	replayUrlParams,
	satelliteFrames,
	stepLabel,
	stepsForLayer
} from '$lib/replay';
import { formatISOWithoutTimezone, parseISOWithoutTimezone } from '$lib/time-format';

import { preloadGibsDay } from '../gibs-layers';
import { changeOMfileURL } from '../layers';
import { updateUrl } from '../url';
import {
	enterGibsBrowse,
	exitGibsBrowse,
	gibsAvailability,
	gibsBrowse,
	gibsLayerId,
	gibsResolvedDate,
	setGibsDate
} from './gibs';
import { metaJson, time } from './time';

/** Whether the replay controls are open on the timeline. */
export const replayOpen = writable(false);

/** Which archive the frames come from. */
export const replayMode = writable<ReplayMode>('satellite');

export const replayFrom = writable<string | undefined>(undefined);
export const replayTo = writable<string | undefined>(undefined);

/** Cadence between frames. */
export const replayStep = persisted<ReplayStep>('replay-step', '1d');

/** Frames per second is expressed as a multiplier of the 0.5 s base cadence. */
export const replaySpeed = persisted<number>('replay-speed', 1);
export const replayLoop = persisted<boolean>('replay-loop', true);

/** Preset the current range came from, so the UI can show it as active. */
export const replayPresetId = writable<string | undefined>(undefined);

export const replayFrames = writable<ReplayFrame[]>([]);
export const replayIndex = writable(0);
export const replayPlaying = writable(false);

/** `500 ms` at 1×, `250 ms` at 2×, `1000 ms` at 0.5×. */
export const replayIntervalMs = (speed: number): number => Math.max(120, Math.round(500 / speed));

let timer: ReturnType<typeof setTimeout> | undefined;

/** Presets built from the layer's real record and the loaded model run. */
export const replayPresetList = derived(
	[gibsAvailability, gibsLayerId, metaJson],
	([$availability, $layerId, $metaJson]): ReplayPreset[] => {
		const layer = gibsLayerById($layerId);
		const validTimes = $metaJson?.valid_times ?? [];
		return replayPresets({
			latestDay: latestAvailableDay($availability.ranges),
			coverageStart: layer?.coverageStart ?? $availability.ranges[0]?.start,
			forecastStart: validTimes.length ? isoDayOf(new Date(validTimes[0])) : undefined,
			today: isoDayOf(new Date())
		});
	}
);

/** The frames the current range and cadence can actually show. */
const buildFrames = (): ReplayFrame[] => {
	const step = get(replayStep);
	const from = get(replayFrom);
	const to = get(replayTo);

	if (get(replayMode) === 'forecast') {
		const validTimes = (get(metaJson)?.valid_times ?? []).map((value) => new Date(value));
		if (!validTimes.length) return [];
		const start = from ?? isoDayOf(validTimes[0]);
		const end = to ?? isoDayOf(validTimes[validTimes.length - 1]);
		return forecastFrames(validTimes, start, end, isHourlyStep(step) ? step : step);
	}

	const { ranges } = get(gibsAvailability);
	if (!ranges.length) return [];
	const layer = gibsLayerById(get(gibsLayerId));
	const start = from ?? ranges[0].start;
	const end = to ?? latestAvailableDay(ranges) ?? ranges[ranges.length - 1].end;
	return satelliteFrames(ranges, start, end, step, layer);
};

/** Recompute the frame list; called whenever a frame source changes. */
export const refreshReplayFrames = (): ReplayFrame[] => {
	const frames = buildFrames();
	replayFrames.set(frames);
	const index = get(replayIndex);
	if (index >= frames.length) replayIndex.set(0);
	return frames;
};

/**
 * Which archive a hand-typed range belongs to: a day inside the loaded model
 * run is a forecast replay, anything older is the satellite archive. Without
 * the run loaded yet, the archive is the safe answer — it covers every day.
 */
const modeForRange = (from: string | undefined, meta: { valid_times?: string[] } | undefined) => {
	const first = meta?.valid_times?.[0];
	if (!from || !first) return 'satellite' as ReplayMode;
	return from >= isoDayOf(new Date(first))
		? ('forecast' as ReplayMode)
		: ('satellite' as ReplayMode);
};

/** Mirror the range into the address bar, so a replay can be linked. */
const syncReplayUrl = (): void => {
	if (!browser) return;
	const url = new URL(window.location.href);
	const params = replayUrlParams({
		open: get(replayOpen),
		from: get(replayFrom),
		to: get(replayTo),
		step: get(replayStep)
	});

	for (const key of [REPLAY_URL_FROM, REPLAY_URL_TO, REPLAY_URL_STEP]) {
		const value = params[key];
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
	}

	const next = `${url.pathname}${url.search}${url.hash}`;
	const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
	if (next !== current) window.history.replaceState(window.history.state, '', next);
};

const clearTimer = (): void => {
	if (timer) clearTimeout(timer);
	timer = undefined;
};

/** Draw one frame: satellite day or forecast step, through the owning store. */
const applyReplayFrame = async (index: number): Promise<void> => {
	const frames = get(replayFrames);
	const frame = frames[index];
	if (!frame) return;
	replayIndex.set(index);

	if (get(replayMode) === 'satellite') {
		// `setGibsDate` resolves the day against the layer's archive and moves the
		// clock and the URL with it, so a paused replay always shows a real day.
		setGibsDate(frame, false);
		const nextFrame = frames[index + 1] ?? (get(replayLoop) ? frames[0] : undefined);
		preloadGibsDay(nextFrame);
		return;
	}

	if (get(gibsBrowse)) exitGibsBrowse();
	const date = parseISOWithoutTimezone(frame);
	time.set(date);
	await updateUrl('time', formatISOWithoutTimezone(date));
	changeOMfileURL();
};

/** One tick of the playback clock; chains itself while playing. */
const advance = async (): Promise<void> => {
	if (!get(replayPlaying)) return;
	const frames = get(replayFrames);
	if (!frames.length) return pauseReplay();

	let next = get(replayIndex) + 1;
	if (next >= frames.length) {
		if (!get(replayLoop)) return pauseReplay();
		next = 0;
	}

	await applyReplayFrame(next);
	if (get(replayPlaying)) {
		timer = setTimeout(() => void advance(), replayIntervalMs(get(replaySpeed)));
	}
};

const schedule = (): void => {
	clearTimer();
	timer = setTimeout(() => void advance(), replayIntervalMs(get(replaySpeed)));
};

/** Start playing the current range from whatever the map is showing. */
export const playReplay = async (): Promise<void> => {
	if (get(replayPlaying)) return;

	if (get(replayMode) === 'satellite') {
		// Entering takes care of availability, the clock and the URL, and switches
		// the map over to the imagery.
		await enterGibsBrowse();
		if (get(replayMode) !== 'satellite') return; // mode changed meanwhile
	} else if (get(gibsBrowse)) {
		exitGibsBrowse();
	}

	refreshReplayFrames();
	const frames = get(replayFrames);
	if (frames.length < 2) {
		toast.info('Nothing to replay in this range — pick a wider one or another layer.', {
			id: 'replay-empty'
		});
		return;
	}

	const current =
		get(replayMode) === 'satellite'
			? get(gibsResolvedDate)
			: formatISOWithoutTimezone(get(time)).slice(0, 15);
	replayIndex.set(frameIndexFor(frames, current));

	replayPlaying.set(true);
	await applyReplayFrame(get(replayIndex));
	if (get(replayPlaying)) schedule();
};

export const pauseReplay = (): void => {
	replayPlaying.set(false);
	clearTimer();
};

export const toggleReplay = (): void => {
	if (get(replayPlaying)) pauseReplay();
	else void playReplay();
};

/** Step one frame by hand (the transport's ⏮ / ⏭ and the keyboard). */
export const stepReplay = (delta: number): void => {
	pauseReplay();
	const frames = get(replayFrames);
	if (!frames.length) refreshReplayFrames();
	const count = get(replayFrames).length;
	if (!count) return;
	const next = (((get(replayIndex) + delta) % count) + count) % count;
	void applyReplayFrame(next);
};

/** Set the range by hand: the from/to inputs, the step select, a shared link. */
export const setReplayRange = (range: {
	from?: string;
	to?: string;
	step?: ReplayStep;
	mode?: ReplayMode;
	presetId?: string;
}): void => {
	if (range.from !== undefined) replayFrom.set(range.from);
	if (range.to !== undefined) replayTo.set(range.to);
	if (range.step) replayStep.set(range.step);
	if (range.mode) replayMode.set(range.mode);
	replayPresetId.set(range.presetId);
	refreshReplayFrames();
	syncReplayUrl();
};

/** Apply one of the presets (last week, last 30 days, monsoon, whole archive…). */
export const applyReplayPreset = (preset: ReplayPreset): void => {
	pauseReplay();
	setReplayRange({
		from: preset.from,
		to: preset.to,
		step: preset.step,
		mode: preset.mode,
		presetId: preset.id
	});
};

export const toggleReplayOpen = (): void => {
	const open = !get(replayOpen);
	replayOpen.set(open);
	if (!open) pauseReplay();
	refreshReplayFrames();
	syncReplayUrl();
};

/** Summary line for the bar: frames and how long the pass takes. */
export const replaySummary = derived(
	[replayFrames, replaySpeed, replayStep],
	([$frames, $speed, $step]) => {
		if (!$frames.length) return 'No frames in this range';
		const seconds = Math.round(($frames.length * replayIntervalMs($speed)) / 1000);
		const duration = seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
		const every = stepLabel($step);
		return `${$frames.length} frames · every ${every} · ≈ ${duration}`;
	}
);

/**
 * Restore a shared replay range, and keep the frame list in step with the data
 * it is built from (a late availability load, a layer switch, a domain change).
 */
export const initReplayState = (): void => {
	if (!browser) return;
	const { from, to, step } = parseReplayUrl(window.location.search);
	if (from || to || step) {
		replayOpen.set(true);
		if (from) replayFrom.set(from);
		if (to) replayTo.set(to);
		if (step) replayStep.set(step);
		// A range that reaches past the forecast window is the satellite archive.
		replayMode.set(modeForRange(from, get(metaJson)));
		refreshReplayFrames();
	}

	gibsAvailability.subscribe(() => {
		if (get(replayOpen)) refreshReplayFrames();
	});
	gibsLayerId.subscribe((layerId) => {
		// A 16-day or monthly composite cannot move a day at a time; fall back to
		// the cadence it does have instead of offering a step that repeats frames.
		const layer = gibsLayerById(layerId);
		if (layer && !stepsForLayer(layer).includes(get(replayStep))) {
			replayStep.set(stepsForLayer(layer)[0]);
			return; // the step subscription below rebuilds the frames
		}
		if (get(replayOpen)) refreshReplayFrames();
	});
	metaJson.subscribe(() => {
		if (!get(replayOpen)) return;
		// A range typed by hand can now be told apart: inside the loaded run it is
		// a forecast replay, older than the run it is the satellite archive. A
		// preset already knows its own mode.
		if (!get(replayPresetId)) replayMode.set(modeForRange(get(replayFrom), get(metaJson)));
		refreshReplayFrames();
	});
	replayStep.subscribe(() => {
		if (get(replayOpen)) refreshReplayFrames();
	});
};
