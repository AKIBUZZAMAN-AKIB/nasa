<script lang="ts">
	/**
	 * Replay controls for the timeline: pick an interval (a preset or a range
	 * with its own cadence), then let the archive play.
	 *
	 * It lives in the same glass container as the hour strip rather than in a
	 * panel of its own, because a replay is still "the timeline": the strip keeps
	 * showing where you are, the transport moves it, and the range is what the
	 * strip is scrubbing through.
	 */
	import { Pause, Play, Repeat, SkipBack, SkipForward, X } from '@lucide/svelte';

	import { gibsAvailability, gibsLatestDate, gibsLatestTime, gibsLayerId } from '$lib/stores/gibs';
	import {
		applyReplayPreset,
		replayFrameLimitExceeded,
		replayFrames,
		replayFrom,
		replayIndex,
		replayLoop,
		replayMode,
		replayOpen,
		replayPlaying,
		replayPresetId,
		replayPresetList,
		replaySpeed,
		replayStep,
		replaySummary,
		replayTo,
		setReplayRange,
		stepReplay,
		toggleReplay,
		toggleReplayOpen
	} from '$lib/stores/replay';

	import { MILLISECONDS_PER_WEEK } from '$lib/constants';
	import {
		gibsLayerById,
		gibsLayerCanRender,
		gibsPeriodMilliseconds,
		isSubdailyGibsLayer
	} from '$lib/gibs';
	import { gibsImagery } from '$lib/gibs-layers';
	import {
		MAX_SUBDAILY_REPLAY_FRAMES,
		REPLAY_STEPS,
		formatReplayDay,
		stepLabelForLayer,
		stepsForLayer
	} from '$lib/replay';

	const availability = $derived($gibsAvailability);
	const layer = $derived(gibsLayerById($gibsLayerId));
	/** Oldest day the forecast keeps, so the inputs cannot ask for a dead day. */
	const forecastStart = $derived(
		new Date(Date.now() - MILLISECONDS_PER_WEEK).toISOString().slice(0, 10)
	);
	const minDay = $derived(
		$replayMode === 'satellite'
			? (availability.ranges[0]?.start ?? layer?.coverageStart)
			: forecastStart
	);
	const timeAware = $derived($replayMode === 'satellite' && isSubdailyGibsLayer(layer));
	const archivePlaybackBlocked = $derived(
		$replayMode === 'satellite' &&
			!!layer &&
			(layer.period === 'static' || !gibsLayerCanRender(layer))
	);
	const timeStepSeconds = $derived(
		Math.max(1, Math.round((gibsPeriodMilliseconds(layer?.period) ?? 30 * 60_000) / 1000))
	);
	const availableSteps = $derived(
		$replayMode === 'satellite' && layer
			? REPLAY_STEPS.filter((step) => stepsForLayer(layer).includes(step.value))
			: REPLAY_STEPS.filter((step) => step.value !== '30m')
	);

	/** datetime-local fields use the browser's local zone; replay keys stay UTC. */
	const toLocalInput = (value?: string): string => {
		if (!value) return '';
		const date = new Date(value);
		if (!Number.isFinite(date.getTime())) return '';
		const precision = timeAware && timeStepSeconds % 60 !== 0 ? 19 : 16;
		return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
			.toISOString()
			.slice(0, precision);
	};
	const fromLocalInput = (value: string): string | undefined => {
		if (!value) return undefined;
		const date = new Date(value);
		return Number.isFinite(date.getTime()) ? date.toISOString().replace('.000Z', 'Z') : undefined;
	};
	const timestampBound = (value?: string, endOfDay = false): string | undefined => {
		if (!value) return undefined;
		if (value.includes('T')) return value;
		// A date-only endpoint spans the whole UTC day; exact layer cadence is
		// snapped later against the compact DescribeDomains time ranges.
		return `${value}T${endOfDay ? '23:59:59' : '00:00:00'}Z`;
	};
	const rangeInputValue = (value?: string, endOfDay = false): string =>
		timeAware ? toLocalInput(timestampBound(value, endOfDay)) : (value?.slice(0, 10) ?? '');
	const rangeInputBound = (value?: string, endOfDay = false): string | undefined =>
		timeAware
			? value
				? toLocalInput(timestampBound(value, endOfDay))
				: undefined
			: value?.slice(0, 10);

	const speeds = [0.5, 1, 2];

	const onFrom = (value: string): void =>
		setReplayRange({ from: timeAware ? fromLocalInput(value) : value || undefined });
	const onTo = (value: string): void =>
		setReplayRange({ to: timeAware ? fromLocalInput(value) : value || undefined });
	const onStep = (value: string): void =>
		setReplayRange({ step: value as (typeof REPLAY_STEPS)[number]['value'] });
