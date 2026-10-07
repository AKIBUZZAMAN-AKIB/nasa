<script lang="ts">
	import { Download } from '@lucide/svelte';

	import { downloadSvg } from './d3-utils';

	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		subtitle?: string;
		filename?: string;
		children: Snippet;
		footer?: Snippet;
	}

	let { title, subtitle, filename = 'chart', children, footer }: Props = $props();

	let body: HTMLDivElement | undefined = $state();

	function exportSvg() {
		downloadSvg(body?.querySelector('svg'), `${filename}.svg`);
	}
</script>

<section
	class="rounded-lg border border-black/10 bg-white px-2.5 pb-2 pt-2 shadow-sm dark:border-white/10 dark:bg-neutral-900"
>
	<header class="mb-1 flex items-start justify-between gap-2">
		<div class="min-w-0">
			<h3 class="text-[0.76rem] font-semibold leading-tight">{title}</h3>
			{#if subtitle}
				<p class="mt-0.5 text-[0.66rem] leading-snug opacity-60">{subtitle}</p>
			{/if}
		</div>
		<button
			class="shrink-0 rounded p-1 opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
			title="Download SVG"
			aria-label="Download chart as SVG"
			onclick={exportSvg}
		>
			<Download size={12} />
		</button>
	</header>
	<div bind:this={body}>
		{@render children()}
	</div>
	{#if footer}
		<div
			class="mt-1 border-t border-black/5 pt-1 text-[0.66rem] leading-snug opacity-75 dark:border-white/5"
		>
			{@render footer()}
		</div>
	{/if}
</section>
