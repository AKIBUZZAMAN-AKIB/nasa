import { describe, expect, it } from 'vitest';

import {
	GIBS_CATEGORIES,
	GIBS_LAYERS,
	GIBS_URL_DATE_PARAM,
	GIBS_URL_LAYER_PARAM,
	type GibsAvailabilityRange,
	describeCoverage,
	formatGibsDay,
	gibsLayerById,
	gibsLayersByCategory,
	gibsRibbonFraction,
	gibsRibbonSegments,
	gibsTileUrl,
	gibsUrlParams,
	gibsWorldviewUrl,
	isoDayAtNoon,
	isoDayDiff,
	isoDayOf,
	latestAvailableDay,
	parseGibsAvailability,
	parseGibsUrl,
	resolveAvailableDay,
	shiftIsoDay,
	snapToPeriod
} from '$lib/gibs';
import {
	GIBS_DATASETS,
	gibsDatasetLabel,
	gibsDatasetOf,
	gibsDatasetSearchUrl
} from '$lib/gibs-datasets';

/** The service answer for a gappy daily layer (smoothed reference shape). */
const DAILY_XML = `<Domains xmlns:ows='http://www.opengis.net/ows/1.1'><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2000-02-24/2000-04-25/P1D,2000-04-28/2000-08-06/P1D,2025-11-10/2026-09-30/P1D</Domain><Size>3</Size></DimensionDomain></Domains>`;

const range = (start: string, end: string, step = 'P1D'): GibsAvailabilityRange => ({
	start,
	end,
	stepDays: step === 'P16D' ? 16 : 1,
	step
});

describe('parseGibsAvailability', () => {
	it('reads every range and the cadence of each', () => {
		const ranges = parseGibsAvailability(DAILY_XML);
		expect(ranges).toEqual([
			range('2000-02-24', '2000-04-25', 'P1D'),
			range('2000-04-28', '2000-08-06', 'P1D'),
			range('2025-11-10', '2026-09-30', 'P1D')
		]);
	});

	it('understands 16-day and monthly cadences', () => {
		const ranges = parseGibsAvailability(
			'<Domains><Domain>2002-07-04/2002-12-27/P16D</Domain></Domains>'
		);
		expect(ranges[0].stepDays).toBe(16);
		expect(ranges[0].step).toBe('P16D');

		const monthly = parseGibsAvailability(
			'<Domains><Domain>1980-01-01/2023-11-01/P1M</Domain></Domains>'
		);
		expect(monthly[0].step).toBe('P1M');
	});

	it('returns nothing for an empty or malformed answer', () => {
		expect(parseGibsAvailability('<Domains><Domain></Domain></Domains>')).toEqual([]);
		expect(parseGibsAvailability('<ExceptionReport/>')).toEqual([]);
		expect(parseGibsAvailability('<Domains><Domain>nonsense</Domain></Domains>')).toEqual([]);
	});

	it('sorts ranges by start day', () => {
		const ranges = parseGibsAvailability(
			'<Domains><Domain>2020-01-01/2020-02-01/P1D,2010-01-01/2010-02-01/P1D</Domain></Domains>'
		);
		expect(ranges.map((r) => r.start)).toEqual(['2010-01-01', '2020-01-01']);
	});
});

describe('gibsTileUrl', () => {
	it('builds the WMTS template MapLibre expects', () => {
		const layer = gibsLayerById('IMERG_Precipitation_Rate');
		expect(layer).toBeDefined();
		expect(gibsTileUrl(layer!, '2024-08-01')).toBe(
			'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/2024-08-01/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'
		);
	});

	it('keeps the extension of imagery layers', () => {
		const layer = gibsLayerById('MODIS_Terra_CorrectedReflectance_TrueColor');
		expect(gibsTileUrl(layer!, '2020-06-15').endsWith('.jpg')).toBe(true);
	});
});

