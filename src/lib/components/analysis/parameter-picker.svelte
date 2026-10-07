<script lang="ts">
	/**
	 * Searchable, theme-grouped parameter picker for the ~150 (daily) / ~1400
	 * (monthly) POWER parameters.
	 *
	 * Follows the WAI-ARIA APG editable-combobox + grouped-listbox patterns:
	 * DOM focus stays in the text input, `aria-activedescendant` points at the
	 * visually focused option, Up/Down/Home/End move, Enter selects, Escape
	 * closes. Groups follow the Copernicus Climate Atlas style of thematic
	 * variable grouping instead of POWER's coarse METEOROLOGY / RADIATION type.
	 */
	import { tick } from 'svelte';

	import {
		Check,
		ChevronDown,
		CircleDot,
		Cloud,
		CloudRain,
		Droplets,
		Gauge,
		Layers,
		Search,
		Sprout,
		Sun,
		Thermometer,
		Wind
	} from '@lucide/svelte';

	import {
		POWER_THEMES,
		type PowerCatalogEntry,
		type PowerTheme,
		powerTheme
	} from '$lib/analysis/sources';

	interface Props {
		catalog: PowerCatalogEntry[];
		value: string;
		onselect: (code: string) => void;
		listHeight?: number;
	}

	let { catalog, value, onselect, listHeight = 280 }: Props = $props();

	const THEME_ICON = {
		temperature: Thermometer,
		precipitation: CloudRain,
		humidity: Droplets,
		wind: Wind,
		radiation: Sun,
		cloud: Cloud,
		soil: Layers,
		atmosphere: Gauge,
		indices: Sprout,
		other: CircleDot
	} as const;

	/** Okabe-Ito-derived accent per theme (colour is never the only cue: icon + label too). */
	const THEME_COLOR: Record<PowerTheme, string> = {
		temperature: '#D55E00',
		precipitation: '#0072B2',
		humidity: '#56B4E9',
		wind: '#009E73',
		radiation: '#E69F00',
		cloud: '#7a8b99',
		soil: '#8c6d31',
		atmosphere: '#CC79A7',
		indices: '#4d9221',
		other: '#888888'
	};

	const uid = `pp-${Math.random().toString(36).slice(2, 8)}`;
	let open = $state(false);
	let query = $state('');
	let themeFilter: PowerTheme | 'all' = $state('all');
	let active = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();
	let listEl: HTMLDivElement | undefined = $state();

	const selected = $derived(catalog.find((c) => c.code === value));
	const selectedTheme = $derived(powerTheme(value));

	const themeCounts = $derived.by(() => {
		const counts: Partial<Record<PowerTheme, number>> = {};
		for (const c of catalog) {
			const t = powerTheme(c.code);
			counts[t] = (counts[t] ?? 0) + 1;
		}
		return counts;
	});

	/** Search with ranking: exact code > code prefix > code/name match > definition match. */
	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const scored: { entry: PowerCatalogEntry; theme: PowerTheme; score: number }[] = [];
		for (const entry of catalog) {
			const theme = powerTheme(entry.code);
			if (themeFilter !== 'all' && theme !== themeFilter) continue;
			let score = 0;
			if (q) {
				const code = entry.code.toLowerCase();
				const name = entry.name.toLowerCase();
				if (code === q) score = 100;
				else if (code.startsWith(q)) score = 80;
				else if (name.startsWith(q)) score = 70;
				else if (code.includes(q)) score = 60;
				else if (name.includes(q)) score = 50;
				else if (entry.definition.toLowerCase().includes(q)) score = 20;
				else continue;
			}
			scored.push({ entry, theme, score });
		}
		const order = new Map(POWER_THEMES.map((t, i) => [t.key, i]));
		scored.sort(
			(a, b) =>
				(q ? b.score - a.score : 0) ||
				(order.get(a.theme) ?? 0) - (order.get(b.theme) ?? 0) ||
				a.entry.code.localeCompare(b.entry.code)
		);
		return scored;
	});

	/** Groups for display; when searching, results stay ranked inside one "Best matches" group. */
	const groups = $derived.by(() => {
		if (query.trim()) {
			return [{ key: 'matches', label: 'Best matches', items: results }];
		}
		const map: Record<string, typeof results> = {};
		for (const r of results) (map[r.theme] ??= []).push(r);
		return POWER_THEMES.filter((t) => map[t.key]?.length).map((t) => ({
			key: t.key as string,
			label: t.label,
			items: map[t.key]
		}));
	});
	const flat = $derived(groups.flatMap((g) => g.items));

	$effect(() => {
		// Keep the active option in range whenever the result set changes.
		if (active >= flat.length) active = Math.max(0, flat.length - 1);
	});

	async function openList() {
		if (open) return;
		open = true;
		const index = flat.findIndex((r) => r.entry.code === value);
		active = index >= 0 ? index : 0;
		await tick();
		scrollActive();
	}

	function close() {
		open = false;
		query = '';
	}

	function choose(code: string) {
		onselect(code);
		close();
		inputEl?.blur();
	}

	function scrollActive() {
		const el = listEl?.querySelector<HTMLElement>(`#${uid}-opt-${active}`);
		el?.scrollIntoView({ block: 'nearest' });
	}

	async function move(delta: number | 'home' | 'end') {
		if (!open) await openList();
		if (!flat.length) return;
		if (delta === 'home') active = 0;
		else if (delta === 'end') active = flat.length - 1;
		else active = Math.min(flat.length - 1, Math.max(0, active + delta));
		await tick();
		scrollActive();
	}

	function onkeydown(e: KeyboardEvent) {
		// Typing here must not trigger the map's global keyboard shortcuts.
		e.stopPropagation();
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				void move(e.altKey ? 0 : 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				void move(-1);
				break;
			case 'PageDown':
				e.preventDefault();
				void move(8);
				break;
			case 'PageUp':
				e.preventDefault();
				void move(-8);
				break;
			case 'Home':
				if (open) {
					e.preventDefault();
					void move('home');
				}
				break;
			case 'End':
				if (open) {
					e.preventDefault();
					void move('end');
				}
				break;
			case 'Enter':
				if (open && flat[active]) {
					e.preventDefault();
					choose(flat[active].entry.code);
				} else void openList();
				break;
			case 'Escape':
				if (open) {
					e.preventDefault();
					close();
				}
				break;
		}
	}

	let rootEl: HTMLDivElement | undefined = $state();

	/**
	 * Close when focus really leaves the widget. Deferred one task, because
	 * swapping the summary button for the search input briefly moves focus to
	 * <body> (relatedTarget = null) and must not close the list it just opened.
	 */
	function onfocusout() {
		setTimeout(() => {
			if (open && rootEl && !rootEl.contains(document.activeElement)) close();
		}, 0);
	}

	/** Split text around the query for <mark> highlighting (no {@html}). */
	function parts(text: string): { t: string; m: boolean }[] {
		const q = query.trim();
		if (!q) return [{ t: text, m: false }];
		const i = text.toLowerCase().indexOf(q.toLowerCase());
		if (i < 0) return [{ t: text, m: false }];
		return [
			{ t: text.slice(0, i), m: false },
			{ t: text.slice(i, i + q.length), m: true },
			{ t: text.slice(i + q.length), m: false }
		];
	}

	const unitText = (u: string) => (u && u !== 'dimensionless' && u !== '1' ? u : '–');
