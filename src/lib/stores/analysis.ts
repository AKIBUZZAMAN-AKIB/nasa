/**
 * State for the Historical analysis panel: location, source selection
 * (Open-Meteo reanalysis or NASA POWER), period/baseline, and the lazily
 * loaded comparison and regional grids.
 *
 * Series are fetched over the union of the analysis period and the baseline
 * so that anomalies never need a second request, then sliced client-side.
 */
import { get, writable } from 'svelte/store';

import {
	type ArchiveModel,
	CLIMATOLOGY_END_YEAR,
	CLIMATOLOGY_START_YEAR,
	clampArchivePeriod,
	dailyAggregateFor,
	getArchiveVariable
} from '$lib/stores/archive';

import {
	type AnalysisSeries,
	type AnalysisSource,
	type ComparePair,
	POWER_START_YEAR,
	type PowerAnalysisTemporal,
	type PowerCatalogEntry,
	type RegionalGrid,
	comparePairForOpenMeteo,
	comparePairForPower,
	fetchEra5Daily,
	fetchOpenMeteoAnalysisSeries,
	fetchPowerAnalysisSeries,
	fetchPowerCatalog,
	fetchPowerRegionalMonthly,
	powerStartYear,
	regionalBounds
} from '$lib/analysis/sources';

import type { PowerCommunity } from '$lib/nasa-power';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CompareState {
	status: LoadStatus;
	error?: string;
	pair?: ComparePair;
	/** Secondary series converted into the primary series' units. */
	series?: AnalysisSeries;
	/** Identity of the primary series the comparison was built for. */
	forId?: string;
}

export interface SpatialState {
	status: LoadStatus;
	error?: string;
	size: number;
	grid?: RegionalGrid;
	forKey?: string;
}

export interface AnalysisState {
	open: boolean;
	expanded: boolean;
	picking: boolean;
	latitude?: number;
	longitude?: number;
	source: AnalysisSource;
	omVariable: string;
	omModel: ArchiveModel;
	powerCommunity: PowerCommunity;
	powerTemporal: PowerAnalysisTemporal;
	powerParameter: string;
	startYear: number;
	endYear: number;
	baselineStart: number;
	baselineEnd: number;
	status: LoadStatus;
	error?: string;
	series?: AnalysisSeries;
	catalog: PowerCatalogEntry[];
	catalogStatus: LoadStatus;
	catalogError?: string;
	compare: CompareState;
	spatial: SpatialState;
}

const currentYear = new Date().getUTCFullYear();
export const LAST_COMPLETE_YEAR = currentYear - 1;

export const analysisState = writable<AnalysisState>({
	open: false,
	expanded: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
	picking: false,
	source: 'nasa-power',
	omVariable: 'temperature_2m',
	omModel: 'era5',
	powerCommunity: 'AG',
	powerTemporal: 'daily',
	powerParameter: 'T2M',
	startYear: POWER_START_YEAR,
	endYear: LAST_COMPLETE_YEAR,
	baselineStart: CLIMATOLOGY_START_YEAR,
	baselineEnd: CLIMATOLOGY_END_YEAR,
	status: 'idle',
	catalog: [],
	catalogStatus: 'idle',
	compare: { status: 'idle' },
	spatial: { status: 'idle', size: 6 }
});

const update = (patch: Partial<AnalysisState>) => analysisState.update((s) => ({ ...s, ...patch }));

export function selectedCatalogEntry(state: AnalysisState): PowerCatalogEntry | undefined {
	return state.catalog.find((entry) => entry.code === state.powerParameter);
}

/** Available year range for the current selection. */
export function yearBounds(state: AnalysisState): { min: number; max: number } {
	if (state.source === 'nasa-power') {
		return {
			min: powerStartYear(state.powerParameter, selectedCatalogEntry(state)?.type),
			max: LAST_COMPLETE_YEAR
		};
	}
	const variable = getArchiveVariable(state.omVariable);
	if (!variable) return { min: 1940, max: LAST_COMPLETE_YEAR };
	const clamped = clampArchivePeriod(variable, state.omModel, 1900, 2100);
	return { min: clamped.startYear, max: clamped.endYear };
}

