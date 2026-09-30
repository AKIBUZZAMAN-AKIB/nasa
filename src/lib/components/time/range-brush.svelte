<script lang="ts">
	/**
	 * One rail for the whole archive: the availability strip, the day that is on
	 * the map, and — when a replay is being set up — the range it should play.
	 *
	 * Two jobs on the same track, because they answer the same question ("which
	 * moment am I looking at?"):
	 *
	 *  • plain: click or drag anywhere to move the shown day (the marker);
	 *  • brush: drag either handle (or the band between them) to draw the
	 *    interval, while a click outside the band still moves the shown day.
	 *
	 * Both are keyboard reachable: the handles take focus and move a day at a
	 * time, a week with Shift.
	 */
	import { type GibsRibbonSegment, isoDayDiff, shiftIsoDay } from '$lib/gibs';

	let {
		min,
		max,
		from,
		to,
		marker,
		segments = [],
		onchange,
		onseek
	}: {
		/** First and last day of the archive the rail spans. */
		min: string;
		max: string;
		/** Brush edges; only drawn when both are set and `onchange` is given. */
		from?: string;
		to?: string;
		/** Where the shown day sits, 0–1. */
		marker?: number;
		/** Published spans, 0–1, painted as the rail's texture. */
		segments?: GibsRibbonSegment[];
		onchange?: (from: string, to: string) => void;
		onseek?: (day: string) => void;
	} = $props();

	const span = $derived(Math.max(1, isoDayDiff(min, max)));
	const brushable = $derived(!!onchange && !!from && !!to);

	/** 0–1 across the rail → a real day, clamped to the archive. */
	const dayAt = (fraction: number): string =>
		shiftIsoDay(min, Math.round(Math.min(1, Math.max(0, fraction)) * span));

	const positionOf = (day?: string): number =>
		day ? Math.min(1, Math.max(0, isoDayDiff(min, day) / span)) : 0;

	const fromPosition = $derived(positionOf(from));
	const toPosition = $derived(positionOf(to));

	let track: HTMLElement | undefined = $state();
	let width = $state(0);
	/** null → not dragging; otherwise what the drag is moving. */
	let drag: 'from' | 'to' | 'band' | undefined = $state();
	let dragOffset = 0;

	const fractionAt = (clientX: number): number => {
		if (!track || !width) return 0;
		const rect = track.getBoundingClientRect();
		return (clientX - rect.left) / rect.width;
	};

	const startDrag = (event: PointerEvent, what: 'from' | 'to' | 'band'): void => {
		event.preventDefault();
		// The band sits inside the track, whose click-to-seek must not fire too.
		event.stopPropagation();
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		drag = what;
		dragOffset = what === 'band' ? fractionAt(event.clientX) - fromPosition : 0;
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (!drag || !onchange) return;
		const fraction = fractionAt(event.clientX);
		if (drag === 'band') {
			// Move both edges together, keeping the width and the archive bounds.
			const width = toPosition - fromPosition;
			const start = Math.min(1 - width, Math.max(0, fraction - dragOffset));
			onchange(dayAt(start), dayAt(start + width));
			return;
		}
		const day = dayAt(fraction);
		if (drag === 'from') onchange(day > to! ? to! : day, to!);
		else onchange(from!, day < from! ? from! : day);
	};

	const endDrag = (): void => {
		drag = undefined;
	};

	const onRailPointerDown = (event: PointerEvent): void => {
		// The handles and band stop propagation themselves; reaching here means the
		// click was outside the band, which moves the shown day.
		onseek?.(dayAt(fractionAt(event.clientX)));
	};

	const onHandleKey = (event: KeyboardEvent, what: 'from' | 'to'): void => {
		if (!onchange) return;
		const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (!delta) return;
		event.preventDefault();
		const step = event.shiftKey ? 7 : 1;
		if (what === 'from') {
			const next = shiftIsoDay(from!, delta * step);
			onchange(next > to! ? to! : next < min ? min : next, to!);
		} else {
			const next = shiftIsoDay(to!, delta * step);
			onchange(from!, next < from! ? from! : next > max ? max : next);
		}
	};
</script>

<div class="relative select-none py-1">
	<div
		bind:this={track}
		bind:clientWidth={width}
		class="relative h-2 w-full cursor-pointer overflow-hidden rounded bg-black/10 dark:bg-white/10"
		role="presentation"
		onpointerdown={onRailPointerDown}
	>
		<!-- published spans: the gaps in the record are visible before playing it -->
		{#each segments as segment, index (index)}
			<span
				class="absolute inset-y-0 bg-sky-500/45"
				style={`left:${(segment.left * 100).toFixed(3)}%;width:${(segment.width * 100).toFixed(3)}%`}
			></span>
		{/each}

		<!-- the replay interval -->
		{#if brushable}
			<span
				class="absolute inset-y-0 cursor-grab bg-sky-500/35 ring-1 ring-sky-500/70 active:cursor-grabbing"
				style={`left:${(fromPosition * 100).toFixed(3)}%;width:${((toPosition - fromPosition) * 100).toFixed(3)}%`}
				onpointerdown={(event) => startDrag(event, 'band')}
				role="presentation"
			></span>
		{/if}
	</div>

	<!-- the shown day -->
	{#if marker !== undefined}
		<span
			class="pointer-events-none absolute top-0 h-4 w-[2px] -translate-x-1/2 bg-black/80 dark:bg-white"
			style={`left:${(marker * 100).toFixed(3)}%`}
			aria-hidden="true"
		></span>
	{/if}

	{#if brushable}
		<button
			class="absolute top-1/2 h-4 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-sky-600 bg-glass shadow-sm"
			style={`left:${(fromPosition * 100).toFixed(3)}%`}
			onpointerdown={(event) => startDrag(event, 'from')}
			onkeydown={(event) => onHandleKey(event, 'from')}
			aria-label={`Replay starts ${from}`}
			title="Drag the start of the replay interval (arrows move a day, shift a week)"
		></button>
		<button
			class="absolute top-1/2 h-4 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-sky-600 bg-glass shadow-sm"
			style={`left:${(toPosition * 100).toFixed(3)}%`}
			onpointerdown={(event) => startDrag(event, 'to')}
			onkeydown={(event) => onHandleKey(event, 'to')}
			aria-label={`Replay ends ${to}`}
			title="Drag the end of the replay interval (arrows move a day, shift a week)"
		></button>
	{/if}
</div>

<svelte:window onpointermove={onPointerMove} onpointerup={endDrag} />
