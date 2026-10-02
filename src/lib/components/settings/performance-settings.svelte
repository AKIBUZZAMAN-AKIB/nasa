<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	import { omProtocolSettings } from '$lib/stores/om-protocol-settings';

	import {
		getBlockFetchConcurrency,
		getPrefetchConcurrency,
		readRuntimePerformanceHints
	} from '$lib/runtime-performance';

	import SettingsSection from './settings-section.svelte';

	let ready = $state(false);
	let workerAvailable = $state(false);
	let sharedMemoryActive = $state(false);
	let rangeCacheAvailable = $state(false);
	let prefetchConcurrency = $state(4);
	let blockFetchConcurrency = $state(8);

	onMount(() => {
		const hints = readRuntimePerformanceHints();
		workerAvailable = typeof Worker !== 'undefined';
		sharedMemoryActive =
			typeof crossOriginIsolated !== 'undefined' &&
			crossOriginIsolated &&
			typeof SharedArrayBuffer !== 'undefined';
		rangeCacheAvailable = Boolean(get(omProtocolSettings).fileReaderConfig.cache);
		prefetchConcurrency = getPrefetchConcurrency(hints);
		blockFetchConcurrency = getBlockFetchConcurrency(hints);
		ready = true;
	});
</script>

<SettingsSection title="Performance">
	<div class="mt-3 flex flex-col gap-3 text-sm">
		<div class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2">
			<span class="text-muted-foreground">Worker support</span>
			<strong class="font-medium"
				>{ready ? (workerAvailable ? 'Available' : 'Unavailable') : 'Checking…'}</strong
			>

			<span class="text-muted-foreground">Shared-memory tiles</span>
			<strong class="font-medium">
				{ready ? (sharedMemoryActive ? 'Active' : 'Fallback copy') : 'Checking…'}
			</strong>

			<span class="text-muted-foreground">Persistent range cache</span>
			<strong class="font-medium">
				{ready ? (rangeCacheAvailable ? 'Available' : 'Unavailable') : 'Checking…'}
			</strong>

			<span class="text-muted-foreground">Background prefetch</span>
			<strong class="font-medium">Up to {prefetchConcurrency} at once</strong>

			<span class="text-muted-foreground">Range downloads</span>
			<strong class="font-medium">Up to {blockFetchConcurrency} at once</strong>
		</div>

		<p class="text-xs leading-relaxed text-muted-foreground">
			Download limits adapt to data-saver, connection, and device-memory hints. Slow or constrained
			setups also cancel obsolete low-zoom tiles during zoom gestures.
		</p>

		{#if ready && !sharedMemoryActive}
			<p class="rounded-md border border-border/60 bg-background/40 p-2.5 text-xs leading-relaxed">
				For smoother pan and zoom, serve this page as a secure, cross-origin-isolated document (COOP <code
					>same-origin</code
				>
				and COEP <code>require-corp</code>). The standalone server helper sets these headers.
			</p>
		{/if}
	</div>
</SettingsSection>
