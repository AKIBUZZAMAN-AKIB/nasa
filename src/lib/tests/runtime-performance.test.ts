import { describe, expect, it } from 'vitest';

import {
	getBlockFetchConcurrency,
	getPrefetchConcurrency,
	shouldCancelPendingTilesWhileZooming
} from '../runtime-performance';

import type { RuntimePerformanceHints } from '../runtime-performance';

describe('adaptive runtime performance limits', () => {
	it('keeps prefetch conservative when browser hints are unavailable', () => {
		expect(getPrefetchConcurrency({})).toBe(4);
		expect(getBlockFetchConcurrency({})).toBe(8);
		expect(shouldCancelPendingTilesWhileZooming({})).toBe(false);
	});

	it('limits background work on data-saver and very slow connections', () => {
		const hints: RuntimePerformanceHints = { saveData: true, effectiveType: '4g' };
		expect(getPrefetchConcurrency(hints)).toBe(1);
		expect(getBlockFetchConcurrency(hints)).toBe(2);
		expect(shouldCancelPendingTilesWhileZooming(hints)).toBe(true);

		const slow2g = { effectiveType: 'slow-2g' };
		expect(getPrefetchConcurrency(slow2g)).toBe(1);
		expect(getBlockFetchConcurrency(slow2g)).toBe(2);
		expect(shouldCancelPendingTilesWhileZooming(slow2g)).toBe(true);
	});

	it('reduces work on low-memory or low-core devices', () => {
		const hints: RuntimePerformanceHints = { hardwareConcurrency: 2, deviceMemoryGiB: 2 };
		expect(getPrefetchConcurrency(hints)).toBe(2);
		expect(getBlockFetchConcurrency(hints)).toBe(4);
		expect(shouldCancelPendingTilesWhileZooming(hints)).toBe(true);
	});

	it('keeps full prefetch throughput for high-capacity devices', () => {
		const hints: RuntimePerformanceHints = { hardwareConcurrency: 8, deviceMemoryGiB: 8 };
		expect(getPrefetchConcurrency(hints)).toBe(8);
		expect(getBlockFetchConcurrency(hints)).toBe(10);
		expect(shouldCancelPendingTilesWhileZooming(hints)).toBe(false);
	});

	it('keeps 3G prefetch light and cancels stale zoom tiles', () => {
		const hints: RuntimePerformanceHints = { effectiveType: '3g' };
		expect(getPrefetchConcurrency(hints)).toBe(2);
		expect(getBlockFetchConcurrency(hints)).toBe(4);
		expect(shouldCancelPendingTilesWhileZooming(hints)).toBe(true);
	});
});
