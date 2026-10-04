/**
 * NASA POWER REST API request builders and response helpers.
 *
 * Options and output formats are read from POWER's live configuration and
 * OpenAPI endpoints in the UI. The builders below mirror the currently
 * documented v2 endpoints and validate constraints that NASA's API otherwise
 * returns as HTTP 422 responses.
 */
export const NASA_POWER_ORIGIN = 'https://power.larc.nasa.gov';
export const NASA_POWER_API = `${NASA_POWER_ORIGIN}/api`;
export const NASA_POWER_DOCS = 'https://power.larc.nasa.gov/docs/services/api/';
export const NASA_POWER_SWAGGER = 'https://power.larc.nasa.gov/api/pages/';

export const POWER_TEMPORALS = ['hourly', 'daily', 'monthly', 'climatology'] as const;
export type PowerTemporal = (typeof POWER_TEMPORALS)[number];

export const POWER_COMMUNITIES = ['AG', 'RE', 'SB'] as const;
export type PowerCommunity = (typeof POWER_COMMUNITIES)[number];

export type PowerSpatial = 'point' | 'regional';
export type PowerApplication = 'indicators' | 'windrose' | 'zones';
export type PowerApplicationSpatial = 'point' | 'regional' | 'global';

export interface PowerCoordinate {
	latitude: number;
	longitude: number;
}

export interface PowerBounds {
	latitudeMin: number;
	latitudeMax: number;
	longitudeMin: number;
	longitudeMax: number;
}

export interface PowerTemporalRequest {
	temporal: PowerTemporal;
	spatial: PowerSpatial;
	community: PowerCommunity | string;
	parameters: string[];
	latitude?: number;
	longitude?: number;
	bounds?: PowerBounds;
	start?: string | number;
	end?: string | number;
	/** Climatology without a custom span uses the server's precomputed normal. */
	customClimatology?: boolean;
	format?: string;
	units?: 'metric' | 'imperial';
	timeStandard?: 'lst' | 'utc';
	user?: string;
	header?: boolean;
	siteElevation?: number;
	windElevation?: number;
	windSurface?: string;
}

export interface PowerApplicationRequest {
	application: PowerApplication;
	spatial?: PowerApplicationSpatial;
	latitude?: number;
	longitude?: number;
	bounds?: PowerBounds;
	start?: string | number;
	end?: string | number;
	format?: string;
	units?: 'metric' | 'imperial';
	timeStandard?: 'lst' | 'utc';
	user?: string;
	theme?: 'light' | 'dark';
}

export interface PowerValidation {
	valid: boolean;
	error?: string;
}

function validateOptionalPowerUser(user?: string): PowerValidation {
	if (user?.trim() && !/^[A-Za-z0-9]+$/.test(user.trim())) {
		return {
			valid: false,
			error: 'NASA POWER optional user identifiers must contain only letters and numbers.'
		};
	}
	return { valid: true };
}

export interface PowerParameterMetadata {
	temporal?: string;
	type?: string;
	source?: string;
	community?: string;
	name?: string;
	longname?: string;
	definition?: string;
	units?: string;
	units_name?: string;
	units_html?: string;
	units_min?: number;
	units_max?: number;
	units_digits?: number;
	data_type?: string;
	calculated?: boolean;
	inputs?: unknown;
	time_start?: string | null;
	time_end?: string;
	[key: string]: unknown;
}

export interface PowerGeoJsonFeature {
	type?: string;
	geometry?: {
		type?: string;
		coordinates?: number[];
	};
	properties?: {
		parameter?: Record<string, unknown>;
		[key: string]: unknown;
	};
}

