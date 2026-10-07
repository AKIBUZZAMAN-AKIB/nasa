/**
 * Per-grid-cell trend statistics for a NASA POWER regional monthly request.
 * Each cell gets the same treatment as the point analysis: monthly → annual
 * aggregation with completeness, Sen's slope + Mann-Kendall, and a Pettitt
 * change point, so a map of change-point years can expose inhomogeneities
 * (for example a reanalysis input change) that a single point cannot.
 */
import {
	type AggregateKind,
	aggregateAnnual,
	aggregateMonthly,
	meanOf,
	pettitt,
	senTrend
} from './analysis-stats';

import type { RegionalGrid } from './sources';

export type SpatialMetric = 'sen' | 'mean' | 'changeYear' | 'shift';

export interface CellStatistic {
	latitude: number;
	longitude: number;
	years: number;
	mean: number;
	senPerDecade: number;
	mkPValue: number;
	changeYear?: number;
	changePValue?: number;
	shift?: number;
}

export function cellStatistics(
	grid: RegionalGrid,
	kind: AggregateKind,
	startYear: number,
	endYear: number
): CellStatistic[] {
	const out: CellStatistic[] = [];
	for (const cell of grid.cells) {
		const months = aggregateMonthly(cell.points, 'monthly', kind);
		const annual = aggregateAnnual(months, kind).filter(
			(a) => a.complete && a.year >= startYear && a.year <= endYear
		);
		const years = annual.map((a) => a.year);
		const values = annual.map((a) => a.value);
		const sen = senTrend(years, values);
		const cp = pettitt(values);
		out.push({
			latitude: cell.latitude,
			longitude: cell.longitude,
			years: years.length,
			mean: meanOf(values),
			senPerDecade: sen?.senSlopePerDecade ?? NaN,
			mkPValue: sen?.pValue ?? NaN,
			changeYear: cp ? years[cp.index + 1] : undefined,
			changePValue: cp?.pValue,
			shift: cp?.shift
		});
	}
	return out;
}

export function metricValue(cell: CellStatistic, metric: SpatialMetric): number {
	switch (metric) {
		case 'sen':
			return cell.senPerDecade;
		case 'mean':
			return cell.mean;
		case 'changeYear':
			return cell.changeYear ?? NaN;
		case 'shift':
			return cell.shift ?? NaN;
	}
}

/** Fraction of cells with a significant (p < 0.05) Pettitt change point. */
export function shareWithChangePoint(cells: readonly CellStatistic[]): number {
	const valid = cells.filter((c) => c.changePValue !== undefined);
	if (!valid.length) return NaN;
	return valid.filter((c) => (c.changePValue ?? 1) < 0.05).length / valid.length;
}
