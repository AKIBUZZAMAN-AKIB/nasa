import { get } from 'svelte/store';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
	apiRequestCounter,
	endpointChoice,
	installRequestCounter,
	rateLimitOptions,
	s3Fallback,
	setEndpointMode
} from '$lib/stores/request-counter';

import { BASE_URI, S3_BASE_URI } from '$lib/helpers';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('svelte-sonner', () => ({ toast: Object.assign(vi.fn(), { info: vi.fn() }) }));

// The wrapper installs itself on `window.fetch`; the spy stands in for the original.
const originalFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
vi.stubGlobal('window', { fetch: originalFetch });

const path = '/dwd_icon_d2/2026-09-09T0000/2026-09-09T0600.om';

describe('installRequestCounter', () => {
	beforeAll(() => {
		installRequestCounter();
	});

	afterEach(() => {
		originalFetch.mockClear();
		setEndpointMode('default');
	});

	it('passes requests through untouched while no endpoint override is active', async () => {
		const input = BASE_URI + path;
		await window.fetch(input);
		expect(originalFetch).toHaveBeenCalledWith(input, undefined);
	});

	it('rewrites the endpoint at the network layer, below the block cache key', async () => {
		setEndpointMode('s3');
		// Callers (and thus the block cache, keyed by the file URL) keep using BASE_URI.
		await window.fetch(BASE_URI + path);
		expect(originalFetch).toHaveBeenCalledWith(S3_BASE_URI + path, undefined);
	});

	it('keeps method and headers of a rewritten Request', async () => {
		setEndpointMode('s3');
		await window.fetch(
			new Request(BASE_URI + path, { method: 'GET', headers: { Range: 'bytes=0-1' } })
		);
		const sent = originalFetch.mock.calls[0][0] as Request;
		expect(sent.url).toBe(S3_BASE_URI + path);
		expect(sent.method).toBe('GET');
		expect(sent.headers.get('range')).toBe('bytes=0-1');
	});

	it('applies the automatic S3 fallback while it is active', async () => {
		setEndpointMode('data-spatial');
		s3Fallback.set({ activeUntil: Date.now() + 60_000 });
		await window.fetch(BASE_URI + path);
		expect(originalFetch).toHaveBeenCalledWith(S3_BASE_URI + path, undefined);
	});

	it('retries a 403 from the rate-limited endpoint through the S3 mirror', async () => {
		setEndpointMode('default');
		rateLimitOptions.update((options) => ({ ...options, autoSwitch: true }));
		originalFetch.mockResolvedValueOnce(new Response('{"reason":"Forbidden"}', { status: 403 }));

		await window.fetch(BASE_URI + '/dwd_icon/latest.json');

		expect(originalFetch).toHaveBeenCalledTimes(2);
		expect(originalFetch.mock.calls[0][0]).toBe(BASE_URI + '/dwd_icon/latest.json');
		expect(originalFetch.mock.calls[1][0]).toBe(S3_BASE_URI + '/dwd_icon/latest.json');
		expect(get(s3Fallback).activeUntil).toBeGreaterThan(Date.now());
	});

	it('replaces a forbidden HEAD with a CORS-readable ranged GET for S3 metadata', async () => {
		setEndpointMode('default');
		rateLimitOptions.update((options) => ({ ...options, autoSwitch: true }));
		originalFetch
			.mockResolvedValueOnce(new Response('{"reason":"Forbidden"}', { status: 403 }))
			.mockResolvedValueOnce(
				new Response(new Uint8Array([0]), {
					status: 206,
					headers: {
						'Content-Range': 'bytes 0-0/168569984',
						ETag: '"weather-file-etag"',
						'Last-Modified': 'Thu, 01 Oct 2026 02:43:04 GMT'
					}
				})
			);

		const response = await window.fetch(BASE_URI + path, { method: 'HEAD' });
		const [rangeUrl, rangeInit] = originalFetch.mock.calls[1];

		expect(originalFetch).toHaveBeenCalledTimes(2);
		expect(rangeUrl).toBe(S3_BASE_URI + path);
		expect(rangeInit?.method).toBe('GET');
		expect(new Headers(rangeInit?.headers).get('range')).toBe('bytes=0-0');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-length')).toBe('168569984');
		expect(response.headers.get('etag')).toBe('"weather-file-etag"');
		expect(response.headers.get('last-modified')).toBe('Thu, 01 Oct 2026 02:43:04 GMT');
		expect(get(s3Fallback).activeUntil).toBeGreaterThan(Date.now());
	});

	it('uses ranged metadata reads when S3 is selected manually', async () => {
		setEndpointMode('s3');
		originalFetch.mockResolvedValueOnce(
			new Response(new Uint8Array([0]), {
				status: 206,
				headers: { 'Content-Range': 'bytes 0-0/12345' }
			})
		);

		const response = await window.fetch(BASE_URI + path, { method: 'HEAD' });
		const [rangeUrl, rangeInit] = originalFetch.mock.calls[0];

		expect(originalFetch).toHaveBeenCalledTimes(1);
		expect(rangeUrl).toBe(S3_BASE_URI + path);
		expect(rangeInit?.method).toBe('GET');
		expect(new Headers(rangeInit?.headers).get('range')).toBe('bytes=0-0');
		expect(response.headers.get('content-length')).toBe('12345');
	});

	it('uses a custom endpoint without its trailing slash', async () => {
		endpointChoice.set({ mode: 'custom', customUri: 'https://example.org/data_spatial/' });
		await window.fetch(BASE_URI + path);
		expect(originalFetch).toHaveBeenCalledWith(
			'https://example.org/data_spatial' + path,
			undefined
		);
	});

	it('counts only requests that reach the rate-limited endpoint', async () => {
		setEndpointMode('data-spatial');
		const before = get(apiRequestCounter).count;
		await window.fetch(BASE_URI + path);
		expect(get(apiRequestCounter).count).toBe(before + 1);
		setEndpointMode('s3');
		await window.fetch(BASE_URI + path);
		expect(get(apiRequestCounter).count).toBe(before + 1);
	});

	it('leaves requests to other hosts alone', async () => {
		setEndpointMode('s3');
		const input = 'https://tiles.open-meteo.com/style.json';
		await window.fetch(input);
		expect(originalFetch).toHaveBeenCalledWith(input, undefined);
	});
});
