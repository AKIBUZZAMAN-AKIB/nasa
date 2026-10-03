import { describe, expect, it } from 'vitest';

import {
	POWER_LIMITS,
	type PowerTemporalRequest,
	buildPowerApplicationUrl,
	buildPowerTemporalUrl,
	makePowerWindrosePlotUrl,
	powerJsonError,
	powerSeriesFromResponse,
	powerSurfaceDetailUrl,
	validatePowerApplicationRequest,
	validatePowerCoverageRange,
	validatePowerTemporalRequest
} from '../nasa-power';

const basePointRequest: PowerTemporalRequest = {
	temporal: 'daily',
	spatial: 'point',
	community: 'AG',
	parameters: ['T2M'],
	latitude: 23.81,
	longitude: 90.41,
	start: '2024-01-01',
	end: '2024-01-03',
	format: 'JSON',
	units: 'metric',
	timeStandard: 'lst',
	user: '  research-ui  '
};

describe('NASA POWER temporal requests', () => {
	it('builds a point URL using the documented path and normalized date format', () => {
		const url = buildPowerTemporalUrl(basePointRequest);
		expect(url.pathname).toBe('/api/temporal/daily/point');
		expect(url.searchParams.get('parameters')).toBe('T2M');
		expect(url.searchParams.get('community')).toBe('ag');
		expect(url.searchParams.get('start')).toBe('20240101');
		expect(url.searchParams.get('end')).toBe('20240103');
		expect(url.searchParams.get('format')).toBe('json');
		expect(url.searchParams.get('user')).toBe('research-ui');
	});

	it('rejects reversed calendar dates instead of comparing them as numbers', () => {
		const result = validatePowerTemporalRequest({
			...basePointRequest,
			start: '2024-12-01',
			end: '2024-02-01'
		});
		expect(result.valid).toBe(false);
		expect(result.error).toContain('earlier');
	});

	it('enforces POWER regional span and single-parameter limits', () => {
		const bounds = { latitudeMin: 22, latitudeMax: 24, longitudeMin: 89, longitudeMax: 91 };
		expect(POWER_LIMITS.minimumRegionalSpanDegrees).toBe(2);
		expect(
			validatePowerTemporalRequest({
				...basePointRequest,
				spatial: 'regional',
				bounds
			}).valid
		).toBe(true);
		expect(
			validatePowerTemporalRequest({
				...basePointRequest,
				spatial: 'regional',
				bounds: { ...bounds, latitudeMax: 23.99 }
			}).error
		).toContain('2° latitude');
		expect(
			validatePowerTemporalRequest({
				...basePointRequest,
				spatial: 'regional',
				bounds,
				parameters: ['T2M', 'PRECTOTCORR']
			}).error
		).toContain('at most 1');
	});

	it('rejects hourly regional queries and more than 15 hourly point parameters', () => {
		expect(
			validatePowerTemporalRequest({
				...basePointRequest,
				temporal: 'hourly',
				spatial: 'regional',
				bounds: { latitudeMin: 22, latitudeMax: 24, longitudeMin: 89, longitudeMax: 91 }
			}).valid
		).toBe(false);
		expect(POWER_LIMITS.hourlyPointParameters).toBe(15);
		expect(
			validatePowerTemporalRequest({
				...basePointRequest,
				temporal: 'hourly',
				parameters: Array.from({ length: 16 }, (_, index) => `P${index}`)
			}).error
		).toContain('15');
	});

	it('requires whole-calendar-year SRW windows and omits ignored unit/time options', () => {
		const request: PowerTemporalRequest = {
			...basePointRequest,
			temporal: 'hourly',
			start: '2025-01-01',
			end: '2025-12-31',
			format: 'SRW',
			units: 'imperial',
			timeStandard: 'lst',
			header: false
		};
		const url = buildPowerTemporalUrl(request);
		expect(url.searchParams.get('start')).toBe('20250101');
		expect(url.searchParams.get('end')).toBe('20251231');
		expect(url.searchParams.has('units')).toBe(false);
		expect(url.searchParams.has('time-standard')).toBe(false);
		expect(url.searchParams.has('header')).toBe(false);
		const samUrl = buildPowerTemporalUrl({ ...request, format: 'SAM', end: '2025-01-02' });
		expect(samUrl.searchParams.has('units')).toBe(false);
		expect(samUrl.searchParams.has('time-standard')).toBe(false);
		expect(samUrl.searchParams.has('header')).toBe(false);
		expect(validatePowerTemporalRequest({ ...request, start: '2025-02-01' }).error).toContain(
			'January 1'
		);
		expect(validatePowerTemporalRequest({ ...request, end: '2025-12-30' }).error).toContain(
			'December 31'
		);
	});

	it('omits start/end for the precomputed climatology normal', () => {
		const url = buildPowerTemporalUrl({
			...basePointRequest,
			temporal: 'climatology',
			start: undefined,
			end: undefined,
			customClimatology: false,
			timeStandard: 'utc'
		});
		expect(url.pathname).toBe('/api/temporal/climatology/point');
		expect(url.searchParams.get('time-standard')).toBe('utc');
		expect(url.searchParams.has('start')).toBe(false);
		expect(url.searchParams.has('end')).toBe(false);
	});

	it('enforces the live documented two-year minimum for custom climatology', () => {
		const request = {
			...basePointRequest,
			temporal: 'climatology' as const,
			start: '2024',
			end: '2024',
			customClimatology: true
		};
		expect(validatePowerTemporalRequest(request).error).toContain('at least two years');
		expect(validatePowerTemporalRequest({ ...request, end: '2025' }).valid).toBe(true);
	});

	it('checks date and year ranges against live configuration boundaries', () => {
		expect(
			validatePowerCoverageRange(
				'2027-01-01',
				'2027-01-07',
				'2001-01-01T00:00:00',
				'2026-10-03T00:00:00',
				'date',
				'NASA POWER Daily'
			).error
		).toContain('2026-10-03');
		expect(
			validatePowerCoverageRange('2026', '2026', '1981-01-01', '2026-10-31', 'year').valid
		).toBe(true);
		expect(
			validatePowerCoverageRange('2026', '2026', '2001-01-01', '2025-12-31', 'year').error
		).toContain('2025');
	});
});

