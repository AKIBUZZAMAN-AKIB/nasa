<script lang="ts">
	/**
	 * Satellite history panel: picks a NASA GIBS layer and a date, and drives
	 * the imagery layer on the map. Everything the user can change lives in
	 * `$lib/stores/gibs`, so the map wiring reacts without this component
	 * touching MapLibre directly.
	 */
	import { get } from 'svelte/store';

	import { ChevronLeft, ChevronRight, Copy, ExternalLink, SkipForward, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	import {
		gibsAvailability,
		gibsEnabled,
		gibsLatestDate,
		gibsLayerId,
		gibsOpacity,
		gibsPanelOpen,
		gibsRequestedDate,
		gibsResolvedDate,
		goToLatestGibs,
		selectGibsLayer,
		setGibsDate,
		setGibsEnabled,
		shiftGibsDate,
		toggleGibsPanel
	} from '$lib/stores/gibs';
	import { map } from '$lib/stores/map';

	import {
		GIBS_CATEGORIES,
		GIBS_LAYERS,
		describeCoverage,
		formatGibsDay,
		gibsLayerById,
		gibsLayersByCategory,
		gibsRibbonFraction,
		gibsRibbonSegments,
		gibsTileUrl,
		gibsWorldviewUrl,
		isoDayDiff,
		shiftIsoDay
	} from '$lib/gibs';
	import { gibsDatasetLabel, gibsDatasetOf, gibsDatasetSearchUrl } from '$lib/gibs-datasets';

	const layer = $derived(gibsLayerById($gibsLayerId) ?? GIBS_LAYERS[0]);
	const availability = $derived($gibsAvailability);
	const earliest = $derived(availability.ranges[0]?.start);
	const latest = $derived($gibsLatestDate);
	/** Days the << / >> buttons move, matching the layer's own cadence. */
	const step = $derived(layer.period === 'P1M' ? 30 : layer.period === 'P16D' ? 16 : 1);
	const spanDays = $derived(earliest && latest ? Math.max(1, isoDayDiff(earliest, latest)) : 1);
	const sliderValue = $derived(
		earliest && $gibsResolvedDate ? Math.max(0, isoDayDiff(earliest, $gibsResolvedDate)) : 0
	);
	/** Citable CMR record behind the layer, for the dataset chip. */
	const dataset = $derived(gibsDatasetOf(layer.id));
	/** Coverage strip: published spans, plus where the shown day sits on them. */
	const ribbon = $derived(
		earliest && latest ? gibsRibbonSegments(availability.ranges, earliest, latest) : []
	);
	const marker = $derived(
		earliest && latest && $gibsResolvedDate
			? gibsRibbonFraction($gibsResolvedDate, earliest, latest)
			: undefined
	);
	/** Requested day that GIBS could not serve, so a neighbour is shown instead. */
	const awayFromRequest = $derived(
		!!$gibsRequestedDate && !!$gibsResolvedDate && $gibsRequestedDate !== $gibsResolvedDate
	);

	const onSlider = (value: number): void => {
		if (earliest) setGibsDate(shiftIsoDay(earliest, value));
	};

	const copyTileUrl = (): void => {
		const day = $gibsResolvedDate ?? latest;
		if (!day) return;
		// The template keeps its {z}/{y}/{x} placeholders: paste it into QGIS,
		// Leaflet or any other WMTS/XYZ client and it works as-is.
		const url = gibsTileUrl(layer, day);
		void navigator.clipboard
			.writeText(url)
			.then(() => toast.success('Tile URL copied'))
			.catch(() => toast.error('Could not copy the tile URL'));
	};

	const openWorldview = (): void => {
		const day = $gibsResolvedDate ?? latest;
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

{#if $gibsPanelOpen}
	<aside
		class="absolute bottom-32 left-2.5 z-10 flex max-h-[60dvh] w-[min(92vw,23rem)] flex-col overflow-hidden rounded-lg bg-glass/90 shadow-lg backdrop-blur-md md:bottom-20"
	>
		<header class="flex items-center justify-between border-b px-3 py-2">
			<div class="min-w-0">
				<h2 class="text-sm font-semibold">Satellite history</h2>
				<p class="truncate text-[0.7rem] opacity-70">NASA GIBS archive · no API key</p>
			</div>
			<button
				onclick={toggleGibsPanel}
				class="shrink-0 rounded p-1 hover:bg-black/10 dark:hover:bg-white/15"
				aria-label="Close satellite history"
			>
				<X size={16} />
			</button>
		</header>

		<div class="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
			<label class="block">
				<span class="text-[0.7rem] opacity-70">Layer</span>
				<select
					class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
					value={$gibsLayerId}
					onchange={(event) => selectGibsLayer(event.currentTarget.value)}
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
			</label>

			<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] opacity-80">
				<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">{layer.resolution}</span>
				{#if dataset}
					<a
						class="rounded bg-black/5 px-1.5 py-0.5 underline-offset-2 hover:underline dark:bg-white/10"
						href={gibsDatasetSearchUrl(dataset.cmrId)}
						target="_blank"
						rel="noopener"
						title={`${gibsDatasetLabel(dataset)} · ${dataset.center ?? 'NASA'} · open the citable dataset`}
					>
						{gibsDatasetLabel(dataset)}
					</a>
				{:else if layer.dataset}
					<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">{layer.dataset}</span>
				{/if}
				<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
					{layer.period === 'P1M' ? 'monthly' : layer.period === 'P16D' ? '16-day' : 'daily'}
				</span>
			</div>

			<div class="space-y-1.5">
				<div class="flex items-center gap-1.5">
					<button
						onclick={() => shiftGibsDate(-1)}
						class="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-black/10 dark:hover:bg-white/15"
						aria-label="Earlier"
						title={`Back ${step} day${step === 1 ? '' : 's'}`}
					>
						<ChevronLeft size={15} />
					</button>
					<input
						type="date"
						class="h-7 min-w-0 flex-1 rounded border bg-transparent px-1.5 text-xs"
						min={earliest}
						max={latest}
						value={$gibsResolvedDate ?? ''}
						onchange={(event) => setGibsDate(event.currentTarget.value)}
					/>
					<button
						onclick={() => shiftGibsDate(1)}
						class="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-black/10 dark:hover:bg-white/15"
						aria-label="Later"
						title={`Forward ${step} day${step === 1 ? '' : 's'}`}
					>
						<ChevronRight size={15} />
					</button>
					<button
						onclick={() => void goToLatestGibs()}
						class="inline-flex h-7 items-center gap-1 rounded border px-1.5 text-[0.7rem] hover:bg-black/10 dark:hover:bg-white/15"
						title="Most recent day with imagery"
					>
						<SkipForward size={13} /> Latest
					</button>
				</div>

				<input
					type="range"
					class="w-full accent-sky-500"
					min="0"
					max={spanDays}
					value={sliderValue}
					oninput={(event) => onSlider(Number(event.currentTarget.value))}
					aria-label="Date across the archived record"
				/>

				{#if availability.status === 'loading'}
					<p class="text-[0.7rem] opacity-70">Checking which days exist…</p>
				{:else if availability.status === 'error'}
					<p class="rounded bg-red-500/10 px-2 py-1 text-[0.7rem] text-red-700 dark:text-red-300">
						Could not read the GIBS availability list ({availability.error}). The layer cannot be
						drawn reliably.
					</p>
				{:else if availability.status === 'ready'}
					<p class="text-[0.7rem] leading-tight opacity-70">
						Imagery: {describeCoverage(availability.ranges)}
					</p>
					{#if ribbon.length}
						<div>
							<div
								class="relative h-2 w-full overflow-hidden rounded bg-black/10 dark:bg-white/10"
								aria-hidden="true"
							>
								{#each ribbon as segment, index (index)}
									<span
										class="absolute inset-y-0 bg-sky-500/70"
										style={`left:${(segment.left * 100).toFixed(3)}%;width:${(segment.width * 100).toFixed(3)}%`}
									></span>
								{/each}
								{#if marker !== undefined}
									<span
										class="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-black/80 dark:bg-white"
										style={`left:${(marker * 100).toFixed(3)}%`}
									></span>
								{/if}
							</div>
							<p class="mt-0.5 text-[0.65rem] leading-tight opacity-60">
								Whole archive at a glance · {ribbon.length} coverage
								{ribbon.length === 1 ? 'window' : 'windows'} — gaps are days with nothing published.
							</p>
						</div>
					{/if}
					<p class="text-[0.7rem] leading-tight">
						Showing
						<span class="font-medium"
							>{$gibsResolvedDate ? formatGibsDay($gibsResolvedDate) : '—'}</span
						>
						{#if awayFromRequest}
							<span class="opacity-70">(nearest day to {$gibsRequestedDate})</span>
						{/if}
					</p>
				{/if}
			</div>

			<label class="flex items-center gap-2 text-[0.7rem]">
				<input
					type="checkbox"
					class="accent-sky-500"
					checked={$gibsEnabled}
					onchange={(event) => setGibsEnabled(event.currentTarget.checked)}
				/>
				<span>Show imagery on the map</span>
			</label>
			{#if !$gibsEnabled}
				<p
					class="rounded bg-black/5 px-2 py-1 text-[0.7rem] leading-tight opacity-80 dark:bg-white/10"
				>
					Imagery is hidden. Tick the box to draw the satellite layer under the weather overlay.
				</p>
			{/if}

			<div class="space-y-1.5 border-t pt-2">
				<label class="flex items-center justify-between gap-2 text-[0.7rem]">
					<span class="opacity-70">Opacity</span>
					<input
						type="range"
						class="h-1 flex-1 accent-sky-500"
						min="10"
						max="100"
						value={$gibsOpacity}
						oninput={(event) => gibsOpacity.set(Number(event.currentTarget.value))}
						aria-label="Imagery opacity"
					/>
					<span class="w-8 text-right">{$gibsOpacity}%</span>
				</label>
			</div>

			{#if layer.legend}
				<div class="space-y-1 border-t pt-2">
					<p class="text-[0.7rem] opacity-70">Legend</p>
					<img
						src={layer.legend}
						alt={`Colour bar for ${layer.title}`}
						class="w-full rounded"
						loading="lazy"
					/>
				</div>
			{/if}

			{#if layer.note}
				<p class="text-[0.7rem] leading-tight opacity-70">{layer.note}</p>
			{/if}

			<div class="flex flex-wrap gap-1.5 border-t pt-2">
				<button
					onclick={openWorldview}
					class="inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[0.7rem] hover:bg-black/10 dark:hover:bg-white/15"
				>
					<ExternalLink size={12} /> Open in NASA Worldview
				</button>
				<button
					onclick={copyTileUrl}
					class="inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[0.7rem] hover:bg-black/10 dark:hover:bg-white/15"
				>
					<Copy size={12} /> Copy tile URL
				</button>
			</div>
		</div>

		<footer class="border-t px-3 py-1.5 text-[0.65rem] leading-tight opacity-60">
			Imagery from
			<a href="https://gibs.earthdata.nasa.gov" class="underline" rel="noreferrer" target="_blank"
				>NASA GIBS / EOSDIS</a
			>, free and without a key. This layer's record starts {layer.coverageStart}; the address bar
			carries the layer and the date, so the view can be shared as a link.
		</footer>
	</aside>
{/if}