</script>

<div class="relative" {onfocusout}>
	<!-- Current selection (summary card) -->
	{#if !open}
		<button
			type="button"
			class="group flex w-full items-center gap-2 rounded-md border border-black/15 bg-white px-2 py-1.5 text-left shadow-sm transition hover:border-sky-500/60 focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-white/15 dark:bg-neutral-900"
			aria-haspopup="listbox"
			aria-expanded="false"
			aria-label="POWER parameter: {selected
				? `${selected.code}, ${selected.name}`
				: value}. Change"
			onclick={async () => {
				await openList();
				await tick();
				inputEl?.focus();
			}}
		>
			{#if selected}
				{@const Icon = THEME_ICON[selectedTheme]}
				<span
					class="grid size-7 shrink-0 place-items-center rounded-md"
					style="background:{THEME_COLOR[selectedTheme]}1f;color:{THEME_COLOR[selectedTheme]}"
				>
					<Icon size={15} />
				</span>
				<span class="min-w-0 flex-1">
					<span class="flex items-baseline gap-1.5">
						<span class="font-mono text-[0.74rem] font-semibold">{selected.code}</span>
						<span class="truncate text-[0.62rem] opacity-60">{unitText(selected.units)}</span>
					</span>
					<span class="block truncate text-[0.7rem] opacity-80">{selected.name}</span>
				</span>
			{:else}
				<span class="flex-1 text-xs opacity-70">{value || 'Choose a parameter'}</span>
			{/if}
			<ChevronDown size={14} class="shrink-0 opacity-50 group-hover:opacity-90" />
		</button>
	{/if}

	{#if open}
		<div
			class="rounded-md border border-sky-500/60 bg-white shadow-lg ring-2 ring-sky-500/15 dark:bg-neutral-900"
		>
			<div class="flex items-center gap-1.5 border-b border-black/10 px-2 dark:border-white/10">
				<Search size={13} class="shrink-0 opacity-50" />
				<!-- svelte-ignore a11y_autofocus -->
				<input
					bind:this={inputEl}
					bind:value={query}
					{onkeydown}
					autofocus
					type="text"
					role="combobox"
					aria-expanded="true"
					aria-controls="{uid}-list"
					aria-autocomplete="list"
					aria-activedescendant={flat.length ? `${uid}-opt-${active}` : undefined}
					aria-label="Search POWER parameters"
					placeholder="Search {catalog.length} parameters: code, name, definition…"
					class="w-full bg-transparent py-1.5 text-xs outline-none"
					oninput={() => (active = 0)}
				/>
				<span class="shrink-0 text-[0.6rem] tabular-nums opacity-50">{flat.length}</span>
			</div>

			<!-- Theme filter chips -->
			<div
				class="flex gap-1 overflow-x-auto border-b border-black/10 px-1.5 py-1 dark:border-white/10"
				role="toolbar"
				aria-label="Filter by theme"
			>
				<button
					type="button"
					class="shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] {themeFilter === 'all'
						? 'bg-sky-600 text-white'
						: 'bg-black/5 hover:bg-black/10 dark:bg-white/10'}"
					aria-pressed={themeFilter === 'all'}
					onclick={() => {
						themeFilter = 'all';
						inputEl?.focus();
					}}>All</button
				>
				{#each POWER_THEMES.filter((t) => themeCounts[t.key]) as t (t.key)}
					{@const Icon = THEME_ICON[t.key]}
					<button
						type="button"
						class="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.6rem] {themeFilter ===
						t.key
							? 'text-white'
							: 'bg-black/5 hover:bg-black/10 dark:bg-white/10'}"
						style={themeFilter === t.key ? `background:${THEME_COLOR[t.key]}` : ''}
						aria-pressed={themeFilter === t.key}
						title="{t.label} ({themeCounts[t.key]})"
						onclick={() => {
							themeFilter = themeFilter === t.key ? 'all' : t.key;
							active = 0;
							inputEl?.focus();
						}}
					>
						<Icon size={10} />
						{t.label.split(' ')[0]}
					</button>
				{/each}
			</div>

			<div
				bind:this={listEl}
				id="{uid}-list"
				role="listbox"
				aria-label="POWER parameters"
				class="overflow-y-auto overscroll-contain py-0.5"
				style="max-height:{listHeight}px"
			>
				{#if !flat.length}
					<p class="px-2 py-3 text-center text-[0.68rem] opacity-60">
						No parameter matches “{query}”.
					</p>
				{/if}
				{#each groups as group (group.key)}
					{@const offset = flat.indexOf(group.items[0])}
					<div role="group" aria-labelledby="{uid}-g-{group.key}">
						<div
							id="{uid}-g-{group.key}"
							class="sticky top-0 z-[1] flex items-center gap-1 bg-white/95 px-2 pb-0.5 pt-1 text-[0.58rem] font-semibold uppercase tracking-wide opacity-70 backdrop-blur dark:bg-neutral-900/95"
						>
							{group.label}
							<span class="font-normal normal-case tracking-normal opacity-70"
								>· {group.items.length}</span
							>
						</div>
						{#each group.items as item, j (item.entry.code)}
							{@const index = offset + j}
							{@const Icon = THEME_ICON[item.theme]}
							<div
								id="{uid}-opt-{index}"
								role="option"
								tabindex="-1"
								aria-selected={item.entry.code === value}
								title={item.entry.definition}
								class="mx-1 flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 {index ===
								active
									? 'bg-sky-500/15'
									: 'hover:bg-black/5 dark:hover:bg-white/5'}"
								onpointermove={() => (active = index)}
								onpointerdown={(e) => e.preventDefault()}
								onclick={() => choose(item.entry.code)}
								onkeydown={() => {}}
							>
								<span style="color:{THEME_COLOR[item.theme]}" class="shrink-0"
									><Icon size={11} /></span
								>
								<span class="min-w-0 flex-1">
									<span class="flex items-baseline gap-1">
										<span class="font-mono text-[0.66rem] font-semibold"
											>{#each parts(item.entry.code) as p, k (k)}{#if p.m}<mark
														class="rounded-sm bg-amber-300/70 text-inherit">{p.t}</mark
													>{:else}{p.t}{/if}{/each}</span
										>
										<span class="ml-auto shrink-0 text-[0.58rem] opacity-50"
											>{unitText(item.entry.units)}</span
										>
									</span>
									<span class="block truncate text-[0.64rem] opacity-75"
										>{#each parts(item.entry.name) as p, k (k)}{#if p.m}<mark
													class="rounded-sm bg-amber-300/70 text-inherit">{p.t}</mark
												>{:else}{p.t}{/if}{/each}</span
									>
								</span>
								{#if item.entry.code === value}
									<Check size={12} class="shrink-0 text-sky-600" />
								{/if}
							</div>
						{/each}
					</div>
				{/each}
			</div>
			<p
				class="flex justify-between border-t border-black/10 px-2 py-0.5 text-[0.56rem] opacity-50 dark:border-white/10"
			>
				<span>↑↓ move · ⏎ select · Esc close</span>
				<span>live catalog</span>
			</p>
		</div>
	{/if}
</div>
