<script lang="ts">
	/**
	 * The GIBS archive controls and searchable NASA visualization catalogue.
	 * Time selections are resolved to published frames, and catalogue entries
	 * that cannot render in the map's Web Mercator projection remain discoverable
	 * but are clearly labelled rather than silently requesting invalid tiles.
	 */
	import { get } from 'svelte/store';

	import {
		Check,
		ChevronsRight,
		Copy,
		ExternalLink,
		Info,
		Search,
		SkipForward
	} from '@lucide/svelte';
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
	import * as Command from '$lib/components/ui/command';
	import * as Dialog from '$lib/components/ui/dialog';

	import {
		GIBS_CATALOG_LAYERS,
		GIBS_CATALOG_SNAPSHOT_DATE,
		GIBS_CATALOG_TOTAL,
		GIBS_CATEGORIES,
		GIBS_LAYERS,
		GIBS_WEB_MERCATOR_TOTAL,
		GIBS_WORLDVIEW_CATALOG_LAST_MODIFIED,
		type GibsCategory,
		type GibsLayerDef,
		describeCoverage,
		describeGibsPeriod,
		formatGibsDay,
		formatGibsTimestamp,
		gibsLayerById,
		gibsLayerCanRender,
		gibsPeriodMilliseconds,
		gibsRibbonFraction,
		gibsRibbonSegments,
		gibsTileUrl,
		gibsWorldviewUrl,
		isSubdailyGibsLayer,
		shiftGibsTimestamp
	} from '$lib/gibs';
	import { gibsDatasetLabel, gibsDatasetOf, gibsDatasetSearchUrl } from '$lib/gibs-datasets';

	/** The timeline's own "jump to now", so leaving keeps its resolution rules. */
	let { onBackToForecast }: { onBackToForecast: () => void } = $props();

	let catalogOpen = $state(false);
	let catalogSearch = $state('');
	let catalogMapOnly = $state(false);
	let catalogCategory = $state<GibsCategory | 'all'>('all');
	let detailsOpen = $state(false);

	const layer = $derived(gibsLayerById($gibsLayerId) ?? GIBS_CATALOG_LAYERS[0]);
	const availability = $derived($gibsAvailability);
	const earliest = $derived(availability.ranges[0]?.start);
	const latest = $derived($gibsLatestDate);
	const dataset = $derived(gibsDatasetOf(layer.id));
	const staticLayer = $derived(layer.period === 'static');
	const timeAware = $derived(isSubdailyGibsLayer(layer));
	const mapCompatible = $derived(gibsLayerCanRender(layer));
	const cadence = $derived(describeGibsPeriod(layer.period));
	const timeStepSeconds = $derived(
		Math.max(1, Math.round((gibsPeriodMilliseconds(layer.period) ?? 60_000) / 1000))
	);
	const resolvedInputTime = $derived(
		$gibsResolvedTime?.slice(11, timeStepSeconds % 60 === 0 ? 16 : 19) ?? ''
	);

	/** Availability spans, drawn as the rail's texture by the brush. */
	const segments = $derived(
		earliest && latest ? gibsRibbonSegments(availability.ranges, earliest, latest) : []
	);
	const marker = $derived(
		earliest && latest && $gibsResolvedDate
			? gibsRibbonFraction($gibsResolvedDate, earliest, latest)
			: undefined
	);
	/** Requested frame GIBS cannot serve, so a neighbour is drawn instead. */
	const awayFromRequest = $derived(
		timeAware
			? !!$gibsRequestedTime && !!$gibsResolvedTime && $gibsRequestedTime !== $gibsResolvedTime
			: !!$gibsRequestedDate && !!$gibsResolvedDate && $gibsRequestedDate !== $gibsResolvedDate
	);

	/** With no filters, show the familiar curated quick picks; typing searches all NASA entries. */
	const catalogResults = $derived.by(() => {
		const query = catalogSearch.trim().toLowerCase();
		const hasFilter = !!query || catalogMapOnly || catalogCategory !== 'all';
		if (!hasFilter) {
			return {
				items: GIBS_CATALOG_LAYERS.slice(0, GIBS_LAYERS.length),
				total: GIBS_LAYERS.length,
				featured: true
			};
		}

		const tokens = query.split(/\s+/).filter(Boolean);
		const matches = GIBS_CATALOG_LAYERS.filter((candidate) => {
			if (catalogMapOnly && !gibsLayerCanRender(candidate)) return false;
			if (catalogCategory !== 'all' && candidate.category !== catalogCategory) return false;
			const haystack = [
				candidate.id,
				candidate.title,
				candidate.subtitle,
				candidate.abstract,
				candidate.dataset,
				Array.isArray(candidate.layerGroup) ? candidate.layerGroup.join(' ') : candidate.layerGroup,
				candidate.productGroup,
				...(candidate.searchTags ?? []),
				...(candidate.dataProducts ?? []).flatMap((product) => [
					product.id,
					product.shortName,
					product.title,
					product.version,
					product.type
				]),
				candidate.category,
				candidate.period,
				candidate.format,
				...(candidate.formats ?? []),
				candidate.resolution,
				candidate.mapSupport,
				candidate.mapSupport === 'wms-rasterized-vector' ? 'mvt vector nasa wms' : '',
				...(candidate.availableProjections ?? []).flatMap((projection) => [
					projection,
					projection.replace(/^epsg/, 'epsg:')
				])
			]
				.join(' ')
				.toLowerCase();
			return tokens.every((token) => haystack.includes(token));
		});
		return { items: matches.slice(0, 100), total: matches.length, featured: false };
	});

	const pickCatalogLayer = (option: GibsLayerDef): void => {
		selectGibsLayer(option.id);
		catalogOpen = false;
		catalogSearch = '';
		catalogCategory = 'all';
		catalogMapOnly = false;
	};

	const formatLabel = (format?: string): string => {
		if (format === 'application/vnd.mapbox-vector-tile') return 'Vector · MVT';
		return format?.replace('image/', '').toUpperCase() ?? 'GIBS';
	};

	const formatSummary = (entry: GibsLayerDef): string =>
		[...new Set(entry.formats?.length ? entry.formats : [entry.format])]
			.map(formatLabel)
			.join(', ');

	const projectionLabel = (projection?: string): string =>
		projection ? projection.replace(/^epsg/, 'EPSG:') : 'Unknown projection';

	const projectionSummary = (entry: GibsLayerDef): string =>
		(entry.availableProjections ?? (entry.projection ? [entry.projection] : []))
			.map(projectionLabel)
			.join(', ');

	const supportLabel = (entry: GibsLayerDef): string =>
		entry.mapSupport === 'projection-only'
			? `Not renderable here · ${projectionSummary(entry)}`
			: entry.mapSupport === 'wms-rasterized-vector'
				? 'Vector · NASA WMS raster'
				: 'Web Mercator · raster WMTS';

	const backToForecast = (): void => {
		exitGibsBrowse();
		onBackToForecast();
	};

	const midpointLabel = (timestamp?: string): string | undefined => {
		if (!timestamp) return undefined;
		const midpointMinutes = (gibsPeriodMilliseconds(layer.period) ?? 30 * 60_000) / 120_000;
		const midpoint = shiftGibsTimestamp(timestamp, midpointMinutes);
		return midpoint ? formatGibsTimestamp(midpoint) : undefined;
	};

	const copyTileUrl = (): void => {
		const frame = $gibsResolvedTime ?? $gibsResolvedDate ?? layer.defaultTime;
		if (!frame && !staticLayer) return;
		// WMTS layers keep XYZ placeholders; vector products use NASA WMS with
		// MapLibre's projected BBOX token so they are honestly rasterized.
		void navigator.clipboard
			.writeText(gibsTileUrl(layer, frame))
			.then(() => toast.success('Map source URL copied'))
			.catch(() => toast.error('Could not copy the map source URL'));
	};

	const openWorldview = (): void => {
		const day = $gibsResolvedDate ?? layer.defaultTime ?? new Date().toISOString().slice(0, 10);
		const bounds = get(map)?.getBounds();
		const view = bounds
			? ([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] as [
					number,
					number,
					number,
					number
				])
			: undefined;
		const url = gibsWorldviewUrl(layer, day, view);
		if (url) window.open(url, '_blank', 'noopener');
	};