function clampPeriod(state: AnalysisState, startYear: number, endYear: number) {
	const { min, max } = yearBounds(state);
	let a = Math.max(min, Math.min(max, Math.floor(Math.min(startYear, endYear))));
	let b = Math.max(min, Math.min(max, Math.floor(Math.max(startYear, endYear))));
	if (b - a < 1) {
		a = Math.max(min, b - 1);
		b = Math.min(max, a + 1);
	}
	return { startYear: a, endYear: b };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function loadCatalog(): Promise<void> {
	const s = get(analysisState);
	const community = s.powerCommunity;
	const temporal = s.powerTemporal;
	update({ catalogStatus: 'loading', catalogError: undefined });
	try {
		const catalog = await fetchPowerCatalog(community, temporal);
		const now = get(analysisState);
		if (now.powerCommunity !== community || now.powerTemporal !== temporal) return;
		const exists = catalog.some((c) => c.code === now.powerParameter);
		update({
			catalog,
			catalogStatus: 'ready',
			powerParameter: exists
				? now.powerParameter
				: (catalog.find((c) => c.code === 'T2M')?.code ?? catalog[0]?.code ?? 'T2M')
		});
		// Coverage depends on the parameter type (solar from 1984, IMERG from 2001).
		const after = get(analysisState);
		update(clampPeriod(after, after.startYear, after.endYear));
	} catch (e) {
		update({
			catalogStatus: 'error',
			catalogError: e instanceof Error ? e.message : 'Could not load the POWER parameter catalog.'
		});
	}
}

// ---------------------------------------------------------------------------
// Primary series
// ---------------------------------------------------------------------------

let seq = 0;

export async function loadAnalysis(): Promise<void> {
	const s = get(analysisState);
	if (s.latitude === undefined || s.longitude === undefined) return;
	const id = ++seq;
	update({ status: 'loading', error: undefined });
	try {
		let series: AnalysisSeries;
		if (s.source === 'nasa-power') {
			if (s.catalogStatus !== 'ready') await loadCatalog();
			const now = get(analysisState);
			series = await fetchPowerAnalysisSeries({
				community: now.powerCommunity,
				temporal: now.powerTemporal,
				code: now.powerParameter,
				latitude: s.latitude,
				longitude: s.longitude,
				endYear: LAST_COMPLETE_YEAR,
				catalogEntry: selectedCatalogEntry(now)
			});
		} else {
			// One request covers the period and the baseline (when the model reaches it).
			const { min, max } = yearBounds(s);
			const from = Math.max(min, Math.min(s.startYear, s.baselineStart));
			const to = Math.min(max, Math.max(s.endYear, s.baselineEnd));
			series = await fetchOpenMeteoAnalysisSeries(
				s.omVariable,
				s.omModel,
				s.latitude,
				s.longitude,
				from,
				to
			);
		}
		if (id !== seq) return;
		const now = get(analysisState);
		const compareStale = now.compare.forId !== series.id;
		update({
			status: 'ready',
			series,
			error: undefined,
			compare: compareStale ? { status: 'idle' } : now.compare
		});
	} catch (e) {
		if (id !== seq) return;
		update({
			status: 'error',
			series: undefined,
			error: e instanceof Error ? e.message : 'Failed to load data.'
		});
	}
}

// ---------------------------------------------------------------------------
// Comparison (POWER ↔ ERA5)
// ---------------------------------------------------------------------------

export function comparePairFor(state: AnalysisState): ComparePair | undefined {
	if (state.source === 'nasa-power') return comparePairForPower(state.powerParameter);
	const variable = getArchiveVariable(state.omVariable);
	if (!variable || variable.endpoint !== 'archive') return undefined;
	const daily = dailyAggregateFor(variable.name);
	if (!daily || state.series?.resolution !== 'daily') return undefined;
	return comparePairForOpenMeteo(daily.name);
}

export async function loadCompare(): Promise<void> {
	const s = get(analysisState);
	const primary = s.series;
	if (!primary || s.latitude === undefined || s.longitude === undefined) return;
	const pair = comparePairFor(s);
	if (!pair) {
		update({ compare: { status: 'error', error: 'No equivalent parameter in the other source.' } });
		return;
	}
	if (s.compare.forId === primary.id && s.compare.status === 'ready') return;
	update({ compare: { status: 'loading', pair, forId: primary.id } });
	try {
		let secondary: AnalysisSeries;
		const first = new Date(primary.points[0].time).getUTCFullYear();
		const last = new Date(primary.points[primary.points.length - 1].time).getUTCFullYear();
		if (primary.source === 'nasa-power') {
			const era5 = await fetchEra5Daily(
				pair.openMeteo,
				primary.latitude,
				primary.longitude,
				Math.max(1940, first),
				last
			);
			const factor = pair.toPower(primary.unit);
			secondary = {
				...(era5 as AnalysisSeries),
				id: `${era5 && (era5 as AnalysisSeries).id}|x${factor}`,
				label: `ERA5 ${pair.openMeteo.replace(/_/g, ' ')}`,
				unit: primary.unit,
				aggregate: primary.aggregate,
				points:
					factor === 1
						? era5.points
						: era5.points.map((p) => ({ time: p.time, value: p.value * factor }))
			};
		} else {
			const power = await fetchPowerAnalysisSeries({
				community: 'AG',
				temporal: 'daily',
				code: pair.power,
				latitude: primary.latitude,
				longitude: primary.longitude,
				endYear: LAST_COMPLETE_YEAR
			});
			const factor = pair.toPower(power.unit);
			secondary = {
				...power,
				id: `${power.id}|/${factor}`,
				label: `NASA POWER ${pair.power}`,
				unit: primary.unit,
				aggregate: primary.aggregate,
				points:
					factor === 1
						? power.points
						: power.points.map((p) => ({ time: p.time, value: p.value / factor }))
			};
		}
		if (get(analysisState).series?.id !== primary.id) return;
		update({ compare: { status: 'ready', pair, series: secondary, forId: primary.id } });
	} catch (e) {
		if (get(analysisState).series?.id !== primary.id) return;
		update({
			compare: {
				status: 'error',
				pair,
				forId: primary.id,
				error: e instanceof Error ? e.message : 'Comparison request failed.'
			}
		});
	}
}

// ---------------------------------------------------------------------------
// Spatial (POWER regional monthly)
// ---------------------------------------------------------------------------

export function spatialKey(state: AnalysisState, size = state.spatial.size): string {
	return [
		state.powerCommunity,
		state.powerParameter,
		state.latitude?.toFixed(2),
		state.longitude?.toFixed(2),
		size,
		state.startYear,
		state.endYear
	].join('|');
}

export async function loadSpatial(size?: number): Promise<void> {
	const s = get(analysisState);
	if (s.source !== 'nasa-power' || s.latitude === undefined || s.longitude === undefined) return;
	const boxSize = size ?? s.spatial.size;
	const key = spatialKey(s, boxSize);
	update({ spatial: { status: 'loading', size: boxSize, forKey: key } });
	try {
		const bounds = regionalBounds(s.latitude, s.longitude, boxSize);
		const grid = await fetchPowerRegionalMonthly(
			s.powerCommunity,
			s.powerParameter,
			bounds,
			s.startYear,
			s.endYear
		);
		if (get(analysisState).spatial.forKey !== key) return;
		update({ spatial: { status: 'ready', size: boxSize, grid, forKey: key } });
	} catch (e) {
		if (get(analysisState).spatial.forKey !== key) return;
		update({
			spatial: {
				status: 'error',
				size: boxSize,
				forKey: key,
				error: e instanceof Error ? e.message : 'Regional request failed.'
			}
		});
	}
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function openAnalysisAt(
	latitude: number,
	longitude: number,
	patch: Partial<AnalysisState> = {}
): void {
	update({ ...patch, open: true, latitude, longitude });
	const s = get(analysisState);
	update(clampPeriod(s, s.startYear, s.endYear));
	if (s.source === 'nasa-power' && s.catalogStatus !== 'ready') void loadCatalog();
	void loadAnalysis();
}

export function closeAnalysis(): void {
	update({ open: false, picking: false });
}

export function setLocation(latitude: number, longitude: number): void {
	update({ latitude, longitude, picking: false });
	void loadAnalysis();
}

export function setSource(source: AnalysisSource): void {
	update({ source });
	const s = get(analysisState);
	update(
		clampPeriod(
			s,
			s.source === 'nasa-power' ? Math.max(s.startYear, POWER_START_YEAR) : s.startYear,
			s.endYear
		)
	);
	if (source === 'nasa-power' && s.catalogStatus !== 'ready') void loadCatalog();
	void loadAnalysis();
}

export function setPowerParameter(code: string): void {
	update({ powerParameter: code });
	const s = get(analysisState);
	update(clampPeriod(s, s.startYear, s.endYear));
	void loadAnalysis();
}

export async function setPowerCommunity(community: PowerCommunity): Promise<void> {
	update({ powerCommunity: community, catalogStatus: 'idle' });
	await loadCatalog();
	void loadAnalysis();
}

export async function setPowerTemporal(temporal: PowerAnalysisTemporal): Promise<void> {
	update({ powerTemporal: temporal, catalogStatus: 'idle' });
	await loadCatalog();
	void loadAnalysis();
}

export function setOmVariable(name: string): void {
	update({ omVariable: name });
	const s = get(analysisState);
	update(clampPeriod(s, s.startYear, s.endYear));
	void loadAnalysis();
}

export function setOmModel(model: ArchiveModel): void {
	update({ omModel: model });
	const s = get(analysisState);
	update(clampPeriod(s, s.startYear, s.endYear));
	void loadAnalysis();
}

/** Period changes for POWER are a client-side slice; Open-Meteo may refetch. */
export function setPeriod(startYear: number, endYear: number): void {
	const s = get(analysisState);
	update(clampPeriod(s, startYear, endYear));
	if (s.source === 'open-meteo') void loadAnalysis();
}

export function setBaseline(startYear: number, endYear: number): void {
	update({ baselineStart: startYear, baselineEnd: endYear });
	if (get(analysisState).source === 'open-meteo') void loadAnalysis();
}

export function toggleExpanded(): void {
	analysisState.update((s) => ({ ...s, expanded: !s.expanded }));
}