export interface PowerJsonResponse {
	type?: string;
	geometry?: { type?: string; coordinates?: number[] };
	properties?: {
		parameter?: Record<string, unknown>;
		[key: string]: unknown;
	};
	features?: PowerGeoJsonFeature[];
	header?: Record<string, unknown>;
	messages?: unknown[] | string;
	parameters?: Record<string, PowerParameterMetadata>;
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface PowerSeriesPoint {
	key: string;
	label: string;
	value: number;
	/** Position among all returned time keys, including keys omitted as fill values. */
	sampleIndex: number;
}

export interface PowerSeries {
	code: string;
	name: string;
	unit: string;
	points: PowerSeriesPoint[];
	/** Number of non-annual time keys returned by NASA for this parameter. */
	sampleCount: number;
	/** Number of finite, non-fill time values. */
	validCount: number;
	/** Number of fill, null, or otherwise non-numeric time values omitted from charts. */
	missingCount: number;
	annualValue?: number;
}

export interface PowerApiDefinition {
	id: string;
	label: string;
	group: 'temporal' | 'application' | 'system';
	openApiPath: string;
	configurationPath: string;
	docsUrl: string;
	swaggerName: string;
}

export const POWER_API_DIRECTORY: PowerApiDefinition[] = [
	{
		id: 'hourly',
		label: 'Hourly',
		group: 'temporal',
		openApiPath: '/api/temporal/hourly/openapi.json',
		configurationPath: '/api/temporal/hourly/configuration',
		docsUrl: `${NASA_POWER_DOCS}temporal/hourly/`,
		swaggerName: 'Hourly'
	},
	{
		id: 'daily',
		label: 'Daily',
		group: 'temporal',
		openApiPath: '/api/temporal/daily/openapi.json',
		configurationPath: '/api/temporal/daily/configuration',
		docsUrl: `${NASA_POWER_DOCS}temporal/daily/`,
		swaggerName: 'Daily'
	},
	{
		id: 'monthly',
		label: 'Monthly & annual',
		group: 'temporal',
		openApiPath: '/api/temporal/monthly/openapi.json',
		configurationPath: '/api/temporal/monthly/configuration',
		docsUrl: `${NASA_POWER_DOCS}temporal/monthly/`,
		swaggerName: 'Monthly & Annual'
	},
	{
		id: 'climatology',
		label: 'Climatology',
		group: 'temporal',
		openApiPath: '/api/temporal/climatology/openapi.json',
		configurationPath: '/api/temporal/climatology/configuration',
		docsUrl: `${NASA_POWER_DOCS}temporal/climatology/`,
		swaggerName: 'Climatology'
	},
	{
		id: 'indicators',
		label: 'Climate indicators',
		group: 'application',
		openApiPath: '/api/application/indicators/openapi.json',
		configurationPath: '/api/application/indicators/configuration',
		docsUrl: `${NASA_POWER_DOCS}application/indicators/`,
		swaggerName: 'Indicators'
	},
	{
		id: 'windrose',
		label: 'Wind rose',
		group: 'application',
		openApiPath: '/api/application/windrose/openapi.json',
		configurationPath: '/api/application/windrose/configuration',
		docsUrl: `${NASA_POWER_DOCS}application/windrose/`,
		swaggerName: 'Windrose'
	},
	{
		id: 'zones',
		label: 'Thermal zones',
		group: 'application',
		openApiPath: '/api/application/zones/openapi.json',
		configurationPath: '/api/application/zones/configuration',
		docsUrl: `${NASA_POWER_DOCS}application/zones/`,
		swaggerName: 'Zones'
	},
	{
		id: 'manager',
		label: 'Manager',
		group: 'system',
		openApiPath: '/api/system/manager/openapi.json',
		configurationPath: '/api/system/manager/configuration',
		docsUrl: `${NASA_POWER_DOCS}system/manager/`,
		swaggerName: 'Manager'
	},
	{
		id: 'resources',
		label: 'Resources',
		group: 'system',
		openApiPath: '/api/system/resources/openapi.json',
		configurationPath: '/api/system/resources/configuration',
		docsUrl: `${NASA_POWER_DOCS}system/resources/`,
		swaggerName: 'Resources'
	}
];

/** NASA POWER's own Swagger UI exposes all of its live OpenAPI documents. */
export const powerSwaggerUrl = (name: string): string =>
	`${NASA_POWER_SWAGGER}?urls.primaryName=${encodeURIComponent(name)}`;

export const powerConfigurationUrl = (definition: PowerApiDefinition): URL =>
	new URL(definition.configurationPath, NASA_POWER_ORIGIN);

export const powerOpenApiUrl = (definition: PowerApiDefinition): URL =>
	new URL(definition.openApiPath, NASA_POWER_ORIGIN);

export function powerParameterCatalogUrl(
	community: PowerCommunity | string,
	temporal: PowerTemporal,
	includeExtendedMetadata = false
): URL {
	const url = new URL('/api/system/manager/parameters', NASA_POWER_ORIGIN);
	url.searchParams.set('community', community.toLowerCase());
	url.searchParams.set('temporal', temporal);
	// This flag returns the extended bounds/type/time fields but is deprecated
	// in POWER's current OpenAPI. The regular response still includes name,
	// definition, units, source, and calculated status.
	if (includeExtendedMetadata) url.searchParams.set('metadata', 'true');
	return url;
}

export function powerParameterDetailUrl(parameter: string): URL {
	return new URL(
		`/api/system/manager/parameters/${encodeURIComponent(parameter)}`,
		NASA_POWER_ORIGIN
	);
}

export function powerSurfaceDetailUrl(alias: string): URL {
	return new URL(`/api/system/manager/surface/${encodeURIComponent(alias)}`, NASA_POWER_ORIGIN);
}

export const POWER_LIMITS = {
	hourlyPointParameters: 15,
	otherPointParameters: 20,
	regionalParameters: 1,
	windElevationMinMeters: 10,
	windElevationMaxMeters: 300,
	minimumRegionalSpanDegrees: 2,
	minimumZonesRegionalSpanDegrees: 5,
	customClimatologyMinimumYears: 2,
	indicatorsMinimumYears: 5,
	zonesMinimumYears: 2
} as const;

export function powerParameterLimit(temporal: PowerTemporal, spatial: PowerSpatial): number {
	if (spatial === 'regional') return POWER_LIMITS.regionalParameters;
	return temporal === 'hourly'
		? POWER_LIMITS.hourlyPointParameters
		: POWER_LIMITS.otherPointParameters;
}

const finiteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

export function validatePowerCoordinate(latitude: number, longitude: number): PowerValidation {
	if (!finiteNumber(latitude) || latitude < -90 || latitude > 90) {
		return { valid: false, error: 'Latitude must be between −90° and 90°.' };
	}
	if (!finiteNumber(longitude) || longitude < -180 || longitude > 180) {
		return { valid: false, error: 'Longitude must be between −180° and 180°.' };
	}
	return { valid: true };
}

export function validatePowerBounds(
	bounds: PowerBounds,
	minimumSpan: number = POWER_LIMITS.minimumRegionalSpanDegrees,
	endpoint = 'regional'
): PowerValidation {
	const { latitudeMin, latitudeMax, longitudeMin, longitudeMax } = bounds;
	if (![latitudeMin, latitudeMax, longitudeMin, longitudeMax].every(finiteNumber)) {
		return { valid: false, error: 'Enter four finite region bounds.' };
	}
	if (latitudeMin < -90 || latitudeMax > 90 || latitudeMin >= latitudeMax) {
		return { valid: false, error: 'Region latitude bounds must be ordered within −90° to 90°.' };
	}
	if (longitudeMin < -180 || longitudeMax > 180 || longitudeMin >= longitudeMax) {
		return { valid: false, error: 'Region longitude bounds must be ordered within −180° to 180°.' };
	}
	if (latitudeMax - latitudeMin < minimumSpan) {
		return {
			valid: false,
			error: `NASA POWER ${endpoint} requests need at least a ${minimumSpan}° latitude span; use Point for a smaller area.`
		};
	}
	if (longitudeMax - longitudeMin < minimumSpan) {
		return {
			valid: false,
			error: `NASA POWER ${endpoint} requests need at least a ${minimumSpan}° longitude span; use Point for a smaller area.`
		};
	}
	return { valid: true };
}

export type PowerCoveragePrecision = 'date' | 'year';

function normalizeCoverageValue(
	value: string | number,
	precision: PowerCoveragePrecision
): string | undefined {
	const text = String(value).trim();
	if (precision === 'year') return text.match(/^\d{4}/)?.[0];
	const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
	return match ? `${match[1]}${match[2]}${match[3]}` : undefined;
}

function displayCoverageValue(value: string | number, precision: PowerCoveragePrecision): string {
	const normalized = normalizeCoverageValue(value, precision);
	if (!normalized) return String(value);
	return precision === 'year'
		? normalized
		: `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

/** Validate user dates against the selected service's live configuration range. */
export function validatePowerCoverageRange(
	start: string | number | undefined,
	end: string | number | undefined,
	coverageStart: string | number | undefined,
	coverageEnd: string | number | undefined,
	precision: PowerCoveragePrecision,
	service = 'NASA POWER'
): PowerValidation {
	if (
		start === undefined ||
		end === undefined ||
		coverageStart === undefined ||
		coverageEnd === undefined
	) {
		return { valid: true };
	}
	const normalizedStart = normalizeCoverageValue(start, precision);
	const normalizedEnd = normalizeCoverageValue(end, precision);
	const normalizedCoverageStart = normalizeCoverageValue(coverageStart, precision);
	const normalizedCoverageEnd = normalizeCoverageValue(coverageEnd, precision);
	if (!normalizedStart || !normalizedEnd || !normalizedCoverageStart || !normalizedCoverageEnd) {
		return { valid: true };
	}
	if (normalizedStart < normalizedCoverageStart) {
		return {
			valid: false,
			error: `${service} coverage starts at ${displayCoverageValue(coverageStart, precision)}; choose a start within live coverage.`
		};
	}
	if (normalizedEnd > normalizedCoverageEnd) {
		return {
			valid: false,
			error: `${service} coverage ends at ${displayCoverageValue(coverageEnd, precision)}; choose an end within live coverage.`
		};
	}
	return { valid: true };
}

function dateForPower(
	value: string | number | undefined,
	temporal: PowerTemporal
): string | undefined {
	if (value === undefined || value === '') return undefined;
	const text = String(value);
	return temporal === 'hourly' || temporal === 'daily' ? text.replaceAll('-', '') : text;
}

export function validatePowerTemporalRequest(request: PowerTemporalRequest): PowerValidation {
	const userValidation = validateOptionalPowerUser(request.user);
	if (!userValidation.valid) return userValidation;
	if (!POWER_TEMPORALS.includes(request.temporal)) {
		return { valid: false, error: 'Choose a supported temporal service.' };
	}
	if (request.spatial === 'regional' && request.temporal === 'hourly') {
		return {
			valid: false,
			error: 'NASA POWER Hourly currently supports Point requests, not Regional.'
		};
	}
	if (!request.parameters.length) {
		return { valid: false, error: 'Select at least one NASA POWER parameter.' };
	}
	const limit = powerParameterLimit(request.temporal, request.spatial);
	if (request.parameters.length > limit) {
		return {
			valid: false,
			error: `${request.spatial === 'regional' ? 'Regional' : request.temporal === 'hourly' ? 'Hourly point' : 'Point'} requests support at most ${limit} parameter${limit === 1 ? '' : 's'}.`
		};
	}
	if (request.spatial === 'point') {
		const coordinate = validatePowerCoordinate(
			request.latitude as number,
			request.longitude as number
		);
		if (!coordinate.valid) return coordinate;
	} else if (!request.bounds) {
		return { valid: false, error: 'Enter a regional bounding box.' };
	} else {
		const bounds = validatePowerBounds(request.bounds);
		if (!bounds.valid) return bounds;
	}
	if (request.temporal !== 'climatology' || request.customClimatology) {
		if (
			request.start === undefined ||
			request.end === undefined ||
			request.start === '' ||
			request.end === ''
		) {
			return { valid: false, error: 'Enter both a start and an end value.' };
		}
		const start = dateForPower(request.start, request.temporal) ?? '';
		const end = dateForPower(request.end, request.temporal) ?? '';
		if (
			(request.temporal === 'hourly' || request.temporal === 'daily') &&
			(!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end))
		) {
			return { valid: false, error: 'Enter dates in YYYY-MM-DD format.' };
		}
		if (
			request.temporal !== 'hourly' &&
			request.temporal !== 'daily' &&
			(!/^\d{4}$/.test(start) || !/^\d{4}$/.test(end))
		) {
			return { valid: false, error: 'Enter four-digit years for monthly/climatology data.' };
		}
		if (start > end) {
			return { valid: false, error: 'Start must be earlier than or equal to End.' };
		}
		if (request.temporal === 'hourly' && request.format?.toLowerCase() === 'srw') {
			if (!start.endsWith('0101')) {
				return { valid: false, error: 'NASA POWER SRW files must start on January 1.' };
			}
			if (!end.endsWith('1231')) {
				return { valid: false, error: 'NASA POWER SRW files must end on December 31.' };
			}
		}
		if (
			request.temporal === 'climatology' &&
			request.customClimatology &&
			Number(end) - Number(start) + 1 < POWER_LIMITS.customClimatologyMinimumYears
		) {
			return {
				valid: false,
				error: 'NASA POWER custom climatology needs a range covering at least two years.'
			};
		}
	}
	if (request.windSurface && request.windElevation === undefined) {
		return { valid: false, error: 'A custom wind surface also requires wind elevation.' };
	}
	if (
		request.windElevation !== undefined &&
		(request.windElevation < POWER_LIMITS.windElevationMinMeters ||
			request.windElevation > POWER_LIMITS.windElevationMaxMeters)
	) {
		return {
			valid: false,
			error: `Wind elevation must be between ${POWER_LIMITS.windElevationMinMeters} m and ${POWER_LIMITS.windElevationMaxMeters} m.`
		};
	}
	return { valid: true };
}

export function buildPowerTemporalUrl(request: PowerTemporalRequest): URL {
	const validation = validatePowerTemporalRequest(request);
	if (!validation.valid) throw new Error(validation.error);
	const url = new URL(`/api/temporal/${request.temporal}/${request.spatial}`, NASA_POWER_ORIGIN);
	const query = url.searchParams;
	query.set('parameters', request.parameters.join(','));
	query.set('community', request.community.toLowerCase());
	const format = (request.format ?? 'json').toLowerCase();
	const specializedHourlyFile =
		request.temporal === 'hourly' && (format === 'sam' || format === 'srw');
	query.set('format', format);
	if (request.spatial === 'point') {
		query.set('latitude', String(request.latitude));
		query.set('longitude', String(request.longitude));
	} else {
		const bounds = request.bounds as PowerBounds;
		query.set('latitude-min', String(bounds.latitudeMin));
		query.set('latitude-max', String(bounds.latitudeMax));
		query.set('longitude-min', String(bounds.longitudeMin));
		query.set('longitude-max', String(bounds.longitudeMax));
	}
	if (request.temporal !== 'climatology' || request.customClimatology) {
		query.set('start', dateForPower(request.start, request.temporal) as string);
		query.set('end', dateForPower(request.end, request.temporal) as string);
	}
	if (request.units && !specializedHourlyFile) query.set('units', request.units);
	if (request.timeStandard && !specializedHourlyFile)
		query.set('time-standard', request.timeStandard);
	if (request.user?.trim()) query.set('user', request.user.trim());
	if (request.header !== undefined && !specializedHourlyFile) {
		query.set('header', String(request.header));
	}
	if (request.spatial === 'point') {
		if (request.siteElevation !== undefined) {
			query.set('site-elevation', String(request.siteElevation));
		}
		if (request.windElevation !== undefined) {
			query.set('wind-elevation', String(request.windElevation));
		}
		if (request.windSurface) query.set('wind-surface', request.windSurface);
	}
	return url;
}

export function validatePowerApplicationRequest(request: PowerApplicationRequest): PowerValidation {
	const userValidation = validateOptionalPowerUser(request.user);
	if (!userValidation.valid) return userValidation;
	const spatial = request.spatial ?? 'point';
	if (request.application === 'indicators' || request.application === 'windrose') {
		if (spatial !== 'point') {
			return { valid: false, error: `${request.application} supports Point requests only.` };
		}
	}
	if (spatial === 'point') {
		const coordinate = validatePowerCoordinate(
			request.latitude as number,
			request.longitude as number
		);
		if (!coordinate.valid) return coordinate;
	} else if (spatial === 'regional') {
		if (!request.bounds) return { valid: false, error: 'Enter a regional bounding box.' };
		const isZones = request.application === 'zones';
		const bounds = validatePowerBounds(
			request.bounds,
			isZones
				? POWER_LIMITS.minimumZonesRegionalSpanDegrees
				: POWER_LIMITS.minimumRegionalSpanDegrees,
			isZones ? 'Zones regional' : 'regional'
		);
		if (!bounds.valid) return bounds;
	}
	if (request.application === 'zones') {
		if (
			request.start === undefined ||
			request.end === undefined ||
			request.start === '' ||
			request.end === ''
		) {
			return { valid: false, error: 'Enter both a start year and an end year.' };
		}
		const start = Number(request.start);
		const end = Number(request.end);
		if (
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			end - start + 1 < POWER_LIMITS.zonesMinimumYears
		) {
			return {
				valid: false,
				error: 'NASA POWER Zones needs a time range covering at least two years.'
			};
		}
	} else if (request.application === 'indicators') {
		if (
			request.start === undefined ||
			request.end === undefined ||
			request.start === '' ||
			request.end === ''
		) {
			return { valid: false, error: 'Enter both a start year and an end year.' };
		}
		const start = Number(request.start);
		const end = Number(request.end);
		if (
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			end - start + 1 < POWER_LIMITS.indicatorsMinimumYears
		) {
			return {
				valid: false,
				error: 'Climate Indicators needs a time range covering at least five years.'
			};
		}
	} else {
		if (
			request.start === undefined ||
			request.end === undefined ||
			request.start === '' ||
			request.end === ''
		) {
			return { valid: false, error: 'Enter both a start date and an end date.' };
		}
		if (dateForPower(request.start, 'daily')! > dateForPower(request.end, 'daily')!) {
			return { valid: false, error: 'Start must be earlier than or equal to End.' };
		}
	}
	return { valid: true };
}

export function buildPowerApplicationUrl(request: PowerApplicationRequest): URL {
	const validation = validatePowerApplicationRequest(request);
	if (!validation.valid) throw new Error(validation.error);
	const spatial = request.spatial ?? 'point';
	const path = `/api/application/${request.application}/${spatial}`;
	const url = new URL(path, NASA_POWER_ORIGIN);
	const query = url.searchParams;
	if (spatial === 'point') {
		query.set('latitude', String(request.latitude));
		query.set('longitude', String(request.longitude));
	} else if (spatial === 'regional') {
		const bounds = request.bounds as PowerBounds;
		query.set('latitude-min', String(bounds.latitudeMin));
		query.set('latitude-max', String(bounds.latitudeMax));
		query.set('longitude-min', String(bounds.longitudeMin));
		query.set('longitude-max', String(bounds.longitudeMax));
	}
	if (request.start !== undefined && request.end !== undefined) {
		const temporal = request.application === 'windrose' ? 'daily' : 'monthly';
		query.set('start', dateForPower(request.start, temporal) as string);
		query.set('end', dateForPower(request.end, temporal) as string);
	}
	query.set('format', (request.format ?? 'json').toLowerCase());
	if (request.units) query.set('units', request.units);
	if (request.timeStandard) query.set('time-standard', request.timeStandard);
	if (request.user?.trim()) query.set('user', request.user.trim());
	if (request.theme) query.set('theme', request.theme);
	return url;
}

export function powerApiResourceUrl(path: string): URL {
	if (!path.startsWith('/api/')) throw new Error('POWER API paths must start with /api/.');
	return new URL(path, NASA_POWER_ORIGIN);
}

export function numericPowerValue(value: unknown, fillValue?: unknown): value is number {
	const fillNumber =
		typeof fillValue === 'number' && Number.isFinite(fillValue)
			? fillValue
			: typeof fillValue === 'string' &&
				  fillValue.trim() !== '' &&
				  Number.isFinite(Number(fillValue))
				? Number(fillValue)
				: undefined;
	return (
		typeof value === 'number' &&
		Number.isFinite(value) &&
		value !== -999 &&
		(fillNumber === undefined || value !== fillNumber)
	);
}

/** Identify the NASA POWER IMERG family from its live parameter code or definition. */
export function isPowerImergParameter(
	code: string,
	metadata?: Pick<PowerParameterMetadata, 'name' | 'definition'>
): boolean {
	const description = `${code} ${metadata?.name ?? ''} ${metadata?.definition ?? ''}`;
	return /^IMERG_/i.test(code) || /(^|[^A-Z0-9])IMERG([^A-Z0-9]|$)/i.test(description);
}

/**
 * Documented native-grid context for source IDs returned by the POWER API.
 * These notes intentionally use NASA's source-family wording; they are not a
 * claim that a point request reports its exact grid-cell centre.
 */
export function powerSourceResolutionNotes(sources: unknown): string[] {
	const names = Array.isArray(sources)
		? sources.filter((source): source is string => typeof source === 'string')
		: typeof sources === 'string'
			? [sources]
			: [];
	const normalized = names.map((source) => source.toUpperCase().replace(/[^A-Z0-9]/g, ''));
	const notes: string[] = [];

	if (normalized.some((source) => source.includes('IMERG'))) {
		notes.push(
			'IMERG uses a 0.1° × 0.1° source grid (about 10 km); POWER serves it as daily UTC data.'
		);
	}
	if (normalized.some((source) => source.includes('MERRA2') || source.includes('GEOSIT'))) {
		notes.push('MERRA-2 and GEOS-IT use a 0.5° latitude × 0.625° longitude grid.');
	}
	if (normalized.some((source) => source.includes('SYN1DEG'))) {
		notes.push('SYN1DEG is NASA CERES SYN1deg; NASA identifies its primary solar grid as 1° × 1°.');
	}
	return notes;
}

const periodLabel = (key: string): string => {
	if (/^\d{8}$/.test(key)) return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
	if (/^\d{10}$/.test(key)) {
		return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)} ${key.slice(8, 10)}:00`;
	}
	if (/^\d{6}$/.test(key)) {
		const month = Number(key.slice(4, 6));
		return month === 13 ? `${key.slice(0, 4)} annual` : `${key.slice(0, 4)}-${key.slice(4, 6)}`;
	}
	return key;
};

