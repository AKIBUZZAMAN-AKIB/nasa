/**
 * Orchestrates one analysis: load the data, build the seasonal series, run
 * the statistics, check dataset agreement, and write the story.
 */
import {
	type Agreement,
	MIN_YEARS,
	type PairAssociation,
	type Reliability,
	type SeasonalSeries,
	type SpatialSummary,
	type TrendResult,
	analyzeCells,
	analyzeTrend,
	annualOnlySeries,
	assessReliability,
	associate,
	datasetAgreement,
	firstYearOf,
	lastCompleteYear,
	seasonalSeries
} from './analyze';
import { type Season, type Variable, variableById, variableFitsDomain } from './catalog';
import {
	DataError,
	type RegionData,
	loadEra5Monthly,
	loadReferenceMonthly,
	loadRegionData
} from './data';
import { type DriverModel, explainDrivers } from './insights';
import { REGIONS, type Region } from './regions';
import { type Story, buildStory } from './story';

export interface SeriesBundle {
	data: RegionData;
	series: SeasonalSeries;
	available: { first: number; last: number };
	from: number;
	to: number;
}

export interface Analysis extends SeriesBundle {
	variable: Variable;
	region: Region;
	season: Season;
	trend: TrendResult;
	spatial: SpatialSummary | null;
	reliability: Reliability;
	story: Story;
	agreementSeries?: { label: string; series: SeasonalSeries };
}

export interface Request {
	variable: Variable;
	region: Region;
	season: Season;
	from?: number;
	to?: number;
	assetBase: string;
	signal?: AbortSignal;
}

export async function loadSeries(req: Request): Promise<SeriesBundle> {
	const { variable, region, season } = req;
	const data = await loadRegionData(variable, region, req.assetBase, req.signal);
	let first: number | undefined;
	let last: number | undefined;
	if (data.annual) {
		const years = [...data.annual.keys()];
		first = Math.min(...years);
		last = Math.max(...years);
	} else {
		first = firstYearOf(data.monthly);
		last = lastCompleteYear(data.monthly, season, variable.agg, variable.minShare ?? 1);
		// A winter season needs the previous December.
		if (first !== undefined && season.decemberNextYear) first += 1;
	}
	if (
		first === undefined ||
		last === undefined ||
		!Number.isFinite(first) ||
		!Number.isFinite(last)
	) {
		throw new DataError(`No ${variable.name.toLowerCase()} data was found for ${region.name}.`);
	}
	const from = Math.max(first, Math.min(req.from ?? first, last));
	const to = Math.min(last, Math.max(req.to ?? last, from));
	const series = data.annual
		? annualOnlySeries(data.annual, from, to)
		: seasonalSeries(data.monthly, season, variable.agg, from, to, variable.minShare);
	return { data, series, available: { first, last }, from, to };
}

async function agreementFor(
	req: Request,
	bundle: SeriesBundle
): Promise<{ agreement: Agreement; series?: SeasonalSeries }> {
	const spec = req.variable.agreement;
	if (!spec) return { agreement: datasetAgreement('another dataset', bundle.series, null) };
	try {
		if (spec.kind === 'reference') {
			if (req.region.group === 'Custom') {
				// A tapped point has no precomputed series: ask ERA5 for that one point.
				return era5Agreement(req, bundle, spec.era5, spec.era5Label);
			}
			try {
				const monthly = await loadReferenceMonthly(
					spec.key,
					req.variable.agg,
					req.region,
					req.assetBase,
					req.signal
				);
				const series = seasonalSeries(
					monthly,
					req.season,
					req.variable.agg,
					bundle.from,
					bundle.to
				);
				return { agreement: datasetAgreement(spec.label, bundle.series, series), series };
			} catch (e) {
				if ((e as Error).name === 'AbortError') throw e;
				return era5Agreement(req, bundle, spec.era5, spec.era5Label);
			}
		}
		if (spec.kind === 'era5') return era5Agreement(req, bundle, spec.variable, spec.label);
		const other = variableById(spec.variableId);
		if (!other) throw new Error('unknown variable');
		const otherBundle = await loadSeries({
			...req,
			variable: other,
			from: bundle.from,
			to: bundle.to
		});
		return {
			agreement: datasetAgreement(spec.label, bundle.series, otherBundle.series),
			series: otherBundle.series
		};
	} catch (e) {
		if ((e as Error).name === 'AbortError') throw e;
		return {
			agreement: {
				label: spec.label,
				level: 'Not available',
				reason: `${spec.label} could not be loaded for this region (${(e as Error).message}).`
			}
		};
	}
}