</script>

<div class="flex flex-col gap-1 px-12 py-1.5 text-[0.7rem] md:px-3 md:py-1">
	<!-- Current layer, catalogue access and escape hatch -->
	<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
		<span class="font-semibold whitespace-nowrap">NASA GIBS</span>
		<button
			type="button"
			class="inline-flex min-w-0 max-w-[min(22rem,60vw)] flex-1 items-center gap-1.5 rounded border bg-transparent px-1.5 py-1 text-left hover:bg-black/5 dark:hover:bg-white/10"
			onclick={() => (catalogOpen = true)}
			aria-haspopup="dialog"
			aria-label={`Selected layer: ${layer.title}. Browse the NASA GIBS catalogue`}
		>
			<Search size={12} class="shrink-0 opacity-70" />
			<span class="min-w-0 flex-1 truncate font-medium">{layer.title}</span>
			<span class="shrink-0 text-[0.62rem] opacity-60">Browse</span>
		</button>
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

	<!-- The NASA catalogue browser: every official catalogue entry is searchable. -->
	<Dialog.Root bind:open={catalogOpen}>
		<Dialog.Content
			class="bg-glass/95! z-100 flex max-h-[88dvh] flex-col gap-0 overflow-hidden rounded border-none p-0 backdrop-blur-sm sm:max-w-180"
			showCloseButton={true}
		>
			<Dialog.Header class="px-3 pb-2 pt-3">
				<Dialog.Title class="text-sm">NASA GIBS visualization catalogue</Dialog.Title>
				<Dialog.Description class="text-xs opacity-70">
					Search {GIBS_CATALOG_TOTAL.toLocaleString()} official WMTS entries, including Best Available,
					Standard, NRT, and version-specific layers. This map uses Web Mercator (EPSG:3857); projection-only
					entries are listed but cannot be overlaid here.
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-wrap items-center gap-2 border-y px-3 py-2">
				<label class="flex items-center gap-1.5 text-xs">
					<span class="sr-only">Filter by category</span>
					<select
						class="h-7 rounded border bg-transparent px-1.5"
						bind:value={catalogCategory}
						aria-label="Filter catalogue by category"
					>
						<option value="all">All categories</option>
						{#each GIBS_CATEGORIES as category (category.id)}
							<option value={category.id}>{category.label}</option>
						{/each}
					</select>
				</label>
				<label class="inline-flex cursor-pointer items-center gap-1.5 text-xs">
					<input type="checkbox" class="accent-sky-600" bind:checked={catalogMapOnly} />
					Only layers renderable in this map
				</label>
				<span class="ml-auto text-[0.68rem] opacity-60">
					{GIBS_WEB_MERCATOR_TOTAL.toLocaleString()} have Web Mercator support
				</span>
			</div>
			<Command.Root class="min-h-0 flex-1 bg-transparent!" shouldFilter={false}>
				<Command.Input
					class="border-none px-3 text-sm ring-0"
					placeholder="Search title, layer ID, platform, product, tag, format, cadence…"
					bind:value={catalogSearch}
					autofocus
				/>
				<Command.List class="max-h-[62dvh] overflow-y-auto px-1 pb-1">
					<Command.Empty>No layers match these filters.</Command.Empty>
					<Command.Group>
						{#each catalogResults.items as option (option.id)}
							<Command.Item
								value={option.id}
								keywords={[
									option.title,
									option.subtitle,
									option.abstract ?? '',
									option.dataset ?? '',
									Array.isArray(option.layerGroup)
										? option.layerGroup.join(' ')
										: (option.layerGroup ?? ''),
									option.productGroup ?? '',
									...(option.searchTags ?? []),
									...(option.dataProducts ?? []).flatMap((product) => [
										product.id,
										product.shortName ?? '',
										product.title ?? ''
									]),
									option.category,
									option.period,
									option.format ?? '',
									...(option.formats ?? []),
									option.resolution,
									...(option.availableProjections ?? [])
								]}
								class="min-h-14 cursor-pointer items-start justify-between gap-3 py-2 hover:bg-primary/10!"
								onSelect={() => pickCatalogLayer(option)}
							>
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-2 text-xs font-medium">
										<span class="truncate">{option.title}</span>
										{#if option.id === $gibsLayerId}
											<Check size={13} class="shrink-0 text-emerald-600" />
										{/if}
									</span>
									<span class="mt-0.5 block truncate text-[0.68rem] opacity-65">
										{option.subtitle} · {option.id}
									</span>
									{#if option.abstract}
										<span class="mt-0.5 line-clamp-2 block text-[0.65rem] leading-snug opacity-55">
											{option.abstract}
										</span>
									{/if}
								</span>
								<span class="flex max-w-48 shrink-0 flex-col items-end gap-1 text-[0.62rem]">
									<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
										{option.resolution} · {describeGibsPeriod(option.period)}
									</span>
									<span class="text-right opacity-65">{supportLabel(option)}</span>
									<span class="opacity-55">{formatLabel(option.format)}</span>
								</span>
							</Command.Item>
						{/each}
					</Command.Group>
				</Command.List>
			</Command.Root>
			<div class="border-t px-3 py-2 text-[0.68rem] opacity-65">
				{#if catalogResults.featured}
					Showing {catalogResults.total} curated quick picks; search to explore the full WMTS catalogue.
				{:else}
					Showing {Math.min(catalogResults.total, 100)} of {catalogResults.total} matching layers
					{#if catalogResults.total > 100}
						· refine the search to narrow the first 100{/if}.
				{/if}
				<span class="ml-1">Snapshot: {GIBS_CATALOG_SNAPSHOT_DATE}.</span>
			</div>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Temporal controls are omitted for truly static layers. -->
	{#if !staticLayer}
		<div class="flex items-center gap-2">
			<input
				type="date"
				class="h-7 shrink-0 rounded border bg-transparent px-1.5 text-xs"
				min={earliest ?? layer.coverageStart}
				max={latest ?? layer.coverageStart}
				value={$gibsResolvedDate ?? ''}
				onchange={(event) => setGibsDate(event.currentTarget.value)}
				aria-label="Satellite day"
			/>
			{#if timeAware}
				<label
					class="flex shrink-0 items-center gap-1"
					title="Frame timestamps and availability are in UTC"
				>
					<input
						type="time"
						step={timeStepSeconds}
						class="h-7 w-28 rounded border bg-transparent px-1.5 text-xs"
						value={resolvedInputTime}
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
				<!-- The rail shows published availability and supports replay range selection. -->
				<RangeBrush
					min={earliest ?? layer.coverageStart}
					max={latest ?? earliest ?? layer.coverageStart}
					from={$replayOpen ? $replayFrom : undefined}
					to={$replayOpen ? $replayTo : undefined}
					{marker}
					{segments}
					onchange={(nextFrom, nextTo) => setReplayRange({ from: nextFrom, to: nextTo })}
					onseek={(day) => setGibsDate(day)}
				/>
			</div>
		</div>
	{/if}

	{#if !mapCompatible}
		<p class="rounded bg-amber-500/10 px-2 py-1 leading-tight text-amber-900 dark:text-amber-100">
			Not overlaid: this map is EPSG:3857, while this entry is only advertised in
			{projectionSummary(layer)}. It remains searchable, but needs a compatible polar projection to
			render.
		</p>
	{:else if layer.mapSupport === 'wms-rasterized-vector'}
		<p class="rounded bg-sky-500/10 px-2 py-1 leading-tight opacity-80">
			NASA vector product rendered as its default-styled WMS image; MVT is not sent to the raster
			map source.
		</p>
	{/if}

	<!-- Accurate availability and frame readout. -->
	{#if staticLayer}
		<p class="leading-tight opacity-70">
			Static, timeless layer. It has no date dimension and does not move the app clock.
		</p>
	{:else if availability.status === 'loading'}
		<p class="leading-tight opacity-70">
			Checking which {timeAware ? 'frames' : 'days'} this layer has…
		</p>
	{:else if availability.status === 'error'}
		<p class="leading-tight text-red-700 dark:text-red-300">
			Could not read the GIBS availability list ({availability.error}) — the {timeAware
				? 'frame'
				: 'day'} cannot be verified, so nothing is drawn.
		</p>
	{:else}
		<p class="leading-tight">
			{#if mapCompatible}Showing{:else}Available frame{/if}
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
				<span class="opacity-70">
					(nearest published frame to {formatGibsTimestamp($gibsRequestedTime ?? '')})
				</span>
			{:else if awayFromRequest}
				<span class="opacity-70">
					(nearest day to {$gibsRequestedDate} — this layer has no imagery then)
				</span>
			{/if}
			{#if $replayOpen}
				<span class="opacity-70">· drag the two handles on the rail to set the replay interval</span
				>
			{:else if availability.status === 'ready'}
				<span class="hidden opacity-70 sm:inline">· {describeCoverage(availability.ranges)}</span>
			{/if}
		</p>
	{/if}

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
				{:else if !layer.dataProducts?.length}
					<a
						class="rounded bg-black/5 px-1.5 py-0.5 underline-offset-2 hover:underline dark:bg-white/10"
						href={`https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(layer.id)}`}
						target="_blank"
						rel="noopener"
					>
						Search Earthdata
					</a>
				{/if}
				{#if layer.worldviewLayerId}
					<button
						class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-black/10 dark:hover:bg-white/15"
						onclick={openWorldview}
					>
						<ExternalLink size={12} /> NASA Worldview
					</button>
				{/if}
				<button
					class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:bg-black/10 dark:hover:bg-white/15"
					onclick={copyTileUrl}
				>
					<Copy size={12} /> Copy map source URL
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
			{#if layer.dataProducts?.length}
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.65rem]">
					<span class="opacity-60">Source data products:</span>
					{#each layer.dataProducts as product (product.id)}
						<a
							class="underline"
							href={`https://cmr.earthdata.nasa.gov/search/concepts/${encodeURIComponent(product.id)}.html`}
							target="_blank"
							rel="noopener"
							title={product.title ?? product.id}
						>
							{product.shortName ?? product.id}{product.version
								? ` · ${product.version}`
								: ''}{product.type ? ` · ${product.type}` : ''}
						</a>
					{/each}
				</div>
			{/if}
			<div class="flex flex-wrap gap-1.5 text-[0.65rem]">
				<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
					Formats: {formatSummary(layer)}
				</span>
				<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
					Projections: {projectionSummary(layer) || 'not listed'}
				</span>
				<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
					Map support: {supportLabel(layer)}
				</span>
				<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
					Tile matrix: {layer.tileMatrixSet || 'not listed'}
				</span>
				{#if layer.resolutionMatrixSet}
					<span class="rounded bg-black/5 px-1.5 py-0.5 dark:bg-white/10">
						Imagery grid: {layer.resolutionMatrixSet} ·
						{projectionLabel(layer.resolutionProjection)}
					</span>
				{/if}
			</div>
			{#if layer.metadataUrl || layer.colormapUrl || layer.vectorMetadataUrl || layer.vectorStyleUrl}
				<div class="flex flex-wrap gap-x-3 gap-y-1 text-[0.65rem]">
					{#if layer.metadataUrl}
						<a class="underline" href={layer.metadataUrl} target="_blank" rel="noopener"
							>Layer metadata JSON</a
						>
					{/if}
					{#if layer.colormapUrl}
						<a class="underline" href={layer.colormapUrl} target="_blank" rel="noopener"
							>Color map</a
						>
					{/if}
					{#if layer.vectorMetadataUrl}
						<a class="underline" href={layer.vectorMetadataUrl} target="_blank" rel="noopener"
							>Vector metadata</a
						>
					{/if}
					{#if layer.vectorStyleUrl}
						<a class="underline" href={layer.vectorStyleUrl} target="_blank" rel="noopener"
							>Vector style JSON</a
						>
					{/if}
				</div>
			{/if}
			{#if layer.legend}
				<img
					src={layer.legend}
					alt={`Colour bar for ${layer.title}`}
					class="max-h-10 w-full rounded object-contain"
					loading="lazy"
				/>
			{/if}
			{#if layer.abstract}
				<p class="leading-tight opacity-70">{layer.abstract}</p>
			{:else if layer.note}
				<p class="leading-tight opacity-70">{layer.note}</p>
			{/if}
			<p class="leading-tight opacity-60">
				Imagery from
				<a href="https://gibs.earthdata.nasa.gov" class="underline" rel="noreferrer" target="_blank"
					>NASA GIBS / EOSDIS</a
				>. Complete WMTS all-variants snapshot {GIBS_CATALOG_SNAPSHOT_DATE} (Worldview metadata updated
				{GIBS_WORLDVIEW_CATALOG_LAST_MODIFIED ?? 'unknown'}): {GIBS_CATALOG_TOTAL.toLocaleString()}
				layers across NASA's WMTS projections; {GIBS_WEB_MERCATOR_TOTAL.toLocaleString()} are available
				to this Web Mercator map.
				{#if staticLayer}
					This selected product is timeless and does not alter the app clock.
				{:else}
					Temporal availability is fetched from GIBS for this layer; the URL carries its frame when
					applicable.
				{/if}
			</p>
		</div>
	{/if}
</div>