/** Convert a point response's date-keyed parameter object into chart-ready series. */
export function powerSeriesFromResponse(response: PowerJsonResponse): PowerSeries[] {
	const valuesByParameter = response.properties?.parameter;
	if (!valuesByParameter) return [];
	const fillValue = response.header?.fill_value;
	const climatologyOrder = [
		'JAN',
		'FEB',
		'MAR',
		'APR',
		'MAY',
		'JUN',
		'JUL',
		'AUG',
		'SEP',
		'OCT',
		'NOV',
		'DEC'
	];
	const isAnnualKey = (key: string) => key === 'ANN' || (/^\d{6}$/.test(key) && key.endsWith('13'));
	const compareTimeKeys = (a: string, b: string) => {
		const aMonth = climatologyOrder.indexOf(a);
		const bMonth = climatologyOrder.indexOf(b);
		if (aMonth >= 0 && bMonth >= 0) return aMonth - bMonth;
		return a.localeCompare(b);
	};
	const result: PowerSeries[] = [];
	for (const [code, values] of Object.entries(valuesByParameter)) {
		if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
		const metadata = response.parameters?.[code];
		const entries = Object.entries(values as Record<string, unknown>);
		const annualEntry = entries.find(([key]) => isAnnualKey(key));
		const annualValue =
			annualEntry && numericPowerValue(annualEntry[1], fillValue) ? annualEntry[1] : undefined;
		const timeEntries = entries
			.filter(([key]) => !isAnnualKey(key))
			.sort(([a], [b]) => compareTimeKeys(a, b));
		const points: PowerSeriesPoint[] = [];
		let missingCount = 0;
		for (const [sampleIndex, [key, value]] of timeEntries.entries()) {
			if (!numericPowerValue(value, fillValue)) {
				missingCount += 1;
				continue;
			}
			points.push({ key, label: periodLabel(key), value, sampleIndex });
		}
		result.push({
			code,
			name: metadata?.longname ?? metadata?.name ?? code,
			unit: metadata?.units ?? metadata?.units_name ?? '',
			points,
			sampleCount: timeEntries.length,
			validCount: points.length,
			missingCount,
			annualValue
		});
	}
	return result;
}

