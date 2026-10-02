import { get } from 'svelte/store';

import { persisted } from 'svelte-persisted-store';
import { toast } from 'svelte-sonner';

import { browser } from '$app/environment';

import { BASE_URI, DATA_SPATIAL_BASE_URI, S3_BASE_URI } from '$lib/helpers';

/** Daily request allowance of the data API (server default, resets midnight UTC). */
export const DAILY_REQUEST_LIMIT = 10_000;

/** Hourly request allowance of the data API (resets at the top of each UTC hour). */
export const HOURLY_REQUEST_LIMIT = 5_000;

/** Minutely request allowance of the data API (resets every minute). */
export const MINUTELY_REQUEST_LIMIT = 600;

/** 429 responses in this session before switching to the S3 endpoint automatically. */
const AUTO_SWITCH_429_COUNT = 5;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The server clears rate-limit counters within the first minute of each window. */
const RESET_BUFFER_MS = 90_000;

/** UTC day the daily API limit resets on, e.g. '2026-09-02'. */
export const utcDay = (): string => new Date().toISOString().slice(0, 10);

/** UTC hour the hourly API limit resets on, e.g. '2026-09-02T13'. */
export const utcHour = (): string => new Date().toISOString().slice(0, 13);

/** UTC minute the minutely API limit resets on, e.g. '2026-09-02T13:05'. */
export const utcMinute = (): string => new Date().toISOString().slice(0, 16);

/** Requests issued against the data API, per rate-limit window (UTC). */
export const apiRequestCounter = persisted('api-request-counter', {
	day: utcDay(),
	count: 0,
	hour: utcHour(),
	hourCount: 0,
	minute: utcMinute(),
	minuteCount: 0
});

/**
 * Automatic fallback: while `activeUntil` (epoch ms) is in the future, data
 * requests are rewritten to the uncached S3 origin (no rate limit, slower)
 * and retry the primary endpoint after the recovery window ends.
 */
export const s3Fallback = persisted('api-s3-fallback', { activeUntil: 0 });

const s3FallbackActive = (): boolean => get(s3Fallback).activeUntil > Date.now();

/** Data-endpoint recovery toggles from the settings panel. */
export const rateLimitOptions = persisted('api-rate-limit-options', {
	/** Switch to the S3 endpoint automatically after repeated 429s or an HTTP 403. */
	autoSwitch: true,
	/** Toasts about reached limits and endpoint switches. */
	notifications: true
});

const notify = (show: () => void): void => {
	if (get(rateLimitOptions).notifications) show();
};

export type EndpointMode = 'default' | 'data-spatial' | 's3' | 'custom';

/** Manual endpoint choice from the settings panel; `custom` uses `customUri`. */
export const endpointChoice = persisted('api-endpoint-choice', {
	mode: 'default' as EndpointMode,
	customUri: ''
});

/** Base URI data requests are rewritten to, or undefined to leave them on BASE_URI. */
const rewriteBase = (): string | undefined => {
	const choice = get(endpointChoice);
	let target: string | undefined;
	if (choice.mode === 'custom') {
		const uri = choice.customUri.trim().replace(/\/+$/, '');
		if (uri) target = uri;
	} else if (choice.mode === 's3') {
		target = S3_BASE_URI;
	} else if (choice.mode === 'data-spatial') {
		target = DATA_SPATIAL_BASE_URI;
	}
	// The automatic fallback applies whenever the effective endpoint is the
	// rate-limited one, whether via BASE_URI or picked explicitly.
	if ((target ?? BASE_URI) === DATA_SPATIAL_BASE_URI && s3FallbackActive()) {
		target = S3_BASE_URI;
	}
	return target === BASE_URI ? undefined : target;
};

/** Manual mode selection; also ends an automatic S3 period. */
export const setEndpointMode = (mode: EndpointMode): void => {
	clearTimeout(switchBackTimer);
	s3Fallback.set({ activeUntil: 0 });
	endpointChoice.update((choice) => ({ ...choice, mode }));
};

/** Epoch ms just after the current minutely/hourly/daily rate-limit window resets. */
const nextReset = (periodMs: number): number =>
	(Math.floor(Date.now() / periodMs) + 1) * periodMs + RESET_BUFFER_MS;

let switchBackTimer: ReturnType<typeof setTimeout> | undefined;

const scheduleSwitchBack = (): void => {
	const remaining = get(s3Fallback).activeUntil - Date.now();
	if (remaining <= 0) return;
	clearTimeout(switchBackTimer);
	switchBackTimer = setTimeout(() => {
		s3Fallback.set({ activeUntil: 0 });
		notify(() => toast.info('Endpoint retry window ended, switched back to the fast endpoint'));
	}, remaining);
};

