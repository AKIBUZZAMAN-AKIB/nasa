<script lang="ts">
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

<Toaster closeButton={true} richColors={true} />

{@render children()}
<ModeWatcher />
