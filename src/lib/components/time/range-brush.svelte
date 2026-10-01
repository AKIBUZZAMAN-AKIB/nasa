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
		day ? Math.min(1, Math.max(0, isoDayDiff(min, day.slice(0, 10)) / span)) : 0;

	/** Dragging a day-wide rail keeps an exact UTC time bound, when one exists. */
	const atSameTime = (day: string, bound?: string): string =>
		bound?.includes('T') ? `${day}${bound.slice(10)}` : day;

	const fromPosition = $derived(positionOf(from));
	const toPosition = $derived(positionOf(to));

	let track: HTMLElement | undefined = $state();
	let width = $state(0);
	/** null → not dragging; otherwise what the drag is moving. */
	let drag: 'from' | 'to' | 'band' | 'seek' | undefined = $state();
	let dragOffset = 0;
	/** Interval width captured when a band drag starts, so it cannot drift. */
	let bandWidth = 0;

	const fractionAt = (clientX: number): number => {
		if (!track || !width) return 0;
		const rect = track.getBoundingClientRect();
		return (clientX - rect.left) / rect.width;
	};

	const startDrag = (event: PointerEvent, what: 'from' | 'to' | 'band' | 'seek'): void => {
		event.preventDefault();
		// The band sits inside the track, whose own pointerdown must not also fire.
		event.stopPropagation();
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		drag = what;
		if (what === 'band') {
			dragOffset = fractionAt(event.clientX) - fromPosition;
			bandWidth = toPosition - fromPosition;
		}
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (!drag) return;
		const fraction = fractionAt(event.clientX);

		// Dragging the bare rail scrubs the shown day, the way the slider used to.
		if (drag === 'seek') {
			onseek?.(dayAt(fraction));
			return;
		}
		if (!onchange) return;

		if (drag === 'band') {
			// Move both edges together, keeping the width and the archive bounds.
			const start = Math.min(1 - bandWidth, Math.max(0, fraction - dragOffset));
			onchange(atSameTime(dayAt(start), from), atSameTime(dayAt(start + bandWidth), to));
			return;
		}
		const day = dayAt(fraction);
		const fromDay = from!.slice(0, 10);
		const toDay = to!.slice(0, 10);
		if (drag === 'from') onchange(atSameTime(day > toDay ? toDay : day, from), to!);
		else onchange(from!, atSameTime(day < fromDay ? fromDay : day, to));
	};

	const endDrag = (): void => {
		drag = undefined;
	};

	const onRailPointerDown = (event: PointerEvent): void => {
		// The handles and the band stop propagation themselves; reaching here means
		// the press landed outside the interval, which moves the shown day — and
		// keeps moving it while the pointer stays down.
		startDrag(event, 'seek');
		onseek?.(dayAt(fractionAt(event.clientX)));
	};

	const onHandleKey = (event: KeyboardEvent, what: 'from' | 'to'): void => {
		if (!onchange) return;
		const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (!delta) return;
		event.preventDefault();
		const step = event.shiftKey ? 7 : 1;
		if (what === 'from') {
			const next = shiftIsoDay(from!.slice(0, 10), delta * step);
			const clamped = next > to!.slice(0, 10) ? to!.slice(0, 10) : next < min ? min : next;
			onchange(atSameTime(clamped, from), to!);
		} else {
			const next = shiftIsoDay(to!.slice(0, 10), delta * step);
			const clamped = next < from!.slice(0, 10) ? from!.slice(0, 10) : next > max ? max : next;
			onchange(from!, atSameTime(clamped, to));
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
