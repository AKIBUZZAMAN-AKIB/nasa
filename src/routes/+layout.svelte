<script lang="ts">
	import publicSansLatin from '@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2?url';
	import { ModeWatcher } from 'mode-watcher';
	import { toast } from 'svelte-sonner';

	import { updated } from '$app/state';

	import { Toaster } from '$lib/components/ui/sonner';

	import '../styles.css';

	let { children } = $props();

	// `updated` flips once the polled _app/version.json reports a newer build
	// (see svelte.config.js); it never flips back, so this fires at most once.
	$effect(() => {
		if (!updated.current) return;
		toast('Earth System Trend Explorer has been updated', {
			description: 'A newer version is available.',
			duration: Infinity,
			action: { label: 'Reload', onClick: () => location.reload() }
		});
	});
</script>

<svelte:head>
	<!-- Fetch the (English) font with the page so text does not reflow when it arrives. -->
	<link rel="preload" href={publicSansLatin} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

<Toaster closeButton={true} richColors={true} />

{@render children()}
<ModeWatcher />