describe('date helpers', () => {
	it('shifts days across month boundaries', () => {
		expect(shiftIsoDay('2024-03-01', -1)).toBe('2024-02-29');
		expect(shiftIsoDay('2024-12-31', 1)).toBe('2025-01-01');
		expect(isoDayDiff('2024-01-01', '2024-03-01')).toBe(60);
	});

	it('reports the ends of the archive', () => {
		const ranges = parseGibsAvailability(DAILY_XML);
		expect(latestAvailableDay(ranges)).toBe('2026-09-30');
		expect(latestAvailableDay([])).toBeUndefined();
	});
});

describe('snapToPeriod', () => {
	const monthly = gibsLayerById('MERRA2_2m_Air_Temperature_Monthly')!;
	const sixteen = gibsLayerById('MODIS_Terra_L3_NDVI_16Day')!;
	const daily = gibsLayerById('IMERG_Precipitation_Rate')!;

	it('snaps monthly layers to the first of the month', () => {
		expect(snapToPeriod(monthly, '2024-08-17', [])).toBe('2024-08-01');
	});

	it('snaps 16-day layers to the block that holds the day', () => {
		const ranges = [range('2024-01-01', '2024-12-27', 'P16D')];
		expect(snapToPeriod(sixteen, '2024-01-01', ranges)).toBe('2024-01-01');
		expect(snapToPeriod(sixteen, '2024-01-16', ranges)).toBe('2024-01-01');
		expect(snapToPeriod(sixteen, '2024-01-17', ranges)).toBe('2024-01-17');
	});

	it('leaves daily layers untouched', () => {
		expect(snapToPeriod(daily, '2024-08-17', [])).toBe('2024-08-17');
	});
});

describe('resolveAvailableDay', () => {
	const daily = gibsLayerById('IMERG_Precipitation_Rate')!;
	const ranges = parseGibsAvailability(DAILY_XML);

	it('accepts a day inside a covered range', () => {
		expect(resolveAvailableDay(daily, '2000-03-01', ranges)).toBe('2000-03-01');
	});

	it('walks out of a short gap to the nearest day with imagery', () => {
		// 2000-04-26 and 2000-04-27 are missing from the range list (a two-day
		// gap between 2000-04-25 and 2000-04-28).
		expect(resolveAvailableDay(daily, '2000-04-26', ranges)).toBe('2000-04-25');
		expect(resolveAvailableDay(daily, '2000-04-27', ranges)).toBe('2000-04-28');
	});

	it('clamps days outside the archive to its ends', () => {
		expect(resolveAvailableDay(daily, '1990-01-01', ranges)).toBe('2000-02-24');
		expect(resolveAvailableDay(daily, '2030-01-01', ranges)).toBe('2026-09-30');
	});

	it('returns undefined when nothing is published', () => {
		expect(resolveAvailableDay(daily, '2024-01-01', [])).toBeUndefined();
	});

	it('snaps the clamped day of an aggregating layer too', () => {
		const monthly = gibsLayerById('MERRA2_2m_Air_Temperature_Monthly')!;
		const monthlyRanges = [range('1980-01-01', '2024-06-01', 'P1M')];
		expect(resolveAvailableDay(monthly, '2025-09-20', monthlyRanges)).toBe('2024-06-01');
	});
});

describe('describeCoverage', () => {
	it('summarises the archive and its gaps', () => {
		const text = describeCoverage(parseGibsAvailability(DAILY_XML));
		expect(text).toContain('2000-02-24 → 2026-09-30');
		expect(text).toContain('26 yr');
		expect(text).toContain('2 gaps');
	});

	it('handles an empty archive', () => {
		expect(describeCoverage([])).toBe('No imagery published for this layer');
	});
});

