<script lang="ts">
	import { MONTH_NAMES, anomalyGrid, monthlyTrends } from '$lib/trend/insights';
	import { formatNumber, formatP, signed } from '$lib/trend/story';

	import type { Monthly } from '$lib/trend/analyze';

	interface Props {
		monthly: Monthly;
		from: number;
		to: number;
		unit: string;
		decimals: number;
		rateDecimals: number;
		/** Short name for sentences, e.g. 'rainfall'. */
		name: string;
		up: string;
		down: string;
		research: boolean;
	}

	let { monthly, from, to, unit, decimals, rateDecimals, name, up, down, research }: Props =
		$props();

	const trends = $derived(monthlyTrends(monthly, from, to));
	const grid = $derived(anomalyGrid(monthly, from, to));
	const significant = $derived(trends.filter((t) => t.significant));

	let width = $state(360);
	let selectedMonth = $state<number | null>(null);
	let cell = $state<{ year: number; month: number; value: number | null } | null>(null);

	/** Red for an increase, blue for a decrease (RdBu, readable with colour-blindness). */
	function diverging(t: number): string {
		const c = Math.max(-1, Math.min(1, t));
		const a = Math.abs(c);
		const [r, g, b] = c >= 0 ? [178, 24, 43] : [33, 102, 172];
		const mix = (v: number) => Math.round(247 + (v - 247) * a);
		return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
	}

	// --- Monthly trend bars
	const barH = 150;
	const barExtent = $derived.by(() => {
		const vals = trends.flatMap((t) => [t.perDecadeLow, t.perDecadeHigh, 0]);
		const m = Math.max(...vals.map(Math.abs), 1e-9);
		return m * 1.05;
	});
	const axisTicks = $derived([barExtent * 0.9, 0, -barExtent * 0.9]);
	// Left margin fits the longest tick label (about 6 px a character at 10 px).
	const tickLabels = $derived(axisTicks.map((tk) => signed(tk, rateDecimals)));
	const bm = $derived({
		top: 10,
		right: 6,
		bottom: 22,
		left: Math.max(30, Math.max(...tickLabels.map((l) => l.length)) * 6 + 10)
	});
	const barInnerW = $derived(Math.max(10, width - bm.left - bm.right));
	const slot = $derived(barInnerW / 12);
	const by = (v: number) =>
		bm.top + ((barExtent - v) / (2 * barExtent)) * (barH - bm.top - bm.bottom);

	// --- Anomaly heatmap
	const hm = $derived({ top: 4, right: 4, bottom: 22, left: 36 });
	const rowH = $derived(grid.years.length > 40 ? 7 : grid.years.length > 25 ? 9 : 12);
	const colW = $derived(Math.max(8, (width - hm.left - hm.right) / 12));
	const heatH = $derived(hm.top + grid.years.length * rowH + hm.bottom);
	const yearLabelEvery = $derived(grid.years.length > 30 ? 10 : 5);

	/** Pointer shortcut only: every value is also in the CSV download. */
	function pickCell(e: MouseEvent) {
		const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const mi = Math.floor((e.clientX - box.left - hm.left) / colW);
		const yi = Math.floor((e.clientY - box.top - hm.top) / rowH);
		if (mi < 0 || mi > 11 || yi < 0 || yi >= grid.years.length) return;
		cell = { year: grid.years[yi], month: mi + 1, value: grid.values[yi][mi] };
	}

	const monthSentence = $derived.by(() => {
		if (!trends.length) return '';
		if (!significant.length)
			return `No single calendar month shows a significant trend in ${name} once the false discovery rate is controlled.`;
		const ups = significant.filter((t) => t.perDecade > 0).map((t) => MONTH_NAMES[t.month - 1]);
		const downs = significant.filter((t) => t.perDecade < 0).map((t) => MONTH_NAMES[t.month - 1]);
		const parts: string[] = [];
		if (ups.length) parts.push(`${up} in ${ups.join(', ')}`);
		if (downs.length) parts.push(`${down} in ${downs.join(', ')}`);
		return `Significant change by month: ${parts.join('; ')}.`;
	});

	const shown = $derived(
		selectedMonth === null ? null : (trends.find((t) => t.month === selectedMonth) ?? null)
	);