export function powerResponseMessages(response: unknown): string[] {
	if (!response || typeof response !== 'object') return [];
	const record = response as Record<string, unknown>;
	const values: string[] = [];
	if (typeof record.header === 'string') values.push(record.header);
	if (typeof record.message === 'string') values.push(record.message);
	if (Array.isArray(record.messages)) {
		values.push(...record.messages.filter((item): item is string => typeof item === 'string'));
	}
	if (typeof record.detail === 'string') values.push(record.detail);
	if (Array.isArray(record.detail)) {
		for (const item of record.detail) {
			if (typeof item === 'string') values.push(item);
			else if (item && typeof item === 'object') {
				const detail = item as Record<string, unknown>;
				if (typeof detail.msg === 'string') values.push(detail.msg);
			}
		}
	}
	return [...new Set(values)];
}

export function powerJsonError(response: unknown): string | undefined {
	if (!response || typeof response !== 'object') return undefined;
	const record = response as Record<string, unknown>;
	const hasApiError =
		(typeof record.header === 'string' &&
			(Array.isArray(record.messages) || typeof record.message === 'string')) ||
		typeof record.detail === 'string' ||
		Array.isArray(record.detail);
	return hasApiError ? powerResponseMessages(response).join(' ') : undefined;
}

/**
 * NASA POWER 2.x exposes these ArcGIS services in its official service
 * directory. Their endpoints are kept separate from the REST data APIs because
 * they are hosted on NASA EGIS and may have independent availability.
 */
