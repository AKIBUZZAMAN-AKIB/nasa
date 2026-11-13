<script lang="ts">
	import { BANGLADESH_OUTLINE, type Region } from '$lib/trend/regions';
	import { formatNumber, signed } from '$lib/trend/story';

	import type { SpatialSummary } from '$lib/trend/analyze';

	interface Props {
		spatial: SpatialSummary;
		region: Region;
		unit: string;
		decimals: number;
		/** Words for an increase / a decrease, for the legend. */
		up: string;
		down: string;
	}

	let { spatial, region, unit, decimals, up, down }: Props = $props();

	let width = $state(400);

	const CELL_LON = 0.625;
	const CELL_LAT = 0.5;

	const bounds = $derived.by(() => {
		const lons = spatial.cells.map((c) => c.lon);
		const lats = spatial.cells.map((c) => c.lat);
		const [w, s, e, n] = region.bbox;
		return {
			w: Math.min(w, ...lons) - CELL_LON / 2,
			e: Math.max(e, ...lons) + CELL_LON / 2,
			s: Math.min(s, ...lats) - CELL_LAT / 2,
			n: Math.max(n, ...lats) + CELL_LAT / 2
		};
	});
	const aspect = $derived(
		Math.cos((((bounds.n + bounds.s) / 2) * Math.PI) / 180) *
			((bounds.e - bounds.w) / (bounds.n - bounds.s))
	);
	const height = $derived(Math.min(420, Math.max(180, width / aspect)));
	const drawW = $derived(Math.min(width, height * aspect));
	const offsetX = $derived((width - drawW) / 2);
	const px = (lon: number) => offsetX + ((lon - bounds.w) / (bounds.e - bounds.w)) * drawW;
	const py = (lat: number) => ((bounds.n - lat) / (bounds.n - bounds.s)) * height;

	const maxAbs = $derived(Math.max(1e-9, ...spatial.cells.map((c) => Math.abs(c.perDecade))));

	/** Diverging blue-white-red (or brown-green for 'wetter/greener' variables is not assumed: red = up). */
	function colorFor(v: number): string {
		const t = Math.max(-1, Math.min(1, v / maxAbs));
		const a = Math.abs(t);
		const [r, g, b] = t >= 0 ? [214, 47, 39] : [33, 102, 172];
		const mix = (c: number) => Math.round(247 + (c - 247) * a);
		return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
	}

	const outline = $derived(
		region.group === 'Bangladesh' || region.id === 'bangladesh'
			? BANGLADESH_OUTLINE.map(
					([lon, lat], i) => `${i ? 'L' : 'M'}${px(lon).toFixed(1)},${py(lat).toFixed(1)}`
				).join('') + 'Z'
			: ''
	);
	const box = $derived.by(() => {
		const [w, s, e, n] = region.bbox;
		return { x: px(w), y: py(n), w: px(e) - px(w), h: py(s) - py(n) };
	});

	let selected = $state<number | null>(null);
	const picked = $derived(selected === null ? null : spatial.cells[selected]);
</script>

<div class="w-full" bind:clientWidth={width}>
	<svg
		{width}
		{height}
		viewBox={`0 0 ${width} ${height}`}
		role="img"
		aria-label="Trend in each grid cell"
		class="block"
	>
		<defs>
			<pattern
				id="hatch"
				width="6"
				height="6"
				patternUnits="userSpaceOnUse"
				patternTransform="rotate(45)"
			>
				<line x1="0" y1="0" x2="0" y2="6" class="stroke-background" stroke-width="2.5" />
			</pattern>
		</defs>
		{#each spatial.cells as cell, i (i)}
			{@const x0 = px(cell.lon - CELL_LON / 2)}
			{@const y0 = py(cell.lat + CELL_LAT / 2)}
			{@const w = px(cell.lon + CELL_LON / 2) - x0}
			{@const h = py(cell.lat - CELL_LAT / 2) - y0}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<g
				role="button"
				tabindex="-1"
				onclick={() => (selected = selected === i ? null : i)}
				class="cursor-pointer"
			>
				<rect
					x={x0}
					y={y0}
					width={w}
					height={h}
					fill={colorFor(cell.perDecade)}
					class="stroke-background"
					stroke-width="1"
				/>
				{#if !cell.significant}
					<rect x={x0} y={y0} width={w} height={h} fill="url(#hatch)" opacity="0.8" />
				{/if}
				{#if selected === i}
					<rect
						x={x0 + 1}
						y={y0 + 1}
						width={w - 2}
						height={h - 2}
						fill="none"
						class="stroke-foreground"
						stroke-width="2"
					/>
				{/if}
			</g>
		{/each}
		{#if outline}
			<path d={outline} fill="none" class="stroke-foreground/70" stroke-width="1.2" />
		{/if}
		{#if region.id !== 'bangladesh'}
			<rect
				x={box.x}
				y={box.y}
				width={box.w}
				height={box.h}
				fill="none"
				class="stroke-foreground"
				stroke-width="1.5"
				stroke-dasharray="4 3"
			/>
		{/if}
	</svg>
	<div class="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
		<span class="flex items-center gap-1">
			<span class="inline-block h-3 w-3 rounded-sm" style="background:rgb(214,47,39)"></span>
			{up} (up to {signed(maxAbs, decimals + 1)}
			{unit}/decade)
		</span>
		<span class="flex items-center gap-1">
			<span class="inline-block h-3 w-3 rounded-sm" style="background:rgb(33,102,172)"></span>
			{down}
		</span>
		<span class="flex items-center gap-1">
			<span
				class="border-border inline-block h-3 w-3 rounded-sm border"
				style="background:repeating-linear-gradient(45deg,#bbb 0 2px,transparent 2px 5px)"
			></span>
			Hatched: not significant after FDR
		</span>
	</div>
	{#if picked}
		<p class="mt-2 text-sm">
			Cell {picked.lat.toFixed(2)}°N, {picked.lon.toFixed(3)}°E: {signed(
				picked.perDecade,
				decimals + 1
			)}
			{unit}/decade, p = {formatNumber(picked.p, 3)}, q = {formatNumber(picked.q, 3)} ({picked.significant
				? 'significant'
				: 'not significant'}).
		</p>
	{:else}
		<p class="text-muted-foreground mt-2 text-xs">Tap a cell for its numbers.</p>
	{/if}
</div>