const activateS3Fallback = (until: number): void => {
	status429Count = 0;
	s3Fallback.set({ activeUntil: until });
	scheduleSwitchBack();
};

let limitToastDay = '';

/** The local counter hit the daily limit: offer the switch, but let the user decide. */
const onLimitReached = (): void => {
	if (limitToastDay === utcDay() || s3FallbackActive()) return;
	if (!get(rateLimitOptions).notifications) return;
	limitToastDay = utcDay();
	// Neutral toast(): the richColors warning variant clashes with the app style.
	toast('Daily API request limit reached', {
		description: 'New requests are likely to be rejected until midnight UTC.',
		duration: Number.POSITIVE_INFINITY,
		action: {
			label: 'Use slower endpoint',
			onClick: () => {
				activateS3Fallback(nextReset(DAY_MS));
				toast.info('Switched to the slower S3 endpoint until midnight UTC');
			}
		}
	});
};

let status429Count = 0;

/**
 * A 403 from the rate-limited endpoint is a hard access denial, not a quota
 * signal. Retry immediately against the public S3 mirror; unlike 429, waiting
 * for repeated responses cannot make the denied request usable.
 *
 * Returns true when the caller should retry through S3. If automatic switching
 * is disabled, show one actionable toast and leave the response untouched.
 */
const onForbidden = (): boolean => {
	if (s3FallbackActive()) return true;
	if (get(rateLimitOptions).autoSwitch) {
		activateS3Fallback(nextReset(DAY_MS));
		notify(() =>
			toast.info('Data endpoint denied access (HTTP 403)', {
				description: 'Retried through the S3 mirror until the daily reset.'
			})
		);
		return true;
	}
	notify(() =>
		toast('Data endpoint denied access (HTTP 403)', {
			description: 'Switch to the S3 mirror in Settings to continue.',
			duration: Number.POSITIVE_INFINITY,
			id: 'data-endpoint-forbidden',
			action: {
				label: 'Use S3 endpoint',
				onClick: () => {
					activateS3Fallback(nextReset(DAY_MS));
					toast.info('Switched to the S3 mirror until the daily reset');
				}
			}
		})
	);
	return false;
};

/** Actual 429 responses are a hard signal: switch automatically after a few. */
const on429 = async (res: Response): Promise<void> => {
	if (s3FallbackActive()) return;
	status429Count += 1;
	if (status429Count !== AUTO_SWITCH_429_COUNT) return;
	// The 429 body names the minutely/hourly/daily window that tripped
	// (RateLimitError in open-meteo), and thus when it resets.
	let period = HOUR_MS;
	let label = 'hourly';
	try {
		const reason: string = (await res.clone().json())?.reason ?? '';
		if (/daily/i.test(reason)) [period, label] = [DAY_MS, 'daily'];
		else if (/minutely/i.test(reason)) [period, label] = [MINUTE_MS, 'minutely'];
	} catch {
		// Keep the hourly middle ground if the body is not readable.
	}
	if (get(rateLimitOptions).autoSwitch) {
		activateS3Fallback(nextReset(period));
		notify(() =>
			toast('API rate limit exceeded', {
				description: `Switched to the slower S3 endpoint until the ${label} limit resets.`
			})
		);
	} else {
		// Auto switch disabled: offer the switch instead of performing it.
		notify(() =>
			toast('API rate limit exceeded', {
				description: 'Requests are being rejected until the limit resets.',
				duration: Number.POSITIVE_INFINITY,
				action: {
					label: 'Use slower endpoint',
					onClick: () => activateS3Fallback(nextReset(period))
				}
			})
		);
	}
};

const increment = (): void => {
	const day = utcDay();
	const hour = utcHour();
	const minute = utcMinute();
	apiRequestCounter.update((counter) => ({
		day,
		count: counter.day === day ? counter.count + 1 : 1,
		hour,
		hourCount: counter.hour === hour ? counter.hourCount + 1 : 1,
		minute,
		minuteCount: counter.minute === minute ? counter.minuteCount + 1 : 1
	}));
	if (get(apiRequestCounter).count >= DAILY_REQUEST_LIMIT) onLimitReached();
};

let installed = false;

/**
 * Count every HTTP request to the data API by wrapping `window.fetch`.
 * All data traffic (block cache misses, HEAD metadata probes, meta JSONs)
 * goes through main-thread fetch, so one wrapper sees it all. While an S3 or
 * custom endpoint override is active, requests are rewritten here at the
 * network layer: URL strings elsewhere (cache keys, UI) keep the canonical
 * endpoint. The block cache keys blocks by the file URL the reader was given,
 * so it stays one shared cache across endpoints: blocks fetched from S3 are
 * served from the cache after switching back, and vice versa.
 */
