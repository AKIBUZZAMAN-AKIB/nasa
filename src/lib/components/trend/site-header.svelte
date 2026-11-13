<script lang="ts">
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { mode, toggleMode } from 'mode-watcher';

	import { base } from '$app/paths';

	interface Props {
		current: 'explorer' | 'about';
	}

	let { current }: Props = $props();

	const links = [
		{ id: 'explorer', label: 'Explorer', href: `${base}/` },
		{ id: 'about', label: 'Methods', href: `${base}/about` }
	] as const;
</script>

<header class="bg-background/90 sticky top-0 z-30 border-b backdrop-blur">
	<div class="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:px-5">
		<a
			href={`${base}/`}
			class="flex min-h-11 min-w-0 items-center gap-2 rounded-md"
			aria-label="Earth System Trend Explorer home"
		>
			<img src={`${base}/favicon.svg`} alt="" width="32" height="32" class="size-8 shrink-0" />
			<span class="min-w-0 leading-tight">
				<span class="block truncate text-[0.95rem] font-semibold sm:text-base"
					>Earth System Trend Explorer</span
				>
				<span
					class="text-muted-foreground block truncate text-[0.7rem] font-medium tracking-wide uppercase"
				>
					by DIVERGENT
				</span>
			</span>
		</a>
		<nav class="ml-auto flex items-center gap-1" aria-label="Main">
			{#each links as link (link.id)}
				<a
					href={link.href}
					class="hover:bg-accent inline-flex min-h-10 items-center rounded-md px-2.5 text-sm font-medium sm:px-3 {current ===
					link.id
						? 'text-foreground'
						: 'text-muted-foreground'}"
					aria-current={current === link.id ? 'page' : undefined}>{link.label}</a
				>
			{/each}
			<button
				type="button"
				class="hover:bg-accent text-muted-foreground inline-flex size-10 items-center justify-center rounded-md"
				onclick={toggleMode}
				aria-label={mode.current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
			>
				{#if mode.current === 'dark'}<Sun class="size-5" />{:else}<Moon class="size-5" />{/if}
			</button>
		</nav>
	</div>
</header>