</script>

<div class="space-y-5" bind:clientWidth={width}>
	{#if trends.length}
		<div>
			<h4 class="text-sm font-semibold">Which months are changing?</h4>
			<p class="text-muted-foreground text-sm">
				Trend of each calendar month on its own, {from}–{to}, per decade. Solid bars are significant
				after the Benjamini–Hochberg correction across the 12 months; whiskers are the 95% range of
				Sen's slope.
			</p>
			<p class="mt-2 text-sm font-medium" data-month-sentence>{monthSentence}</p>
			<div class="mt-2 w-full">
				<svg
					{width}
					height={barH}
					viewBox={`0 0 ${width} ${barH}`}
					role="img"
					aria-label={`Trend per decade for each calendar month. ${monthSentence}`}
					class="block overflow-visible"
				>
					{#each axisTicks as tk, i (i)}
						<line
							x1={bm.left}
							x2={width - bm.right}
							y1={by(tk)}
							y2={by(tk)}
							class={tk === 0 ? 'stroke-foreground/50' : 'stroke-border'}
							stroke-width="1"
						/>
						<text
							x={bm.left - 5}
							y={by(tk) + 3.5}
							text-anchor="end"
							class="fill-muted-foreground text-[10px] tabular-nums"
							>{signed(tk, rateDecimals)}</text
						>
					{/each}
					{#each trends as t (t.month)}
						{@const cx = bm.left + slot * (t.month - 0.5)}
						{@const bw = Math.max(4, slot * 0.62)}
						{@const col = diverging(t.perDecade >= 0 ? 0.85 : -0.85)}
						<!-- Pointer shortcut only: the same numbers are in the monthly table. -->
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<g
							class="cursor-pointer"
							onclick={() => (selectedMonth = selectedMonth === t.month ? null : t.month)}
						>
							<rect
								x={cx - slot / 2}
								y={bm.top}
								width={slot}
								height={barH - bm.top - bm.bottom}
								fill={selectedMonth === t.month ? 'var(--muted)' : 'transparent'}
							/>
							<rect
								x={cx - bw / 2}
								y={Math.min(by(t.perDecade), by(0))}
								width={bw}
								height={Math.max(1, Math.abs(by(t.perDecade) - by(0)))}
								fill={t.significant ? col : 'transparent'}
								stroke={col}
								stroke-width="1.5"
								rx="1.5"
							/>
							<line
								x1={cx}
								x2={cx}
								y1={by(t.perDecadeLow)}
								y2={by(t.perDecadeHigh)}
								class="stroke-foreground/60"
								stroke-width="1"
							/>
						</g>
						<text x={cx} y={barH - 7} text-anchor="middle" class="fill-muted-foreground text-[10px]"
							>{width < 380 ? MONTH_NAMES[t.month - 1][0] : MONTH_NAMES[t.month - 1]}</text
						>
					{/each}
				</svg>
			</div>
			<p class="text-muted-foreground mt-1 min-h-5 text-xs" aria-live="polite">
				{#if shown}
					<span class="text-foreground font-medium">{MONTH_NAMES[shown.month - 1]}:</span>
					{signed(shown.perDecade, rateDecimals)}
					{unit} per decade (95% range {signed(shown.perDecadeLow, rateDecimals)} to {signed(
						shown.perDecadeHigh,
						rateDecimals
					)}), {shown.n} years, {shown.significant ? 'significant' : 'not significant'}{research
						? ` (p = ${formatP(shown.p)}, q = ${formatP(shown.q)})`
						: ''}.
				{:else}
					Tap a month for its numbers.
				{/if}
			</p>
			{#if trends.length}
				<details class="mt-1 text-sm">
					<summary class="text-muted-foreground min-h-11 cursor-pointer py-2.5"
						>Monthly trend table</summary
					>
					<div class="overflow-x-auto">
						<table class="w-full min-w-[22rem] text-left text-sm tabular-nums">
							<caption class="sr-only">Trend of each calendar month</caption>
							<thead>
								<tr class="border-b [&_th]:py-1.5 [&_th]:pr-3 [&_th]:font-medium">
									<th scope="col">Month</th>
									<th scope="col">Per decade</th>
									<th scope="col">p</th>
									<th scope="col">q (BH)</th>
									<th scope="col">Years</th>
								</tr>
							</thead>
							<tbody class="[&_td]:py-1 [&_td]:pr-3 [&_tr]:border-b">
								{#each trends as t (t.month)}
									<tr class={t.significant ? 'font-semibold' : ''}>
										<td>{MONTH_NAMES[t.month - 1]}</td>
										<td>{signed(t.perDecade, rateDecimals)} {unit}</td>
										<td>{formatP(t.p)}</td>
										<td>{formatP(t.q)}</td>
										<td>{t.n}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</details>
			{/if}
		</div>
	{/if}

	{#if grid.coverage > 0}
		<div>
			<h4 class="text-sm font-semibold">Every month, every year</h4>
			<p class="text-muted-foreground text-sm">
				Each square is one month compared with the average for that calendar month over {from}–{to}.
				Red is above average, blue below; grey is no data.
			</p>
			<div class="mt-2 w-full">
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<svg
					{width}
					height={heatH}
					viewBox={`0 0 ${width} ${heatH}`}
					role="img"
					aria-label={`Monthly anomalies of ${name} for ${from} to ${to}, year by month.`}
					class="block cursor-pointer"
					data-heatmap
					onclick={pickCell}
				>
					{#each grid.years as year, yi (year)}
						{#if (year - grid.years[0]) % yearLabelEvery === 0 || yi === grid.years.length - 1}
							<text
								x={hm.left - 5}
								y={hm.top + yi * rowH + rowH / 2 + 3.5}
								text-anchor="end"
								class="fill-muted-foreground text-[10px] tabular-nums">{year}</text
							>
						{/if}
						{#each grid.values[yi] as val, mi (mi)}
							<rect
								x={hm.left + mi * colW}
								y={hm.top + yi * rowH}
								width={colW - 1}
								height={rowH - 1}
								fill={val === null ? 'var(--muted)' : diverging(val / grid.limit)}
								class={cell?.year === year && cell.month === mi + 1 ? 'stroke-foreground' : ''}
								stroke-width="1.5"
							/>
						{/each}
					{/each}
					{#each MONTH_NAMES as m, mi (m)}
						<text
							x={hm.left + mi * colW + colW / 2}
							y={heatH - 7}
							text-anchor="middle"
							class="fill-muted-foreground text-[10px]">{width < 380 ? m[0] : m}</text
						>
					{/each}
				</svg>
			</div>
			<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
				<span class="flex items-center gap-1.5">
					<span class="text-muted-foreground tabular-nums">{signed(-grid.limit, decimals)}</span>
					<span
						class="h-2.5 w-24 rounded-sm"
						style={`background:linear-gradient(90deg, ${diverging(-1)}, ${diverging(0)}, ${diverging(1)})`}
						aria-hidden="true"
					></span>
					<span class="text-muted-foreground tabular-nums"
						>{signed(grid.limit, decimals)} {unit}</span
					>
				</span>
				<span class="text-muted-foreground" aria-live="polite">
					{#if cell}
						<span class="text-foreground font-medium"
							>{MONTH_NAMES[cell.month - 1]} {cell.year}:</span
						>
						{cell.value === null
							? 'no data'
							: `${signed(cell.value, decimals)} ${unit} vs the ${MONTH_NAMES[cell.month - 1]} average (${formatNumber(grid.baseline[cell.month - 1] ?? 0, decimals)} ${unit})`}
					{:else}
						Tap a square for its value. Data coverage {Math.round(grid.coverage * 100)}%.
					{/if}
				</span>
			</div>
		</div>
	{/if}
</div>
