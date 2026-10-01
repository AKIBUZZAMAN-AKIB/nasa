<script lang="ts">
	/**
	 * The satellite day picker the bottom timeline switches into once the
	 * forecast archive runs out.
	 *
	 * It is not a separate tool: it fills the same slot as the hour strip, in
	 * the same glass container, so the timeline stays the one place that says
	 * which moment is on the map. What it shows is the day GIBS actually has,
	 * next to the day that was asked for, so the clock can never claim a date
	 * the imagery is not from.
	 *
	 * The archive is far too long for a strip of days, so deep jumps use the
	 * date input and the slider across the layer's whole record, with the
	 * availability ribbon underneath marking the days that exist.
	 */
	import { get } from 'svelte/store';

	import { ChevronsRight, Copy, ExternalLink, Info, SkipForward } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	import {
		exitGibsBrowse,
		gibsAvailability,
		gibsLatestDate,
		gibsLayerId,
		gibsOpacity,
		gibsRequestedDate,
		gibsRequestedTime,
		gibsResolvedDate,
		gibsResolvedTime,
		goToLatestGibs,
		selectGibsLayer,
		setGibsDate,
		setGibsTimeOfDay
	} from '$lib/stores/gibs';
	import { map } from '$lib/stores/map';
	import { replayFrom, replayOpen, replayTo, setReplayRange } from '$lib/stores/replay';

	import RangeBrush from '$lib/components/time/range-brush.svelte';

	import {
		GIBS_CATEGORIES,
		GIBS_LAYERS,
		describeCoverage,
		formatGibsDay,
		formatGibsTimestamp,
		gibsLayerById,
		gibsLayersByCategory,
		gibsRibbonFraction,
		gibsRibbonSegments,
		gibsTileUrl,
		gibsWorldviewUrl,
		shiftGibsTimestamp
	} from '$lib/gibs';
	import { gibsDatasetLabel, gibsDatasetOf, gibsDatasetSearchUrl } from '$lib/gibs-datasets';

	/** The timeline's own "jump to now", so leaving keeps its resolution rules. */
	let { onBackToForecast }: { onBackToForecast: () => void } = $props();

	const layer = $derived(gibsLayerById($gibsLayerId) ?? GIBS_LAYERS[0]);
	const availability = $derived($gibsAvailability);
	const earliest = $derived(availability.ranges[0]?.start);
	const latest = $derived($gibsLatestDate);
	const dataset = $derived(gibsDatasetOf(layer.id));
	/** Availability spans, drawn as the rail's texture by the brush. */
	const segments = $derived(
		earliest && latest ? gibsRibbonSegments(availability.ranges, earliest, latest) : []
	);
	const marker = $derived(
		earliest && latest && $gibsResolvedDate
			? gibsRibbonFraction($gibsResolvedDate, earliest, latest)
			: undefined
	);
	const timeAware = $derived(layer.period === 'PT30M');
	/** Requested frame GIBS cannot serve, so a neighbour is drawn instead. */
	const awayFromRequest = $derived(
		timeAware
			? !!$gibsRequestedTime && !!$gibsResolvedTime && $gibsRequestedTime !== $gibsResolvedTime
			: !!$gibsRequestedDate && !!$gibsResolvedDate && $gibsRequestedDate !== $gibsResolvedDate
	);
	const cadence = $derived(
		layer.period === 'PT30M'
			? '30-minute rate'
			: layer.period === 'P1M'
				? 'monthly composite'
				: layer.period === 'P16D'
					? '16-day composite'
					: 'daily'
	);

	let detailsOpen = $state(false);

	const backToForecast = (): void => {
		exitGibsBrowse();
		onBackToForecast();
	};

	const midpointLabel = (timestamp?: string): string | undefined => {
		if (!timestamp) return undefined;
		const midpoint = shiftGibsTimestamp(timestamp, 15);
		return midpoint ? formatGibsTimestamp(midpoint) : undefined;
	};

	const copyTileUrl = (): void => {
		const frame = $gibsResolvedTime ?? $gibsResolvedDate;
		if (!frame) return;
		// The template keeps its {z}/{y}/{x} placeholders: paste it into QGIS,
		// Leaflet or any other WMTS/XYZ client and it works as-is.
		void navigator.clipboard
			.writeText(gibsTileUrl(layer, frame))
			.then(() => toast.success('Tile URL copied'))
			.catch(() => toast.error('Could not copy the tile URL'));
	};

	const openWorldview = (): void => {
		const day = $gibsResolvedDate;
		if (!day) return;
		const bounds = get(map)?.getBounds();
		const view = bounds
			? ([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] as [
					number,
					number,
					number,
					number
				])
			: undefined;
		window.open(gibsWorldviewUrl(layer, day, view), '_blank', 'noopener');
	};
