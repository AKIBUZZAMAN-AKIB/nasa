import { describe, expect, it } from 'vitest';

import {
	COMPARE_PAIRS,
	buildPowerAnalysisUrl,
	comparePairForOpenMeteo,
	comparePairForPower,
	openMeteoAggregateKind,
	parsePowerCatalog,
	parsePowerPointSeries,
	parseRegionalMonthly,
	powerAggregateKind,
	powerParameterNotes,
	powerStartYear,
	powerTheme,
	regionalBounds
} from '$lib/analysis/sources';
import { cellStatistics, shareWithChangePoint } from '$lib/analysis/spatial';

describe('POWER aggregation semantics', () => {
	it('classifies parameters by unit and code', () => {
		expect(powerAggregateKind('T2M', 'C')).toBe('mean');
		expect(powerAggregateKind('PRECTOTCORR', 'mm/day')).toBe('rate');
		expect(powerAggregateKind('IMERG_PRECTOT', 'mm/day')).toBe('rate');
		expect(powerAggregateKind('PRECTOTCORR_SUM', 'mm/day')).toBe('count');
		expect(powerAggregateKind('CDD10', 'degree-day-c')).toBe('count');
		expect(powerAggregateKind('FROST_DAYS', 'Days')).toBe('count');
		expect(powerAggregateKind('WD10M', 'Degrees')).toBe('circular');
		expect(powerAggregateKind('SZA', 'Degrees')).toBe('mean');
	});
	it('knows record start years', () => {
		expect(powerStartYear('T2M', 'METEOROLOGY')).toBe(1981);
		expect(powerStartYear('ALLSKY_SFC_SW_DWN', 'RADIATION')).toBe(1984);
		expect(powerStartYear('IMERG_PRECTOT', 'METEOROLOGY')).toBe(2001);
	});
	it('warns about the 2001 solar source change and Bengal inhomogeneity', () => {
		const solar = powerParameterNotes('ALLSKY_SFC_SW_DWN', 'RADIATION', 1984, 2025, 48, 2);
		expect(solar.join(' ')).toMatch(/SRB → CERES/);
		const dhaka = powerParameterNotes('T2M', 'METEOROLOGY', 1981, 2025, 23.8, 90.4);
		expect(dhaka.join(' ')).toMatch(/1997–2001/);
		const paris = powerParameterNotes('T2M', 'METEOROLOGY', 1981, 2025, 48.9, 2.35);
		expect(paris.join(' ')).not.toMatch(/1997–2001/);
	});
	it('maps Open-Meteo variables to aggregation kinds', () => {
		expect(openMeteoAggregateKind('precipitation', 'daily')).toBe('rate');
		expect(openMeteoAggregateKind('shortwave_radiation', 'daily')).toBe('mean');
		expect(openMeteoAggregateKind('wind_direction_10m', 'daily')).toBe('circular');
		expect(openMeteoAggregateKind('temperature_2m', 'daily')).toBe('mean');
	});
});

describe('POWER parsing', () => {
	it('parses the catalog and drops calculated parameters', () => {
		const catalog = parsePowerCatalog({
			T2M: {
				type: 'METEOROLOGY',
				name: 'Temperature at 2 Meters',
				units: 'C',
				definition: 'd',
				calculated: false
			},
			PSC: {
				type: 'METEOROLOGY',
				name: 'Corrected Atmospheric Pressure',
				units: 'kPa',
				calculated: true
			}
		});
		expect(catalog.map((c) => c.code)).toEqual(['T2M']);
	});

	it('parses daily points, skipping fill values', () => {
		const parsed = parsePowerPointSeries(
			{
				geometry: { coordinates: [90.4, 23.8, 9.5] },
				header: { fill_value: -999, sources: ['MERRA2'] },
				parameters: { T2M: { units: 'C', longname: 'Temperature at 2 Meters' } },
				properties: { parameter: { T2M: { '19810102': 18.5, '19810101': 18.2, '19810103': -999 } } }
			},
			'T2M',
			'daily'
		);
		expect(parsed.points.map((p) => p.value)).toEqual([18.2, 18.5]);
		expect(parsed.totalCount).toBe(3);
		expect(parsed.missingCount).toBe(1);
		expect(parsed.elevation).toBe(9.5);
		expect(parsed.sources).toEqual(['MERRA2']);
	});

	it('ignores the monthly annual key (MM = 13)', () => {
		const parsed = parsePowerPointSeries(
			{ properties: { parameter: { T2M: { '202001': 18, '202002': 21, '202013': 26 } } } },
			'T2M',
			'monthly'
		);
		expect(parsed.points).toHaveLength(2);
		expect(new Date(parsed.points[1].time).getUTCMonth()).toBe(1);
	});

	it('builds a full-record UTC point URL', () => {
		const url = buildPowerAnalysisUrl('AG', 'daily', 'T2M', 23.81, 90.41, 1981, 2025);
		expect(url.pathname).toBe('/api/temporal/daily/point');
		expect(url.searchParams.get('start')).toBe('19810101');
		expect(url.searchParams.get('end')).toBe('20251231');
		expect(url.searchParams.get('time-standard')).toBe('utc');
		expect(url.searchParams.get('community')).toBe('ag');
		const monthly = buildPowerAnalysisUrl('RE', 'monthly', 'T2M', 0, 0, 1981, 2025);
		expect(monthly.searchParams.get('start')).toBe('1981');
	});
});