describe('NASA POWER system APIs', () => {
	it('builds the documented Manager surface alias detail URL safely', () => {
		const url = powerSurfaceDetailUrl('vegtype_1');
		expect(url.pathname).toBe('/api/system/manager/surface/vegtype_1');
	});
});

describe('NASA POWER application APIs', () => {
	it('normalizes Windrose dates and points at the JSON endpoint', () => {
		const url = buildPowerApplicationUrl({
			application: 'windrose',
			latitude: 23.81,
			longitude: 90.41,
			start: '2010-01-01',
			end: '2014-12-31',
			format: 'JSON',
			units: 'metric',
			timeStandard: 'lst',
			user: 'windrose-test'
		});
		expect(url.pathname).toBe('/api/application/windrose/point');
		expect(url.searchParams.get('start')).toBe('20100101');
		expect(url.searchParams.get('end')).toBe('20141231');
		expect(url.searchParams.get('time-standard')).toBe('lst');
		expect(url.searchParams.get('user')).toBe('windrose-test');
	});

	it('keeps NASA Windrose plot on its separate HTML path', () => {
		const url = makePowerWindrosePlotUrl(
			23.81,
			90.41,
			'2010-01-01',
			'2014-12-31',
			'dark',
			'imperial',
			'utc',
			'plot-user'
		);
		expect(url.pathname).toBe('/api/application/windrose/plot');
		expect(url.searchParams.get('format')).toBe('html');
		expect(url.searchParams.get('theme')).toBe('dark');
		expect(url.searchParams.get('user')).toBe('plot-user');
	});

	it('enforces Zones regional 5-degree bounds and two-year minimum', () => {
		const base = {
			application: 'zones' as const,
			spatial: 'regional' as const,
			bounds: { latitudeMin: 20, latitudeMax: 25, longitudeMin: 85, longitudeMax: 90 },
			start: '1984',
			end: '1985',
			format: 'netcdf'
		};
		expect(validatePowerApplicationRequest(base).valid).toBe(true);
		expect(validatePowerApplicationRequest({ ...base, end: '1984' }).error).toContain('two years');
		expect(
			validatePowerApplicationRequest({
				...base,
				bounds: { ...base.bounds, latitudeMax: 24.99 }
			}).error
		).toContain('5° latitude span');
		expect(
			validatePowerApplicationRequest({
				...base,
				bounds: { ...base.bounds, latitudeMax: 21.5 }
			}).error
		).toContain('5° latitude span');
	});
});

describe('NASA POWER response helpers', () => {
	it('keeps the YYYY13 monthly annual aggregate separate from calendar months', () => {
		const result = powerSeriesFromResponse({
			properties: {
				parameter: { T2M: { '202301': 10, '202302': 12, '202313': 11, '202303': -999 } }
			},
			parameters: { T2M: { longname: 'Temperature at 2 Meters', units: '°C' } },
			header: { fill_value: -999 }
		});
		expect(result).toHaveLength(1);
		expect(result[0].points).toHaveLength(2);
		expect(result[0].annualValue).toBe(11);
		expect(result[0].name).toBe('Temperature at 2 Meters');
	});

	it('orders climatology months by calendar and separates the annual normal', () => {
		const result = powerSeriesFromResponse({
			properties: { parameter: { T2M: { DEC: 8, JAN: 2, FEB: 3, ANN: 5 } } },
			parameters: { T2M: { name: 'Temperature' } }
		});
		expect(result[0].points.map((point) => point.key)).toEqual(['JAN', 'FEB', 'DEC']);
		expect(result[0].annualValue).toBe(5);
	});

	it('identifies POWER JSON API errors without treating Windrose metadata as an error', () => {
		expect(powerJsonError({ header: 'POWER failed', messages: ['Bad request'] })).toContain(
			'Bad request'
		);
		expect(
			powerJsonError({ messages: [{ CLASSES: { WR10M: { CLASS_1: '0–1.5 m/s' } } }] })
		).toBeUndefined();
	});
});