async function era5Agreement(
	req: Request,
	bundle: SeriesBundle,
	era5Variable: string,
	label: string
): Promise<{ agreement: Agreement; series?: SeasonalSeries }> {
	try {
		const monthly = await loadEra5Monthly(
			era5Variable,
			req.variable.agg,
			req.region,
			Math.max(1981, bundle.from - 1),
			req.signal
		);
		const series = seasonalSeries(monthly, req.season, req.variable.agg, bundle.from, bundle.to);
		return { agreement: datasetAgreement(label, bundle.series, series), series };
	} catch (e) {
		if ((e as Error).name === 'AbortError') throw e;
		const msg = (e as Error).message;
		return {
			agreement: {
				label,
				level: 'Not available',
				reason: /429/.test(msg)
					? `${label} is busy (free-tier request limit). Try again in a minute.`
					: `${label} could not be loaded for this region (${msg}).`
			}
		};
	}
}

export async function runAnalysis(req: Request): Promise<Analysis> {
	const bundle = await loadSeries(req);
	const trend = analyzeTrend(bundle.series);
	if (!trend) {
		const valid = bundle.series.values.filter((v) => v !== null).length;
		throw new DataError(
			`Only ${valid} usable years in ${bundle.from}–${bundle.to}; at least ${MIN_YEARS} are needed for a trend test. Choose a longer period or a different season.`
		);
	}
	const [{ agreement, series: agreementSeries }] = await Promise.all([agreementFor(req, bundle)]);
	const spatial =
		bundle.data.cells && bundle.data.cells.length > 1
			? analyzeCells(bundle.data.cells, req.season, req.variable.agg, bundle.from, bundle.to)
			: null;
	const reliability = assessReliability(trend, bundle.series, agreement);
	const story = buildStory(req.variable, req.region, req.season, trend, reliability, spatial);
	return {
		...bundle,
		variable: req.variable,
		region: req.region,
		season: req.season,
		trend,
		spatial,
		reliability,
		story,
		agreementSeries: agreementSeries
			? { label: agreement.label, series: agreementSeries }
			: undefined
	};
}

export interface CompareItem {
	variable: Variable;
	series?: SeasonalSeries;
	trend: TrendResult | null;
	error?: string;
}

export interface Comparison {
	items: CompareItem[];
	pairs: PairAssociation[];
	/** Explainable model of which related variables help predict the year-to-year swings. */
	drivers: DriverModel | null;
}

/** Analyse several variables over the same region, season and years, and their associations. */
export async function compareVariables(
	base: Analysis,
	variables: Variable[],
	assetBase: string,
	signal?: AbortSignal
): Promise<Comparison> {
	const items: CompareItem[] = [
		{ variable: base.variable, series: base.series, trend: base.trend }
	];
	const others = await Promise.all(
		variables.map(async (variable): Promise<CompareItem> => {
			try {
				const b = await loadSeries({
					variable,
					region: base.region,
					season: base.season,
					from: base.from,
					to: base.to,
					assetBase,
					signal
				});
				return { variable, series: b.series, trend: analyzeTrend(b.series) };
			} catch (e) {
				if ((e as Error).name === 'AbortError') throw e;
				return { variable, trend: null, error: (e as Error).message };
			}
		})
	);
	items.push(...others);
	const pairs = associate(
		items
			.filter((i) => i.series)
			.map((i) => ({ id: i.variable.id, years: i.series!.years, values: i.series!.values }))
	);
	const withData = items.filter((i) => i.series);
	const drivers =
		withData.length > 1 && withData[0].variable.id === base.variable.id
			? explainDrivers(
					{ id: base.variable.id, years: base.series.years, values: base.series.values },
					withData
						.slice(1)
						.map((i) => ({ id: i.variable.id, years: i.series!.years, values: i.series!.values }))
				)
			: null;
	return { items, pairs, drivers };
}

/** Regions where a variable can be analysed. */
export function regionsFor(variable: Variable): Region[] {
	return REGIONS.filter((r) => {
		if (!variableFitsDomain(variable, r.domain)) return false;
		if (variable.missingRegions?.includes(r.id)) return false;
		if (variable.source.kind === 'sample') return r.sampleSites.length > 0;
		if (variable.source.kind === 'regional') return variable.source.regions.includes(r.id);
		return true;
	});
}

/** Variables that make sense to compare with this one in this region. */
export function compareSuggestions(variable: Variable, region: Region): Variable[] {
	const byId = (ids: string[]) =>
		ids
			.filter((id) => id !== variable.id)
			.map((id) => variableById(id)!)
			.filter(
				(v) =>
					v &&
					(regionsFor(v).some((r) => r.id === region.id) ||
						(region.group === 'Custom' &&
							v.source.kind !== 'sample' &&
							v.source.kind !== 'regional'))
			);
	if (region.domain === 'ocean')
		return byId(['sst_merra', 'sst_mur', 'chl', 'rain_merra', 'rain_imerg']);
	if (region.domain === 'arctic') return [];
	if (region.group === 'Himalaya')
		return byId(['gistemp', 't2m', 'snow_cover', 'snow_depth', 'frost_days', 'rain_merra']);
	return byId([
		'gistemp',
		'rain_imerg',
		'soil_root',
		'ndvi',
		't2m',
		't2m_max',
		'rain_merra',
		'soil_top',
		'evap',
		'ts',
		'npp',
		'rh2m',
		'aod'
	]);
}