export const POWER_ARCGIS_SERVICES = [
	{
		name: 'Monthly radiation',
		kind: 'Image service',
		serviceUrl:
			'https://gis.earthdata.nasa.gov/image/rest/services/POWER/POWER_MONTHLY_RADIATION_LST/ImageServer',
		itemUrl:
			'https://gis.earthdata.nasa.gov/portal/home/item.html?id=f85d4fc5eb0740ac8cffb3803e7b0d7a'
	},
	{
		name: 'Monthly meteorology',
		kind: 'Image service',
		serviceUrl:
			'https://gis.earthdata.nasa.gov/image/rest/services/POWER/POWER_MONTHLY_METEOROLOGY_LST/ImageServer',
		itemUrl:
			'https://gis.earthdata.nasa.gov/portal/home/item.html?id=8f19b884dbfd4441beeb2ae9e26abae5'
	},
	{
		name: 'Annual radiation',
		kind: 'Image service',
		serviceUrl:
			'https://gis.earthdata.nasa.gov/image/rest/services/POWER/POWER_ANNUAL_RADIATION_LST/ImageServer',
		itemUrl:
			'https://gis.earthdata.nasa.gov/portal/home/item.html?id=9bb9e42bc0754866a751329f4870000f'
	},
	{
		name: 'Annual meteorology',
		kind: 'Image service',
		serviceUrl:
			'https://gis.earthdata.nasa.gov/image/rest/services/POWER/POWER_ANNUAL_METEOROLOGY_LST/ImageServer',
		itemUrl:
			'https://gis.earthdata.nasa.gov/portal/home/item.html?id=c1673c398f044392b2f4d6a52a201a38'
	},
	{
		name: 'Climatology radiation',
		kind: 'Image service',
		serviceUrl:
			'https://gis.earthdata.nasa.gov/image/rest/services/POWER/POWER_CLIMATOLOGY_RADIATION_LST/ImageServer',
		itemUrl:
			'https://gis.earthdata.nasa.gov/portal/home/item.html?id=0d75022c26f844668ec99f64a0cc2f67'
	},
	{
		name: 'Climatology meteorology',
		kind: 'Image service',
		serviceUrl:
			'https://gis.earthdata.nasa.gov/image/rest/services/POWER/POWER_CLIMATOLOGY_METEOROLOGY_LST/ImageServer',
		itemUrl:
			'https://gis.earthdata.nasa.gov/portal/home/item.html?id=21092f823a9043c79f8b37b344ac5517'
	},
	{
		name: 'Thermal zones',
		kind: 'Feature service',
		serviceUrl:
			'https://gis.earthdata.nasa.gov/maphost/rest/services/Four_Year_Rolling_Thermal_and_Thermal_Moisture_Zones__1984___2021_/MapServer/0',
		itemUrl: 'https://nasa.maps.arcgis.com/home/item.html?id=5decff2900d34c5bb843ad6c23712318'
	},
	{
		name: 'Thermal moisture zones',
		kind: 'Feature service',
		serviceUrl:
			'https://gis.earthdata.nasa.gov/maphost/rest/services/Four_Year_Rolling_Thermal_and_Thermal_Moisture_Zones__1984___2021_/MapServer/1',
		itemUrl: 'https://nasa.maps.arcgis.com/home/item.html?id=5decff2900d34c5bb843ad6c23712318'
	}
] as const;