export const installRequestCounter = (): void => {
	if (!browser || installed) return;
	installed = true;
	scheduleSwitchBack();
	const originalFetch = window.fetch;

	/**
	 * S3 serves ranged GETs with CORS, but its HEAD responses omit
	 * Access-Control-Allow-Origin. The OM reader uses HEAD to discover file
	 * size, so synthesize that metadata from a one-byte ranged GET instead.
	 */
	const fetchS3MetadataByRange = async (
		targetUrl: string,
		input: RequestInfo | URL,
		init?: RequestInit
	): Promise<Response> => {
		const request = input instanceof Request ? input : undefined;
		const headers = new Headers(request?.headers);
		if (init?.headers) {
			new Headers(init.headers).forEach((value, key) => headers.set(key, value));
		}
		headers.set('Range', 'bytes=0-0');

		const rangeInit: RequestInit = {
			...(request
				? {
						mode: request.mode,
						credentials: request.credentials,
						cache: request.cache,
						redirect: request.redirect,
						referrer: request.referrer,
						referrerPolicy: request.referrerPolicy,
						integrity: request.integrity,
						keepalive: request.keepalive,
						signal: request.signal
					}
				: {}),
			...init,
			method: 'GET',
			headers,
			body: undefined,
			signal: init?.signal ?? request?.signal
		};

		const response = await originalFetch.call(window, targetUrl, rangeInit);
		const contentRange = response.headers.get('content-range');
		const match =
			response.status === 206 ? /^bytes\s+\d+-\d+\/(\d+)$/i.exec(contentRange ?? '') : null;
		const contentLength = match?.[1];
		const etag = response.headers.get('etag');
		const lastModified = response.headers.get('last-modified');
		try {
			await response.body?.cancel();
		} catch {
			// A failed one-byte response cancellation must not block metadata parsing.
		}

		if (!contentLength) {
			throw new Error(
				`Could not read S3 file metadata from a byte range (HTTP ${response.status}, ${contentRange ?? 'no Content-Range'})`
			);
		}

		const metadataHeaders = new Headers({ 'Content-Length': contentLength });
		if (etag) metadataHeaders.set('ETag', etag);
		if (lastModified) metadataHeaders.set('Last-Modified', lastModified);
		return new Response(null, { status: 200, headers: metadataHeaders });
	};

	window.fetch = (input, init) => {
		let url = '';
		try {
			url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		} catch {
			// Counting must never break a request.
		}
		const requestMethod = (
			init?.method ?? (input instanceof Request ? input.method : 'GET')
		).toUpperCase();

		if (!url.startsWith(BASE_URI)) {
			// Also handle direct S3 requests, e.g. when an app or custom endpoint
			// already targets the public mirror.
			if (url.startsWith(S3_BASE_URI) && requestMethod === 'HEAD') {
				return fetchS3MetadataByRange(url, input, init);
			}
			return originalFetch.call(window, input, init);
		}

		const base = rewriteBase();
		const targetUrl = base ? base + url.slice(BASE_URI.length) : url;
		// Only requests that end up on the rate-limited endpoint count.
		const limited = targetUrl.startsWith(DATA_SPATIAL_BASE_URI);
		if (limited) increment();
		// Preserve a clone before fetch consumes a Request body; model-data calls
		// are GETs today, but this keeps the retry safe for future request options.
		const retryRequest = limited && input instanceof Request ? input.clone() : undefined;

		// S3's HEAD response is not CORS-readable; use its CORS-enabled Range GET.
		if (targetUrl.startsWith(S3_BASE_URI) && requestMethod === 'HEAD') {
			return fetchS3MetadataByRange(targetUrl, input, init);
		}

		const targetInput = !base
			? input
			: typeof input === 'string' || input instanceof URL
				? targetUrl
				: new Request(targetUrl, input);
		const response = originalFetch.call(window, targetInput, init);
		if (!limited) return response;

		// A hard 403 is retried once immediately through the unmetered S3 mirror.
		// This also handles metadata JSONs, whose failure occurs before tile reads.
		return response.then(async (res) => {
			if (res.status === 403 && onForbidden()) {
				const fallbackUrl = S3_BASE_URI + url.slice(BASE_URI.length);
				const fallbackInput = retryRequest ? new Request(fallbackUrl, retryRequest) : fallbackUrl;
				try {
					await res.body?.cancel();
				} catch {
					// A failed 403 body cancellation must not block the S3 retry.
				}
				if (requestMethod === 'HEAD') {
					return fetchS3MetadataByRange(fallbackUrl, retryRequest ?? input, init);
				}
				return originalFetch.call(window, fallbackInput, init);
			}
			if (res.status === 429) void on429(res);
			return res;
		});
	};
};
