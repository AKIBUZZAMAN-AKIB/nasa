<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import { now } from '$lib/stores/time';

	import { METADATA_REFRESH_INTERVAL, MILLISECONDS_PER_MINUTE } from '$lib/constants';
	import { getInitialMetaData } from '$lib/metadata';

	let { children } = $props();

	let metaDataInterval: ReturnType<typeof setInterval> | undefined;
	let updateNowInterval: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		metaDataInterval = setInterval(() => {
			getInitialMetaData();
		}, METADATA_REFRESH_INTERVAL);
		updateNowInterval = setInterval(() => {
			$now = new Date();
		}, MILLISECONDS_PER_MINUTE);
	});

	onDestroy(() => {
		if (metaDataInterval) clearInterval(metaDataInterval);
		if (updateNowInterval) clearInterval(updateNowInterval);
	});
</script>

<svelte:head>
	<title>Live weather map · Earth System Trend Explorer</title>
</svelte:head>

{@render children()}