export const POWER_AWS_DATASETS = [
	{
		name: 'Analysis Ready Datastore (ARD)',
		format: 'Zarr',
		role: 'POWER APIs use this analysis-ready source; NASA recommends it for direct online data access.',
		url: 'https://nasa-power.s3.us-west-2.amazonaws.com/index.html'
	},
	{
		name: 'POWER Datastore (DDD)',
		format: 'NetCDF',
		role: 'Bulk archive datastore; not recommended by NASA for direct online access.',
		url: 'https://power-datastore.s3.us-west-2.amazonaws.com/index.html'
	},
	{
		name: 'POWER Services Datastore (SDS)',
		format: 'CRF',
		role: 'Source datastore for the ArcGIS Image Services.',
		url: 'https://power-services-datastore.s3.us-west-2.amazonaws.com/index.html'
	}
] as const;

export const POWER_AWS_REGISTRY = 'https://registry.opendata.aws/nasa-power/';

export function makePowerWindrosePlotUrl(
	latitude: number,
	longitude: number,
	start: string,
	end: string,
	theme: 'light' | 'dark' = 'light',
	units: 'metric' | 'imperial' = 'metric',
	timeStandard: 'lst' | 'utc' = 'lst',
	user?: string
): URL {
	const validation = validatePowerCoordinate(latitude, longitude);
	if (!validation.valid) throw new Error(validation.error);
	const userValidation = validateOptionalPowerUser(user);
	if (!userValidation.valid) throw new Error(userValidation.error);
	const url = new URL('/api/application/windrose/plot', NASA_POWER_ORIGIN);
	url.searchParams.set('latitude', String(latitude));
	url.searchParams.set('longitude', String(longitude));
	url.searchParams.set('start', dateForPower(start, 'daily') as string);
	url.searchParams.set('end', dateForPower(end, 'daily') as string);
	url.searchParams.set('format', 'html');
	url.searchParams.set('theme', theme);
	url.searchParams.set('units', units);
	url.searchParams.set('time-standard', timeStandard);
	if (user?.trim()) url.searchParams.set('user', user.trim());
	return url;
}