describe('POWER regional grid', () => {
	it('clamps the box to the globe and to the 10° limit', () => {
		expect(regionalBounds(23.8, 90.4, 6)).toEqual({
			latitudeMin: 20.8,
			latitudeMax: 26.8,
			longitudeMin: 87.4,
			longitudeMax: 93.4
		});
		const polar = regionalBounds(89, 179, 20);
		expect(polar.latitudeMax).toBe(90);
		expect(polar.latitudeMax - polar.latitudeMin).toBe(10);
		expect(polar.longitudeMax).toBe(180);
	});

	it('parses features, infers grid steps and computes cell statistics', () => {
		const features = [];
		for (const lat of [22, 22.5, 23]) {
			for (const lon of [90, 90.625, 91.25]) {
				const values: Record<string, number> = {};
				for (let y = 1981; y <= 2010; y++) {
					for (let m = 1; m <= 12; m++)
						values[`${y}${String(m).padStart(2, '0')}`] = 25 + (y >= 1998 ? 1 : 0);
					values[`${y}13`] = 25;
				}
				features.push({
					geometry: { coordinates: [lon, lat] },
					properties: { parameter: { T2M: values } }
				});
			}
		}
		const grid = parseRegionalMonthly(
			{ features, header: { fill_value: -999 } },
			'T2M',
			regionalBounds(22.5, 90.6, 2)
		);
		expect(grid.cells).toHaveLength(9);
		expect(grid.latStep).toBeCloseTo(0.5);
		expect(grid.lonStep).toBeCloseTo(0.625);
		const stats = cellStatistics(grid, 'mean', 1981, 2010);
		expect(stats[0].years).toBe(30);
		expect(stats[0].changeYear).toBe(1998);
		expect(shareWithChangePoint(stats)).toBe(1);
	});
});

describe('POWER ↔ ERA5 pairs', () => {
	it('converts units into POWER units', () => {
		expect(comparePairForPower('WS10M')!.toPower('m/s')).toBeCloseTo(1 / 3.6);
		expect(comparePairForPower('PS')!.toPower('kPa')).toBe(0.1);
		expect(comparePairForPower('ALLSKY_SFC_SW_DWN')!.toPower('MJ/m^2/day')).toBe(1);
		expect(comparePairForPower('ALLSKY_SFC_SW_DWN')!.toPower('kW-hr/m^2/day')).toBeCloseTo(1 / 3.6);
	});
	it('maps Open-Meteo daily names back to POWER', () => {
		expect(comparePairForOpenMeteo('precipitation_sum')!.power).toBe('PRECTOTCORR');
		expect(comparePairForOpenMeteo('temperature_2m_mean')!.power).toBe('T2M');
		expect(comparePairForOpenMeteo('wind_speed_10m_max')!.power).toBe('WS10M_MAX');
		expect(comparePairForOpenMeteo('soil_moisture_0_to_7cm_mean')).toBeUndefined();
	});
	it('has unique POWER codes', () => {
		const codes = COMPARE_PAIRS.map((p) => p.power);
		expect(new Set(codes).size).toBe(codes.length);
	});
});

describe('POWER parameter themes', () => {
	it('groups codes the way users look for them', () => {
		const cases: [string, string][] = [
			['T2M', 'temperature'],
			['T2M_MAX', 'temperature'],
			['T10M_RANGE', 'temperature'],
			['TS', 'temperature'],
			['TS_ADJ', 'temperature'],
			['TSURF', 'temperature'],
			['T2MDEW', 'humidity'],
			['T2MWET', 'humidity'],
			['RH2M', 'humidity'],
			['QV2M', 'humidity'],
			['PRECTOTCORR', 'precipitation'],
			['PRECTOTCORR_SUM', 'precipitation'],
			['IMERG_PRECTOT', 'precipitation'],
			['SNODP', 'precipitation'],
			['WS10M', 'wind'],
			['WD50M', 'wind'],
			['U2M', 'wind'],
			['ALLSKY_SFC_SW_DWN', 'radiation'],
			['CLRSKY_SFC_PAR_TOT', 'radiation'],
			['TOA_SW_DWN', 'radiation'],
			['ALLSKY_SRF_ALB', 'radiation'],
			['CLOUD_AMT', 'cloud'],
			['CLOUD_TT_MAX', 'cloud'],
			['GWETROOT', 'soil'],
			['TSOIL3', 'soil'],
			['EVLAND', 'soil'],
			['PS', 'atmosphere'],
			['TROPT', 'atmosphere'],
			['AOD_55', 'atmosphere'],
			['CDD18_3', 'indices'],
			['GDD10', 'indices'],
			['FROST_DAYS', 'indices'],
			['CLRSKY_DAYS', 'indices'],
			['PS_07', 'atmosphere'],
			['T2M_HR', 'temperature'],
			['SG_SZA_03', 'radiation']
		];
		for (const [code, theme] of cases) expect(powerTheme(code), code).toBe(theme);
	});
});