</script>

<div class="flex flex-col gap-1 px-12 py-1.5 text-[0.7rem] md:px-3 md:py-1">
	<!-- What is on screen, and how to leave -->
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<span class="font-semibold whitespace-nowrap">NASA GIBS</span>
		<select
			class="min-w-0 max-w-72 flex-1 rounded border bg-transparent px-1 py-0.5 text-[0.7rem]"
			value={$gibsLayerId}
			onchange={(event) => selectGibsLayer(event.currentTarget.value)}
			aria-label="Satellite layer"
		>
			{#each GIBS_CATEGORIES as category (category.id)}
				<optgroup label={category.label}>
					{#each gibsLayersByCategory(category.id) as option (option.id)}
						<option value={option.id}>
							{option.title} — {option.subtitle} ({option.resolution})
						</option>
					{/each}
				</optgroup>
			{/each}
		</select>
		<span class="rounded bg-black/5 px-1.5 py-0.5 whitespace-nowrap dark:bg-white/10">
			{layer.resolution} · {cadence}{timeAware ? ' (UTC)' : ''}
		</span>
		{#if dataset}
			<a
				class="hidden rounded bg-black/5 px-1.5 py-0.5 underline-offset-2 hover:underline md:inline dark:bg-white/10"
				href={gibsDatasetSearchUrl(dataset.cmrId)}
				target="_blank"
				rel="noopener"
				title={`${gibsDatasetLabel(dataset)} · ${dataset.center ?? 'NASA'} · open the citable dataset`}
			>
				{gibsDatasetLabel(dataset)}
			</a>
		{/if}
		<button
			class="ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-black/10 dark:hover:bg-white/15"
			onclick={() => (detailsOpen = !detailsOpen)}
			aria-expanded={detailsOpen}
			aria-label="Satellite layer details"
		>
			<Info size={12} /> Details
		</button>
		<button
			class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 whitespace-nowrap hover:bg-black/10 dark:hover:bg-white/15"
			onclick={backToForecast}
			title="Leave satellite history and return to the forecast"
		>
			<ChevronsRight size={12} /> Forecast
		</button>
	</div>

	<!-- The day itself -->
	<div class="flex items-center gap-2">
		<input
			type="date"
			class="h-7 shrink-0 rounded border bg-transparent px-1.5 text-xs"
			min={earliest}
			max={latest}
			value={$gibsResolvedDate ?? ''}
			onchange={(event) => setGibsDate(event.currentTarget.value)}
			aria-label="Satellite day"
		/>
		{#if timeAware}
			<label
				class="flex shrink-0 items-center gap-1"
				title="IMERG timestamps are UTC period starts"
			>
				<input
					type="time"
					step="1800"
					class="h-7 w-24 rounded border bg-transparent px-1.5 text-xs"
					value={$gibsResolvedTime?.slice(11, 16) ?? ''}
					onchange={(event) => setGibsTimeOfDay(event.currentTarget.value)}
					aria-label="UTC frame time"
				/>
				<span class="text-[0.65rem] opacity-70">UTC</span>
			</label>
		{/if}
		<button
			class="inline-flex h-7 shrink-0 items-center gap-1 rounded border px-1.5 hover:bg-black/10 dark:hover:bg-white/15"
			onclick={() => void goToLatestGibs()}
			title={timeAware ? 'Most recent published UTC frame' : 'Most recent day with imagery'}
		>
			<SkipForward size={12} /> Latest
		</button>
		<div class="min-w-24 flex-1">
			<!-- One rail for the archive: the record's published spans, the day on
			     screen, and — while a replay is being set up — its interval. -->
			<RangeBrush
				min={earliest ?? layer.coverageStart}
				max={latest ?? layer.coverageStart}
				from={$replayOpen ? $replayFrom : undefined}
				to={$replayOpen ? $replayTo : undefined}
				{marker}
				{segments}
				onchange={(nextFrom, nextTo) => setReplayRange({ from: nextFrom, to: nextTo })}
				onseek={(day) => setGibsDate(day)}
			/>
		</div>
	</div>

	<!-- The accurate readout: what is drawn, and what was asked for -->
	<p class="leading-tight">
		{#if availability.status === 'loading'}
			<span class="opacity-70">Checking which {timeAware ? 'frames' : 'days'} this layer has…</span>
		{:else if availability.status === 'error'}
			<span class="text-red-700 dark:text-red-300">
				Could not read the GIBS availability list ({availability.error}) — the {timeAware
					? 'frame'
					: 'day'} cannot be verified, so nothing is drawn.
			</span>
		{:else}
			Showing
			<span class="font-medium">
				{#if timeAware && $gibsResolvedTime}
					{formatGibsTimestamp($gibsResolvedTime)}
				{:else if $gibsResolvedDate}
					{formatGibsDay($gibsResolvedDate)}
				{:else}
					—
				{/if}
			</span>
			{#if timeAware && $gibsResolvedTime}
				<span class="opacity-70">
					· period start; nominal estimate midpoint {midpointLabel($gibsResolvedTime)}
				</span>
			{/if}
			{#if awayFromRequest && timeAware}
				<span class="opacity-70"
					>(nearest published frame to {formatGibsTimestamp($gibsRequestedTime ?? '')})</span
				>
			{:else if awayFromRequest}
				<span class="opacity-70"
					>(nearest day to {$gibsRequestedDate} — this layer has no imagery then)</span
				>
			{/if}
			{#if $replayOpen}
				<span class="opacity-70">· drag the two handles on the rail to set the replay interval</span
				>
			{:else if availability.status === 'ready'}
				<span class="hidden opacity-70 sm:inline">· {describeCoverage(availability.ranges)}</span>
			{/if}
		{/if}
	</p>

	{#if detailsOpen}
		<div class="space-y-2 border-t pt-1.5">
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				{#if dataset}
					<a
						class="rounded bg-black/5 px-1.5 py-0.5 underline-offset-2 hover:underline dark:bg-white/10"
						href={gibsDatasetSearchUrl(dataset.cmrId)}
						target="_blank"
						rel="noopener"
					>
						Dataset: {gibsDatasetLabel(dataset)} ({dataset.type ?? 'NASA'})
					</a>
				{/if}
				<button
					class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-black/10 dark:hover:bg-white/15"
					onclick={openWorldview}
				>
					<ExternalLink size={12} /> NASA Worldview
				</button>
				<button
					class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-black/10 dark:hover:bg-white/15"
					onclick={copyTileUrl}
				>
					<Copy size={12} /> Copy tile URL
				</button>
				<label class="inline-flex items-center gap-1.5">
					<span class="opacity-70">Opacity</span>
					<input
						type="range"
						class="h-1 w-24 accent-sky-500"
						min="10"
						max="100"
						value={$gibsOpacity}
						oninput={(event) => gibsOpacity.set(Number(event.currentTarget.value))}
						aria-label="Imagery opacity"
					/>
					<span class="w-8">{$gibsOpacity}%</span>
				</label>
			</div>
			{#if layer.legend}
				<img
					src={layer.legend}
					alt={`Colour bar for ${layer.title}`}
					class="max-h-10 w-full rounded object-contain"
					loading="lazy"
				/>
			{/if}
			{#if layer.note}
				<p class="leading-tight opacity-70">{layer.note}</p>
			{/if}
			<p class="leading-tight opacity-60">
				Imagery from
				<a href="https://gibs.earthdata.nasa.gov" class="underline" rel="noreferrer" target="_blank"
					>NASA GIBS / EOSDIS</a
				>, free and without a key. This layer's record starts {layer.coverageStart}; the address bar
				carries the layer and exact frame time when this layer needs it, so the view can be shared
				as a link.
			</p>
		</div>
	{/if}
</div>