describe('the catalogue itself', () => {
	it('has unique ids and a known category', () => {
		const ids = GIBS_LAYERS.map((layer) => layer.id);
		expect(new Set(ids).size).toBe(ids.length);
		const categories = new Set(GIBS_CATEGORIES.map((category) => category.id));
		for (const layer of GIBS_LAYERS) expect(categories.has(layer.category)).toBe(true);
	});

	it('only uses layers from the Web Mercator endpoint with a real TileMatrixSet', () => {
		for (const layer of GIBS_LAYERS) {
			expect(layer.tileMatrixSet).toMatch(/^GoogleMapsCompatible_Level\d+$/);
			expect(layer.coverageStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(['png', 'jpg']).toContain(layer.extension);
			expect(['P1D', 'P16D', 'P1M']).toContain(layer.period);
			if (layer.legend)
				expect(layer.legend.startsWith('https://gibs.earthdata.nasa.gov/')).toBe(true);
		}
	});

	it('groups every layer into a non-empty category', () => {
		for (const category of GIBS_CATEGORIES) {
			expect(gibsLayersByCategory(category.id).length).toBeGreaterThan(0);
		}
	});

	it('links back to Worldview with the layer and the day', () => {
		const layer = gibsLayerById('MODIS_Combined_Flood_1-Day')!;
		const url = gibsWorldviewUrl(layer, '2024-07-01', [88, 20, 93, 27]);
		expect(url).toContain('t=2024-07-01');
		expect(url).toContain('l=MODIS_Combined_Flood_1-Day');
		expect(url).toContain('v=88,20,93,27');
	});
});

describe('gibsRibbonSegments', () => {
	const first = '2000-01-01';
	const last = '2000-01-20';

	it('turns each published span into a fraction of the archive', () => {
		const [whole] = gibsRibbonSegments([range('2000-01-01', '2000-01-10')], first, last);
		expect(whole.left).toBe(0);
		// Ten published days out of a twenty-day span (both ends inclusive).
		expect(whole.width).toBeCloseTo(10 / 20, 6);
	});

	it('puts a later window at its real offset, leaving the gap unpainted', () => {
		const [, second] = gibsRibbonSegments(
			[range('2000-01-01', '2000-01-04'), range('2000-01-15', '2000-01-20')],
			first,
			last
		);
		expect(second.left).toBeCloseTo(14 / 20, 6);
		expect(second.left + second.width).toBeCloseTo(1, 6);
	});

	it('never collapses a single-day window to zero width', () => {
		const [only] = gibsRibbonSegments([range('2000-01-05', '2000-01-05')], first, last);
		expect(only.width).toBeGreaterThan(0);
	});

	it('handles an archive that fits in one day', () => {
		const [only] = gibsRibbonSegments([range('2000-01-01', '2000-01-01')], first, first);
		expect(only).toEqual({ left: 0, width: 1 });
	});
});

describe('gibsRibbonFraction', () => {
	it('marks where the shown day starts on the strip', () => {
		expect(gibsRibbonFraction('2000-01-01', '2000-01-01', '2000-01-20')).toBe(0);
		// The last of twenty days owns the final slice, so it starts at 19/20.
		expect(gibsRibbonFraction('2000-01-20', '2000-01-01', '2000-01-20')).toBeCloseTo(19 / 20, 6);
		expect(gibsRibbonFraction('2000-01-11', '2000-01-01', '2000-01-20')).toBeCloseTo(10 / 20, 6);
	});

	it('clamps days outside the archive instead of drawing outside the bar', () => {
		expect(gibsRibbonFraction('1999-12-01', '2000-01-01', '2000-01-20')).toBe(0);
		expect(gibsRibbonFraction('2000-03-01', '2000-01-01', '2000-01-20')).toBe(1);
	});
});

describe('formatGibsDay', () => {
	it('renders an ISO day in a readable form, independent of the local time zone', () => {
		expect(formatGibsDay('2024-06-15')).toBe('Sat, 15 Jun 2024');
		expect(formatGibsDay('2000-02-24')).toBe('Thu, 24 Feb 2000');
	});
});

describe('citable dataset records', () => {
	it('prefers the science-quality record for a layer', () => {
		const record = gibsDatasetOf('MODIS_Aqua_CorrectedReflectance_TrueColor');
		expect(record?.shortName).toBe('MYD02QKM');
		expect(record?.type).toBe('STD');
	});

	it('returns nothing for an unknown layer instead of guessing', () => {
		expect(gibsDatasetOf('Not_A_Real_Layer')).toBeUndefined();
	});

	it('labels a record with its version and links to Earthdata Search', () => {
		const record = gibsDatasetOf('AIRS_L2_Surface_Air_Temperature_Day')!;
		expect(gibsDatasetLabel(record)).toBe(`${record.shortName} ${record.version}`);
		expect(gibsDatasetSearchUrl(record.cmrId)).toBe(
			`https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(record.cmrId)}`
		);
	});

	it('maps every catalogue layer to at least one CMR concept id', () => {
		for (const layer of GIBS_LAYERS) {
			const records = GIBS_DATASETS[layer.id];
			expect(records?.length ?? 0).toBeGreaterThan(0);
			for (const record of records ?? []) {
				expect(record.cmrId).toMatch(/^C\d+-[A-Z0-9_]+$/);
				expect(record.shortName.length).toBeGreaterThan(0);
			}
		}
		// And the other way round: no dataset record without a catalogue entry.
		for (const layerId of Object.keys(GIBS_DATASETS)) {
			expect(gibsLayerById(layerId)).toBeDefined();
		}
	});
});

describe('shared links', () => {
	const defaultLayerId = 'MODIS_Terra_CorrectedReflectance_TrueColor';
	const day = '2005-07-01';
	const latest = '2026-09-30';

	it('keeps defaults out of the URL so a link follows the archive', () => {
		expect(
			gibsUrlParams({
				browsing: true,
				layerId: defaultLayerId,
				day: latest,
				latest,
				defaultLayerId
			})
		).toEqual({});
	});

	it('carries a non-default layer and day', () => {
		expect(
			gibsUrlParams({
				browsing: true,
				layerId: 'AIRS_L2_Surface_Air_Temperature_Day',
				day,
				latest,
				defaultLayerId
			})
		).toEqual({
			[GIBS_URL_LAYER_PARAM]: 'AIRS_L2_Surface_Air_Temperature_Day',
			[GIBS_URL_DATE_PARAM]: day
		});
	});

	it('writes nothing while the forecast timeline is on screen', () => {
		expect(
			gibsUrlParams({
				browsing: false,
				layerId: 'AIRS_L2_Surface_Air_Temperature_Day',
				day,
				latest,
				defaultLayerId
			})
		).toEqual({});
	});

	it('round-trips a shared view back to the same selection', () => {
		const params = gibsUrlParams({
			browsing: true,
			layerId: 'AIRS_L2_Surface_Air_Temperature_Day',
			day,
			latest,
			defaultLayerId
		});
		const search = `?${new URLSearchParams(params).toString()}`;
		expect(parseGibsUrl(search)).toEqual({
			layerId: 'AIRS_L2_Surface_Air_Temperature_Day',
			day
		});
	});

	it('reads the day off the app clock in UTC', () => {
		expect(isoDayOf(new Date('2024-06-15T23:45:00Z'))).toBe('2024-06-15');
		expect(isoDayOf(new Date('2024-06-15T00:00:00Z'))).toBe('2024-06-15');
	});

	it('turns a day back into a clock value that renders as that day', () => {
		const date = isoDayAtNoon('2013-05-04');
		expect(date.toISOString()).toBe('2013-05-04T12:00:00.000Z');
		// The address bar carries the same day, which is what a shared link
		// restores: `YYYY-MM-DDTHHMM`.
		expect(isoDayOf(date)).toBe('2013-05-04');
	});

	it('ignores unknown layers and impossible days instead of failing', () => {
		expect(parseGibsUrl('')).toEqual({ layerId: undefined, day: undefined });
		expect(parseGibsUrl('?gibs=Not_A_Layer')).toEqual({ layerId: undefined, day: undefined });
		// 2011-02-30 has the right shape but is not a real day.
		expect(parseGibsUrl('?gibs-date=2011-02-30')).toEqual({ layerId: undefined, day: undefined });
		expect(parseGibsUrl('?gibs-date=1999-01-01')).toEqual({
			layerId: undefined,
			day: '1999-01-01'
		});
	});
});
