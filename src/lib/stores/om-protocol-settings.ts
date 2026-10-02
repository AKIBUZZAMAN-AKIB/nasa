import { type Writable, get, writable } from 'svelte/store';

import { BrowserBlockCache } from '@openmeteo/file-reader';
import {
	type WeatherMapLayerFileReader,
	defaultOmProtocolSettings
} from '@openmeteo/weather-map-layer';
import { persisted } from 'svelte-persisted-store';

import { browser } from '$app/environment';

import {
	DEFAULT_CACHE_BLOCK_SIZE_KB,
	DEFAULT_CACHE_MAX_BYTES_MB,
	HTTP_OVERHEAD_BYTES
} from '$lib/constants';
import { getBlockFetchConcurrency } from '$lib/runtime-performance';

import { chartSources } from './chart';

import type {
	Data,
	OmProtocolSettings,
	OmUrlState,
	RenderableColorScale
} from '@openmeteo/weather-map-layer';

export const customColorScales = persisted<Record<string, RenderableColorScale>>(
	'custom-color-scales',
	{}
);

export const cacheBlockSizeKb = persisted('cache-block-size-kb', DEFAULT_CACHE_BLOCK_SIZE_KB);
export const cacheMaxBytesMb = persisted('cache-max-bytes-mb', DEFAULT_CACHE_MAX_BYTES_MB);

const initialCustomColorScales = get(customColorScales);

function createBlockCache() {
	// The Cache API is unavailable in some local-file and embedded previews.
	// Keep file reading usable there; caching is an optional optimization.
	if (!browser || typeof caches === 'undefined') return undefined;
	return new BrowserBlockCache({
		blockSize: get(cacheBlockSizeKb) * 1024 - HTTP_OVERHEAD_BYTES,
		cacheName: 'open-meteo-maps-cache-v1',
		memCacheTtlMs: 1000,
		maxBytes: get(cacheMaxBytesMb) * 1024 * 1024,
		maxConcurrentFetches: getBlockFetchConcurrency()
	});
}

export const omProtocolSettings: Writable<OmProtocolSettings> = writable({
	...defaultOmProtocolSettings,
	// static
	fileReaderConfig: {
		// SharedArrayBuffer requires cross-origin isolation, which local-file,
		// preview, and plain Vite-dev contexts may not provide.
		useSAB:
			browser &&
			typeof crossOriginIsolated !== 'undefined' &&
			crossOriginIsolated &&
			typeof SharedArrayBuffer !== 'undefined',
		cache: createBlockCache()
	},

	// dynamic (can be changed during runtime)
	colorScales: { ...defaultOmProtocolSettings.colorScales, ...initialCustomColorScales },

	postReadCallback: (_omFileReader: WeatherMapLayerFileReader, data: Data, state: OmUrlState) => {
		if (
			state.dataOptions.domain.value === 'ecmwf_ifs' &&
			state.dataOptions.variable === 'pressure_msl'
		) {
			if (data.values) {
				data.values = data.values?.map((value) => value / 100);
			}
		}
	}
});

// The protocol keeps at most maxStatesWithData variable states loaded. A chart
// needs one per source, times two while cross-fading between timesteps, plus
// headroom for pan/zoom-created partial-bounds states.
chartSources.subscribe((sources) => {
	omProtocolSettings.update((settings) => ({
		...settings,
		maxStatesWithData: Math.max(4, sources.length * 2)
	}));
});
