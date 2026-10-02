/**
 * Small adaptive limits for background range reads. These are deliberately
 * hints, not hardware requirements: unavailable signals fall back to safe,
 * moderate values, and the weather protocol's own render workers stay in use.
 */
export interface RuntimePerformanceHints {
	hardwareConcurrency?: number;
	deviceMemoryGiB?: number;
	saveData?: boolean;
	effectiveType?: string;
}

type NavigatorWithConnectionHints = Navigator & {
	deviceMemory?: number;
	connection?: {
		saveData?: boolean;
		effectiveType?: string;
	};
};

const positiveFinite = (value: number | undefined): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/** Read optional browser hints without assuming Chromium-only APIs exist. */
export const readRuntimePerformanceHints = (): RuntimePerformanceHints => {
	if (typeof navigator === 'undefined') return {};

	const hintedNavigator = navigator as NavigatorWithConnectionHints;
	return {
		hardwareConcurrency: positiveFinite(hintedNavigator.hardwareConcurrency),
		deviceMemoryGiB: positiveFinite(hintedNavigator.deviceMemory),
		saveData: hintedNavigator.connection?.saveData === true,
		effectiveType: hintedNavigator.connection?.effectiveType?.toLowerCase()
	};
};

const isVerySlowNetwork = (hints: RuntimePerformanceHints): boolean =>
	hints.effectiveType === 'slow-2g' || hints.effectiveType === '2g';

const isSlowNetwork = (hints: RuntimePerformanceHints): boolean =>
	isVerySlowNetwork(hints) || hints.effectiveType === '3g';

const isConstrainedDevice = (hints: RuntimePerformanceHints): boolean =>
	(hints.hardwareConcurrency !== undefined && hints.hardwareConcurrency <= 2) ||
	(hints.deviceMemoryGiB !== undefined && hints.deviceMemoryGiB <= 2);

/**
 * Maximum number of time steps to warm in parallel. Explicit prefetch stays
 * fast on capable devices, while slow links and low-memory devices avoid
 * competing with interactive map requests.
 */
export const getPrefetchConcurrency = (
	hints: RuntimePerformanceHints = readRuntimePerformanceHints()
): number => {
	if (hints.saveData || isVerySlowNetwork(hints)) return 1;
	if (hints.effectiveType === '3g') return 2;
	if (isConstrainedDevice(hints)) return 2;

	const cores = positiveFinite(hints.hardwareConcurrency);
	const memory = positiveFinite(hints.deviceMemoryGiB);
	if ((cores !== undefined && cores <= 4) || (memory !== undefined && memory <= 4)) return 4;
	if (cores === undefined && memory === undefined) return 4;
	if (cores !== undefined && cores >= 8 && memory !== undefined && memory >= 8) return 8;
	return 6;
};

/**
 * Bound simultaneous cached HTTP range fetches. The cache's upstream default
 * is 10; using a device-aware limit leaves headroom for basemap/satellite
 * requests and avoids bursts on constrained connections.
 */
export const getBlockFetchConcurrency = (
	hints: RuntimePerformanceHints = readRuntimePerformanceHints()
): number => {
	if (hints.saveData || isVerySlowNetwork(hints)) return 2;
	if (hints.effectiveType === '3g' || isConstrainedDevice(hints)) return 4;

	const cores = positiveFinite(hints.hardwareConcurrency);
	const memory = positiveFinite(hints.deviceMemoryGiB);
	if (cores !== undefined && cores >= 8 && memory !== undefined && memory >= 8) return 10;
	return 8;
};

/**
 * MapLibre can drop obsolete low-zoom tiles while a zoom gesture is in flight.
 * Turn this on for data-saver/slow-link/low-memory cases only; default fast
 * devices retain the smoother tile continuity.
 */
export const shouldCancelPendingTilesWhileZooming = (
	hints: RuntimePerformanceHints = readRuntimePerformanceHints()
): boolean => hints.saveData === true || isSlowNetwork(hints) || isConstrainedDevice(hints);