</script>

<!-- Toggle chip: sits on the container's top edge, opposite the model-run row -->
<button
	class="absolute -top-4.5 left-12 z-10 flex h-4.5 items-center gap-1 rounded-t-lg bg-glass/65 px-2 text-xs backdrop-blur-sm hover:bg-accent/50 md:left-0 {$replayOpen
		? 'text-sky-600 dark:text-sky-400'
		: ''}"
	onclick={toggleReplayOpen}
	aria-expanded={$replayOpen}
	title="Replay the archive: pick a range and interval, then play it"
>
	<Play size={11} /> Replay
</button>

{#if $replayOpen}
	<!-- data-credit-blocker: attribution.ts keeps the map credits above this bar -->
	<div
		data-credit-blocker
		class="absolute bottom-full left-1/2 z-50 mb-2 w-[min(94vw,52rem)] -translate-x-1/2 space-y-1.5 rounded-lg bg-glass/90 p-2 text-[0.7rem] shadow-lg backdrop-blur-md"
	>
		<!-- Interval -->
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
			<span class="font-semibold whitespace-nowrap">Interval</span>
			{#each $replayPresetList as preset (preset.id)}
				<button
					class="rounded border px-1.5 py-0.5 hover:bg-black/10 dark:hover:bg-white/15 {$replayPresetId ===
					preset.id
						? 'border-sky-500 bg-sky-500/15'
						: ''}"
					title={preset.hint}
					onclick={() => applyReplayPreset(preset)}
				>
					📌 {preset.label}
				</button>
			{/each}
			<span class="ml-auto flex items-center gap-1">
				<span class="opacity-70">Mode</span>
				<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
					{$replayMode === 'satellite' ? 'satellite archive' : 'forecast run'}
				</span>
			</span>
			{#if archivePlaybackBlocked}
				<span
					class="basis-full rounded bg-amber-500/10 px-2 py-1 text-amber-900 dark:text-amber-100"
				>
					{#if layer?.period === 'static'}
						This layer is timeless and has no satellite frames to replay.
					{:else}
						This polar-only layer cannot be replayed on the Web Mercator map.
					{/if}
					Choose a different GIBS layer or one of the forecast presets.
				</span>
			{/if}
			<button
				class="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/15"
				onclick={toggleReplayOpen}
				aria-label="Close replay"
			>
				<X size={13} />
			</button>
		</div>

		<!-- Range and cadence, edited by hand -->
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
			{#if archivePlaybackBlocked}
				<span class="opacity-70">
					Satellite playback is unavailable for this selection; choose a compatible temporal layer
					or apply a forecast preset.
				</span>
			{:else}
				<label class="flex items-center gap-1">
					<span class="opacity-70">From{timeAware ? ' (local)' : ''}</span>
					<input
						type={timeAware ? 'datetime-local' : 'date'}
						step={timeAware ? timeStepSeconds : undefined}
						class="h-6 rounded border bg-transparent px-1"
						min={rangeInputBound(timeAware ? availability.timeRanges[0]?.start : minDay)}
						max={rangeInputBound(
							timeAware ? ($replayTo ?? $gibsLatestTime) : ($replayTo ?? $gibsLatestDate),
							true
						)}
						value={rangeInputValue($replayFrom)}
						onchange={(event) => onFrom(event.currentTarget.value)}
					/>
				</label>
				<label class="flex items-center gap-1">
					<span class="opacity-70">to{timeAware ? ' (local)' : ''}</span>
					<input
						type={timeAware ? 'datetime-local' : 'date'}
						step={timeAware ? timeStepSeconds : undefined}
						class="h-6 rounded border bg-transparent px-1"
						min={rangeInputBound($replayFrom ?? minDay)}
						max={rangeInputBound(timeAware ? $gibsLatestTime : $gibsLatestDate)}
						value={rangeInputValue($replayTo, true)}
						onchange={(event) => onTo(event.currentTarget.value)}
					/>
				</label>
				<label class="flex items-center gap-1">
					<span class="opacity-70">every</span>
					<select
						class="h-6 rounded border bg-transparent px-1"
						value={$replayStep}
						onchange={(event) => onStep(event.currentTarget.value)}
					>
						{#each availableSteps as step (step.value)}
							<option value={step.value}>
								{stepLabelForLayer(step.value, $replayMode === 'satellite' ? layer : undefined)}
							</option>
						{/each}
					</select>
				</label>
				<span class="opacity-70">{$replaySummary}</span>
				{#if timeAware}
					<span class="opacity-60" title="Frame timestamps and map labels use UTC">
						Local input · frame labels in UTC
					</span>
				{/if}
				{#if $replayFrameLimitExceeded}
					<span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-800 dark:text-amber-200">
						Range exceeds {MAX_SUBDAILY_REPLAY_FRAMES.toLocaleString()} frames; choose a coarser interval
						or shorter range.
					</span>
				{/if}
				{#if $replayMode === 'satellite' && $replayFrom && $replayTo}
					<span class="hidden opacity-60 sm:inline">
						{formatReplayDay($replayFrom)} → {formatReplayDay($replayTo)}
					</span>
				{/if}
			{/if}
		</div>

		<!-- Transport -->
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-1.5">
			<button
				class="inline-flex h-6 w-6 items-center justify-center rounded border hover:bg-black/10 dark:hover:bg-white/15"
				onclick={() => stepReplay(-1)}
				aria-label="Previous frame"
				title="Previous frame"
			>
				<SkipBack size={13} />
			</button>
			<button
				class="inline-flex h-6 items-center gap-1 rounded border border-sky-500/60 bg-sky-500/15 px-1.5 hover:bg-sky-500/25"
				onclick={toggleReplay}
				aria-label={$replayPlaying ? 'Pause replay' : 'Play replay'}
				title="Play / pause (Space)"
			>
				{#if $replayPlaying}<Pause size={13} /> Pause{:else}<Play size={13} /> Play{/if}
			</button>
			<button
				class="inline-flex h-6 w-6 items-center justify-center rounded border hover:bg-black/10 dark:hover:bg-white/15"
				onclick={() => stepReplay(1)}
				aria-label="Next frame"
				title="Next frame"
			>
				<SkipForward size={13} />
			</button>

			<span class="tabular-nums opacity-80">
				{#if $replayFrames.length}
					{$replayIndex + 1} / {$replayFrames.length}
				{:else}
					—
				{/if}
			</span>

			<label class="flex items-center gap-1">
				<span class="opacity-70">Speed</span>
				<select
					class="h-6 rounded border bg-transparent px-1"
					value={String($replaySpeed)}
					onchange={(event) => replaySpeed.set(Number(event.currentTarget.value))}
				>
					{#each speeds as speed (speed)}
						<option value={String(speed)}>{speed}×</option>
					{/each}
				</select>
			</label>

			<button
				class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 {$replayLoop
					? 'border-sky-500 bg-sky-500/15'
					: ''}"
				onclick={() => replayLoop.set(!$replayLoop)}
				aria-pressed={$replayLoop}
				title="Loop the range"
			>
				<Repeat size={12} /> Loop
			</button>

			{#if $replayPlaying && $gibsImagery.status === 'loading'}
				<span
					class="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-800 dark:text-amber-200"
				>
					Buffering…
				</span>
			{/if}
			<span class="ml-auto hidden opacity-60 lg:inline">
				Playing waits for each frame, so a slow line plays slower — never out of step · Space =
				play/pause · , and . = one frame
			</span>
		</div>
	</div>
{/if}
