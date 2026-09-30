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

	import { gibsAvailability, gibsLatestDate, gibsLayerId } from '$lib/stores/gibs';
	import {
		applyReplayPreset,
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
	import { gibsLayerById } from '$lib/gibs';
	import { gibsImagery } from '$lib/gibs-layers';
	import { REPLAY_STEPS, formatReplayDay, isHourlyStep } from '$lib/replay';

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

	const speeds = [0.5, 1, 2];

	const onFrom = (value: string): void => setReplayRange({ from: value });
	const onTo = (value: string): void => setReplayRange({ to: value });
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
	<div
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
			<label class="flex items-center gap-1">
				<span class="opacity-70">From</span>
				<input
					type="date"
					class="h-6 rounded border bg-transparent px-1"
					min={minDay}
					max={$replayTo ?? $gibsLatestDate ?? undefined}
					value={$replayFrom ?? ''}
					onchange={(event) => onFrom(event.currentTarget.value)}
				/>
			</label>
			<label class="flex items-center gap-1">
				<span class="opacity-70">to</span>
				<input
					type="date"
					class="h-6 rounded border bg-transparent px-1"
					min={$replayFrom ?? minDay}
					max={$gibsLatestDate}
					value={$replayTo ?? ''}
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
					{#each REPLAY_STEPS as step (step.value)}
						<option
							value={step.value}
							disabled={$replayMode === 'satellite' && isHourlyStep(step.value)}
						>
							{step.label}
						</option>
					{/each}
				</select>
			</label>
			<span class="opacity-70">{$replaySummary}</span>
			{#if $replayMode === 'satellite' && $replayFrom && $replayTo}
				<span class="hidden opacity-60 sm:inline">
					{formatReplayDay($replayFrom)} → {formatReplayDay($replayTo)}
				</span>
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
			<span class="ml-auto hidden opacity-60 md:inline"
				>Space = play/pause · , and . = one frame</span
			>
		</div>
	</div>
{/if}
