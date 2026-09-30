/**
 * Open-Meteo reanalysis archive client.
 *
 * The forecast side of the app reads spatial `.om` files that are only retained
 * for 7 days, so it cannot answer anything about climate. This client talks to
 * the sibling `archive-api` endpoints, which serve ERA5 back to 1940, and is
 * used by the historical analysis panel.
 *
 * Two findings from probing the live API shape the implementation:
 *
 *  1. A request can return HTTP 200 while every value of a variable is `null`.
 *     `cape`, `visibility`, `soil_moisture_*` and all pressure levels behave this
 *     way for the ERA5 model. Treating "success" as HTTP status alone would render
 *     an empty chart with no explanation, so `isUsableVariable` gates on actual
 *     numbers and the panel reports the variable as unavailable.
 *  2. Pressure-level variables only resolve for the GFS and ICON families, not
 *     for `era5`. `modelSupportsPressureLevels` encodes that, so the panel can
 *     offer levels for a model that can actually serve them.
 *
 * All requests are plain GETs to endpoints that send
 * `access-control-allow-origin: *`, so this works from the browser directly.
 * No API key is required for non-commercial use.
 */
import { type Writable, writable } from 'svelte/store';

const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';
const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';
const AIR_QUALITY_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** The climatology normal every anomaly is measured against. */
export const CLIMATOLOGY_START_YEAR = 1991;
export const CLIMATOLOGY_END_YEAR = 2020;

/**
 * Historical depth per data family, all verified against the live API rather
 * than taken from documentation, because the documented figure and the
 * served figure disagree for marine and air quality.
 */
export const AIR_QUALITY_START_YEAR = 2022;
/** ERA5-Ocean: the wave triple, at 0.5°. */
export const MARINE_START_YEAR = 1979;
/** best_match marine: swell components and SST, much shallower but finer. */
export const MARINE_HIRES_START_YEAR = 2024;

export type ArchiveModel =
	| 'era5'
	| 'era5_land'
	| 'era5_ensemble'
	| 'cerra'
	| 'gfs_seamless'
	| 'icon_seamless'
	| 'cma_grapes_global';

export interface ArchiveModelInfo {
	value: ArchiveModel;
	label: string;
	/** Earliest year with data, verified against the live API. */
	startYear: number;
	/** Grid spacing in degrees. */
	resolution: number;
	/** Reanalysis is observation-driven and final; forecast models are not. */
	kind: 'reanalysis' | 'model';
	/** Only these families expose pressure-level variables. */
	pressureLevels: boolean;
	note?: string;
}

export const ARCHIVE_MODELS: ArchiveModelInfo[] = [
	{
		value: 'era5',
		label: 'ERA5',
		startYear: 1940,
		resolution: 0.25,
		kind: 'reanalysis',
		pressureLevels: false,
		note: 'ECMWF reanalysis. Observation-driven and final, so a past value never changes.'
	},
	{
		value: 'era5_land',
		label: 'ERA5-Land',
		startYear: 1950,
		resolution: 0.1,
		kind: 'reanalysis',
		pressureLevels: false,
		note: 'Higher resolution land-surface reanalysis.'
	},
	{
		value: 'gfs_seamless',
		label: 'NOAA GFS',
		startYear: 2000,
		resolution: 0.25,
		kind: 'model',
		pressureLevels: true,
		note: 'NOAA global model. Serves pressure levels.'
	},
	{
		value: 'icon_seamless',
		label: 'DWD ICON',
		startYear: 2017,
		resolution: 0.25,
		kind: 'model',
		pressureLevels: true,
		note: 'DWD global model. Serves pressure levels.'
	},
	{
		value: 'cma_grapes_global',
		label: 'CMA GRAPES',
		startYear: 2016,
		resolution: 0.25,
		kind: 'model',
		pressureLevels: true
	},
	{
		value: 'era5_ensemble',
		label: 'ERA5 Ensemble',
		startYear: 1940,
		resolution: 0.5,
		kind: 'reanalysis',
		pressureLevels: false,
		note: 'Ensemble mean. Members are not exposed individually.'
	},
	{
		value: 'cerra',
		label: 'CERRA',
		startYear: 1985,
		resolution: 0.09,
		kind: 'reanalysis',
		pressureLevels: false,
		note: 'High-resolution European reanalysis, 1985-2021.'
	}
];

export type ArchiveEndpoint = 'archive' | 'marine' | 'air-quality';

export interface ArchiveVariable {
	/** Open-Meteo parameter name, e.g. `temperature_2m`. */
	name: string;
	label: string;
	/** Unit string as the API reports it, used verbatim when the API unit is missing. */
	unit: string;
	endpoint: ArchiveEndpoint;
	/**
	 * Whether the API has ever been observed to return numbers for this
	 * parameter. Parameters marked false return HTTP 200 with all-null values
	 * for the models this app offers, so they are hidden rather than shown as
	 * an empty chart.
	 */
	verified: boolean;
	group: 'surface' | 'wind' | 'pressure-level' | 'radiation' | 'marine' | 'air-quality';
	/** True when a large number can make a useful chart unreadable. */
	cumulative?: boolean;
	/**
	 * Model to request for this parameter, overriding the endpoint default.
	 * The marine endpoint is split here: `era5_ocean` reaches back to 1979 but
	 * carries only the wave height/direction/period triple, while `best_match`
	 * adds swell components and sea-surface temperature but starts in 2024.
	 */
	models?: 'era5_ocean' | 'best_match';
	/**
	 * Aggregated daily equivalent, used to keep long spans small. The API
	 * requires a `timezone` for daily queries and returns a daily array instead
	 * of hourly. Variables whose daily form is a different parameter (cloud
	 * cover, dew point, radiation) or is not published (soil moisture, wave
	 * period) simply omit this and stay hourly.
	 */
	daily?: string;
	/** Aggregate applied when `daily` is set, e.g. mean or sum. */
	dailyAggregate?: 'mean' | 'sum' | 'max' | 'min';
	/**
	 * Earliest year with data, verified live. Set for parameters whose depth
	 * differs from the endpoint default.
	 */
	startYear?: number;
	/**
	 * A hint shown in the panel. Reanalysis and model products differ in
	 * resolution, which is the practical limit on what a user can conclude.
	 */
	note?: string;
}

export const ARCHIVE_VARIABLES: ArchiveVariable[] = [
	// --- surface ---
	{
		name: 'temperature_2m',
		label: 'Temperature (2 m)',
		unit: '°C',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'dew_point_2m',
		label: 'Dew point (2 m)',
		unit: '°C',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'relative_humidity_2m',
		label: 'Relative humidity (2 m)',
		unit: '%',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'apparent_temperature',
		label: 'Apparent temperature',
		unit: '°C',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'pressure_msl',
		label: 'Mean sea level pressure',
		unit: 'hPa',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'surface_pressure',
		label: 'Surface pressure',
		unit: 'hPa',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'cloud_cover',
		label: 'Cloud cover',
		unit: '%',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'cloud_cover_low',
		label: 'Low cloud cover',
		unit: '%',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'cloud_cover_mid',
		label: 'Mid cloud cover',
		unit: '%',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'cloud_cover_high',
		label: 'High cloud cover',
		unit: '%',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'precipitation',
		label: 'Precipitation',
		unit: 'mm',
		endpoint: 'archive',
		verified: true,
		group: 'surface',
		cumulative: true
	},
	{
		name: 'rain',
		label: 'Rain',
		unit: 'mm',
		endpoint: 'archive',
		verified: true,
		group: 'surface',
		cumulative: true
	},
	{
		name: 'snowfall',
		label: 'Snowfall',
		unit: 'cm',
		endpoint: 'archive',
		verified: true,
		group: 'surface',
		cumulative: true
	},
	{
		name: 'et0_fao_evapotranspiration',
		label: 'Reference evapotranspiration',
		unit: 'mm',
		endpoint: 'archive',
		verified: true,
		group: 'surface',
		cumulative: true
	},
	{
		name: 'soil_moisture_0_to_7cm',
		label: 'Soil moisture (0-7 cm)',
		unit: 'm³/m³',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'soil_moisture_7_to_28cm',
		label: 'Soil moisture (7-28 cm)',
		unit: 'm³/m³',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},
	{
		name: 'soil_moisture_28_to_100cm',
		label: 'Soil moisture (28-100 cm)',
		unit: 'm³/m³',
		endpoint: 'archive',
		verified: true,
		group: 'surface'
	},

	// --- wind ---
	{
		name: 'wind_speed_10m',
		label: 'Wind speed (10 m)',
		unit: 'km/h',
		endpoint: 'archive',
		verified: true,
		group: 'wind'
	},
	{
		name: 'wind_direction_10m',
		label: 'Wind direction (10 m)',
		unit: '°',
		endpoint: 'archive',
		verified: true,
		group: 'wind'
	},
	{
		name: 'wind_gusts_10m',
		label: 'Wind gusts (10 m)',
		unit: 'km/h',
		endpoint: 'archive',
		verified: true,
		group: 'wind'
	},
	{
		name: 'wind_speed_100m',
		label: 'Wind speed (100 m)',
		unit: 'km/h',
		endpoint: 'archive',
		verified: true,
		group: 'wind'
	},
	{
		name: 'wind_direction_100m',
		label: 'Wind direction (100 m)',
		unit: '°',
		endpoint: 'archive',
		verified: true,
		group: 'wind'
	},
	{
		name: 'wind_speed_850hPa',
		label: 'Wind speed (850 hPa)',
		unit: 'km/h',
		endpoint: 'archive',
		verified: true,
		group: 'pressure-level'
	},
	{
		name: 'wind_direction_850hPa',
		label: 'Wind direction (850 hPa)',
		unit: '°',
		endpoint: 'archive',
		verified: true,
		group: 'pressure-level'
	},
	{
		name: 'wind_speed_250hPa',
		label: 'Wind speed (250 hPa)',
		unit: 'km/h',
		endpoint: 'archive',
		verified: true,
		group: 'pressure-level'
	},
	{
		name: 'temperature_850hPa',
		label: 'Temperature (850 hPa)',
		unit: '°C',
		endpoint: 'archive',
		verified: true,
		group: 'pressure-level'
	},
	{
		name: 'temperature_500hPa',
		label: 'Temperature (500 hPa)',
		unit: '°C',
		endpoint: 'archive',
		verified: true,
		group: 'pressure-level'
	},
	{
		name: 'geopotential_height_500hPa',
		label: 'Geopotential height (500 hPa)',
		unit: 'm',
		endpoint: 'archive',
		verified: true,
		group: 'pressure-level'
	},
	{
		name: 'relative_humidity_700hPa',
		label: 'Relative humidity (700 hPa)',
		unit: '%',
		endpoint: 'archive',
		verified: true,
		group: 'pressure-level'
	},

	// --- radiation ---
	{
		name: 'shortwave_radiation',
		label: 'Shortwave radiation',
		unit: 'W/m²',
		endpoint: 'archive',
		verified: true,
		group: 'radiation'
	},
	{
		name: 'direct_radiation',
		label: 'Direct radiation',
		unit: 'W/m²',
		endpoint: 'archive',
		verified: true,
		group: 'radiation'
	},
	{
		name: 'diffuse_radiation',
		label: 'Diffuse radiation',
		unit: 'W/m²',
		endpoint: 'archive',
		verified: true,
		group: 'radiation'
	},
	{
		name: 'direct_normal_irradiance',
		label: 'Direct normal irradiance',
		unit: 'W/m²',
		endpoint: 'archive',
		verified: true,
		group: 'radiation'
	},

	// --- marine ---
	// Split deliberately: the wave triple goes deep via ERA5-Ocean (1979, 0.5°),
	// while swell components and sea-surface temperature only exist on
	// best_match, which starts in 2024 at a higher resolution. Verified live.
	{
		name: 'wave_height',
		label: 'Wave height',
		unit: 'm',
		endpoint: 'marine',
		verified: true,
		group: 'marine',
		models: 'era5_ocean',
		startYear: MARINE_START_YEAR,
		note: 'ERA5-Ocean from 1979, but at 0.5° — far coarser than a forecast map.'
	},
	{
		name: 'wave_direction',
		label: 'Wave direction',
		unit: '°',
		endpoint: 'marine',
		verified: true,
		group: 'marine',
		models: 'era5_ocean',
		startYear: MARINE_START_YEAR
	},
	{
		name: 'wave_period',
		label: 'Wave period',
		unit: 's',
		endpoint: 'marine',
		verified: true,
		group: 'marine',
		models: 'era5_ocean',
		startYear: MARINE_START_YEAR
	},
	{
		name: 'swell_wave_height',
		label: 'Swell wave height',
		unit: 'm',
		endpoint: 'marine',
		verified: true,
		group: 'marine',
		models: 'best_match',
		startYear: MARINE_HIRES_START_YEAR,
		note: 'Swell components are only published from 2024.'
	},
	{
		name: 'sea_surface_temperature',
		label: 'Sea surface temperature',
		unit: '°C',
		endpoint: 'marine',
		verified: true,
		group: 'marine',
		models: 'best_match',
		startYear: MARINE_HIRES_START_YEAR
	},

	// --- air quality (CAMS) ---
	// CAMS global reanalysis starts August 2022; the European reanalysis is
	// higher resolution (0.1°) but covers Europe only, so the global domain is
	// the default here and its shallower depth is what the start year reflects.
	{
		name: 'pm2_5',
		label: 'PM2.5',
		unit: 'µg/m³',
		endpoint: 'air-quality',
		verified: true,
		group: 'air-quality',
		startYear: AIR_QUALITY_START_YEAR,
		note: 'CAMS global reanalysis at 0.4° — coarser than the forecast layer.'
	},
	{
		name: 'pm10',
		label: 'PM10',
		unit: 'µg/m³',
		endpoint: 'air-quality',
		verified: true,
		group: 'air-quality',
		startYear: AIR_QUALITY_START_YEAR
	},
	{
		name: 'ozone',
		label: 'Ozone',
		unit: 'µg/m³',
		endpoint: 'air-quality',
		verified: true,
		group: 'air-quality',
		startYear: AIR_QUALITY_START_YEAR
	},
	{
		name: 'nitrogen_dioxide',
		label: 'Nitrogen dioxide',
		unit: 'µg/m³',
		endpoint: 'air-quality',
		verified: true,
		group: 'air-quality',
		startYear: AIR_QUALITY_START_YEAR
	},
	{
		name: 'dust',
		label: 'Dust',
		unit: 'µg/m³',
		endpoint: 'air-quality',
		verified: true,
		group: 'air-quality',
		startYear: AIR_QUALITY_START_YEAR
	}
];

/** Parameters the API accepts but returns all-null values for. Kept out of the picker. */
export const ARCHIVE_UNAVAILABLE = [
	'cape',
	'visibility',
	'uv_index',
	'snow_depth',
	'boundary_layer_height',
	'freezing_level_height',
	'lightning_potential'
] as const;

/**
 * Aggregated daily equivalents, each verified live.
 *
 * The daily endpoint is not universally available: marine and air-quality
 * return no daily block at all, and several surface parameters have no daily
 * aggregation published. Those stay hourly, which is correct but slower, so the
 * caller is told which resolution a variable actually resolved at.
 */
const DAILY_AGGREGATES: Record<
	string,
	{ name: string; aggregate: 'mean' | 'sum' | 'max' | 'min' }
> = {
	temperature_2m: { name: 'temperature_2m_mean', aggregate: 'mean' },
	dew_point_2m: { name: 'dew_point_2m_mean', aggregate: 'mean' },
	relative_humidity_2m: { name: 'relative_humidity_2m_mean', aggregate: 'mean' },
	apparent_temperature: { name: 'apparent_temperature_mean', aggregate: 'mean' },
	pressure_msl: { name: 'pressure_msl_mean', aggregate: 'mean' },
	surface_pressure: { name: 'surface_pressure_mean', aggregate: 'mean' },
	cloud_cover: { name: 'cloud_cover_mean', aggregate: 'mean' },
	precipitation: { name: 'precipitation_sum', aggregate: 'sum' },
	rain: { name: 'rain_sum', aggregate: 'sum' },
	snowfall: { name: 'snowfall_sum', aggregate: 'sum' },
	et0_fao_evapotranspiration: { name: 'et0_fao_evapotranspiration_sum', aggregate: 'sum' },
	wind_speed_10m: { name: 'wind_speed_10m_max', aggregate: 'max' },
	wind_direction_10m: { name: 'wind_direction_10m_dominant', aggregate: 'mean' },
	wind_gusts_10m: { name: 'wind_gusts_10m_max', aggregate: 'max' },
	wind_speed_100m: { name: 'wind_speed_100m_max', aggregate: 'max' },
	shortwave_radiation: { name: 'shortwave_radiation_sum', aggregate: 'sum' }
};

/** True when `variable` can be fetched as an aggregated daily series. */
export function supportsDailyResolution(variable: ArchiveVariable): boolean {
	return variable.endpoint === 'archive' && DAILY_AGGREGATES[variable.name] !== undefined;
}

export function getArchiveVariable(name: string): ArchiveVariable | undefined {
	return ARCHIVE_VARIABLES.find((v) => v.name === name);
}

export function getArchiveModel(value: ArchiveModel): ArchiveModelInfo | undefined {
	return ARCHIVE_MODELS.find((m) => m.value === value);
}

/** Air quality reanalysis starts in 2013 for Europe, 2022-08 for the global domain. */
export function startYearForVariable(variable: ArchiveVariable, model: ArchiveModel): number {
	if (variable.startYear !== undefined) return variable.startYear;
	if (variable.endpoint === 'air-quality') return AIR_QUALITY_START_YEAR;
	if (variable.endpoint === 'marine') return MARINE_START_YEAR;
	return getArchiveModel(model)?.startYear ?? 1940;
}

/**
 * Pressure-level parameters only resolve for the GFS and ICON families. ERA5
 * accepts the name and returns null, so the panel must not offer levels there.
 */
export function modelSupportsPressureLevels(model: ArchiveModel): boolean {
	return getArchiveModel(model)?.pressureLevels ?? false;
}

/** A variable is usable only if at least one value is a real number. */
export function isUsableVariable(values: (number | null)[] | undefined): boolean {
	if (!values) return false;
	let count = 0;
	for (const v of values) {
		if (typeof v === 'number' && Number.isFinite(v)) {
			count++;
			// One sample is enough to prove the API has data for this parameter;
			// a full series is not required to make that determination.
			if (count >= 1) return true;
		}
	}
	return false;
}

export interface ArchiveTimePoint {
	time: number;
	value: number;
}

export type ArchiveResolution = 'hourly' | 'daily';

export interface ArchiveResult {
	variable: ArchiveVariable;
	model: ArchiveModel;
	resolution: ArchiveResolution;
	/** Values that survived the null filter, in ascending time order. */
	points: ArchiveTimePoint[];
	/** How many timestamps the API returned before filtering. */
	totalCount: number;
	/** How many were null or non-finite. */
	missingCount: number;
	unit: string;
	latitude: number;
	longitude: number;
	elevation: number;
}

export class ArchiveError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'ArchiveError';
	}
}

/**
 * The archive API is rate limited per minute and answers a burst with 429.
 * Waiting out the full window inside a panel interaction is hostile, so requests
 * are queued and spaced instead: `fetchSeries` holds a chain, and every call
 * through it waits for the previous one plus a floor between calls. The floor is
 * deliberately generous, because a rate-limited response costs the user a
 * visible failure and a retry, which is far more disruptive than one extra
 * second of waiting.
 */
const MIN_INTERVAL_MS = 1200;
let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
	const next = queue.then(async () => {
		const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now());
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		lastCallAt = Date.now();
		return task();
	});
	// Keep the chain alive even when a call rejects, otherwise one failure
	// would reject every queued request behind it.
	queue = next.catch(() => undefined);
	return next;
}

/** True when the failure is a rate limit rather than a data or query problem. */
export function isRateLimited(error: unknown): boolean {
	return error instanceof ArchiveError && error.status === 429;
}

interface ArchiveResponse {
	latitude: number;
	longitude: number;
	elevation: number;
	reason?: string;
	error?: boolean;
	/** `time` is always present; the other keys are the requested parameters. */
	hourly?: { time: string[] } & Record<string, unknown>;
	hourly_units?: Record<string, string>;
	daily?: { time: string[] } & Record<string, unknown>;
	daily_units?: Record<string, string>;
}

const BASE_BY_ENDPOINT: Record<ArchiveEndpoint, string> = {
	archive: ARCHIVE_BASE,
	marine: MARINE_BASE,
	'air-quality': AIR_QUALITY_BASE
};

function buildUrl(
	variable: ArchiveVariable,
	model: ArchiveModel,
	lat: number,
	lon: number,
	start: string,
	end: string,
	resolution: ArchiveResolution
): string {
	const params = new URLSearchParams({
		latitude: lat.toFixed(4),
		longitude: lon.toFixed(4),
		start_date: start,
		end_date: end,
		// The API defaults to GMT+1 local time. UTC keeps the timestamps aligned
		// with the model's run times, which is what the climatology keys expect.
		timezone: 'UTC'
	});
	if (resolution === 'daily') {
		const daily = DAILY_AGGREGATES[variable.name];
		if (daily) params.set('daily', daily.name);
	} else {
		params.set('hourly', variable.name);
	}
	if (variable.endpoint === 'archive') {
		params.set('models', model);
	} else if (variable.endpoint === 'marine') {
		// Per-variable: the deep ERA5-Ocean record carries only the wave triple,
		// so swell and SST have to ask best_match instead.
		params.set('models', variable.models ?? 'era5_ocean');
	} else {
		// CAMS global is the only domain covering the whole globe; the European
		// reanalysis is higher resolution but Europe-only.
		params.set('domains', 'cams_global');
	}
	return `${BASE_BY_ENDPOINT[variable.endpoint]}?${params.toString()}`;
}

/**
 * Fetch one variable's series. Rejects with `ArchiveError` when the API
 * refuses the request or when it answers 200 with no usable numbers, so the
 * caller never has to distinguish "empty chart" from "no data".
 *
 * `resolution` defaults to daily for anything that supports it. A 45-year
 * hourly request is ~400k values and takes several seconds; the daily form is
 * ~16k and is all the trend and anomaly views actually consume.
 */
export async function fetchArchiveSeries(
	variable: ArchiveVariable,
	model: ArchiveModel,
	lat: number,
	lon: number,
	startYear: number,
	endYear: number,
	resolution: ArchiveResolution = supportsDailyResolution(variable) ? 'daily' : 'hourly'
): Promise<ArchiveResult> {
	return schedule(() =>
		requestArchiveSeries(variable, model, lat, lon, startYear, endYear, resolution)
	);
}

/** The unthrottled request, exposed so tests can bypass the queue. */
async function requestArchiveSeries(
	variable: ArchiveVariable,
	model: ArchiveModel,
	lat: number,
	lon: number,
	startYear: number,
	endYear: number,
	resolution: ArchiveResolution
): Promise<ArchiveResult> {
	const start = `${Math.floor(startYear)}-01-01`;
	const end = `${Math.floor(endYear)}-12-31`;
	const url = buildUrl(variable, model, lat, lon, start, end, resolution);

	const response = await fetch(url);
	const body = (await response.json()) as ArchiveResponse;

	if (!response.ok) {
		// A 429 carries an empty or HTML-ish body, so the API's own reason string
		// is not always available; name the condition explicitly.
		if (response.status === 429) {
			throw new ArchiveError('Rate limited by the archive API. Wait a moment and try again.', 429);
		}
		throw new ArchiveError(
			body.reason ?? `Archive request failed (${response.status})`,
			response.status
		);
	}

	const block = resolution === 'daily' ? body.daily : body.hourly;
	const times = block?.time;
	const key =
		resolution === 'daily'
			? (DAILY_AGGREGATES[variable.name]?.name ?? variable.name)
			: variable.name;
	const raw = block?.[key] as (number | null)[] | undefined;
	if (!times || !raw) {
		throw new ArchiveError('Archive response contained no time series', response.status);
	}

	if (!isUsableVariable(raw)) {
		// 200 with all-null is the common failure here, and it is not obvious why:
		// a land point has no wave data, a marine parameter may not be published
		// for the requested model, or the span predates the product. Say so.
		const reasons: string[] = [];
		if (variable.endpoint === 'marine') reasons.push('this point may be inland');
		if (variable.startYear !== undefined && startYear < variable.startYear) {
			reasons.push(`${variable.name} starts in ${variable.startYear}`);
		}
		const detail = reasons.length ? ` (${reasons.join('; ')})` : '';
		throw new ArchiveError(
			`No ${variable.name} data for ${model} at this location between ${start} and ${end}${detail}`,
			response.status
		);
	}

	const points: ArchiveTimePoint[] = [];
	for (let i = 0; i < times.length; i++) {
		const value = raw[i];
		if (typeof value === 'number' && Number.isFinite(value)) {
			const t = Date.parse(times[i]);
			if (Number.isFinite(t)) points.push({ time: t, value });
		}
	}

	// The API reports `undefined` as a literal string for some parameters, so
	// fall back to the unit we declared rather than displaying "undefined".
	const reportedUnit =
		resolution === 'daily'
			? (body.daily_units as Record<string, string> | undefined)?.[key]
			: (body.hourly_units as Record<string, string> | undefined)?.[key];
	const unit = reportedUnit && reportedUnit !== 'undefined' ? reportedUnit : variable.unit;

	return {
		variable,
		model,
		resolution,
		points,
		totalCount: times.length,
		missingCount: times.length - points.length,
		unit,
		latitude: body.latitude,
		longitude: body.longitude,
		elevation: body.elevation
	};
}

/**
 * Month-resolution cache. A 45-year daily request returns tens of thousands of
 * points, so re-fetching on every panel toggle would be wasteful and would eat
 * into the API's per-minute budget. Keyed by everything that changes the answer.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; result: ArchiveResult }>();

/** Exposed for tests and for clearing on memory pressure. */
export function clearArchiveCache(): void {
	cache.clear();
}

export function getArchiveCacheSize(): number {
	return cache.size;
}

export async function fetchArchiveSeriesCached(
	variable: ArchiveVariable,
	model: ArchiveModel,
	lat: number,
	lon: number,
	startYear: number,
	endYear: number,
	resolution?: ArchiveResolution
): Promise<ArchiveResult> {
	const resolved = resolution ?? (supportsDailyResolution(variable) ? 'daily' : 'hourly');
	const key = [
		variable.name,
		model,
		resolved,
		lat.toFixed(3),
		lon.toFixed(3),
		Math.floor(startYear),
		Math.floor(endYear)
	].join('|');
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

	const result = await fetchArchiveSeries(variable, model, lat, lon, startYear, endYear, resolved);
	cache.set(key, { at: Date.now(), result });
	return result;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type ArchiveStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ArchiveState {
	/** Whether the panel is open. */
	open: boolean;
	latitude?: number;
	longitude?: number;
	/** Which location the grid cell resolved to; may differ from the click. */
	gridLatitude?: number;
	gridLongitude?: number;
	elevation?: number;
	variable: string;
	model: ArchiveModel;
	startYear: number;
	endYear: number;
	/** Long-term normal window used for the anomaly view. */
	climatologyStartYear: number;
	climatologyEndYear: number;
	status: ArchiveStatus;
	error?: string;
	series?: ArchiveResult;
	/** Bumped on every request so a slow response cannot overwrite a newer one. */
	requestSeq: number;
}

const DEFAULT_START_YEAR = 1980;
const currentYear = new Date().getUTCFullYear();

export const archiveState: Writable<ArchiveState> = writable({
	open: false,
	variable: 'temperature_2m',
	model: 'era5',
	startYear: DEFAULT_START_YEAR,
	endYear: currentYear - 1,
	climatologyStartYear: CLIMATOLOGY_START_YEAR,
	climatologyEndYear: CLIMATOLOGY_END_YEAR,
	status: 'idle',
	requestSeq: 0
});

let inflight: AbortController | undefined;

/** Abort any pending request; a new selection supersedes the previous one. */
export function cancelArchiveRequest(): void {
	inflight?.abort();
	inflight = undefined;
}

let requestCounter = 0;

/**
 * Load a series into the store. Returns early when the request has been
 * superseded, so fast variable switching cannot leave stale data on screen.
 */
export async function loadArchive(
	variable: string,
	model: ArchiveModel,
	lat: number,
	lon: number,
	startYear: number,
	endYear: number
): Promise<void> {
	const definition = getArchiveVariable(variable);
	if (!definition) {
		archiveState.update((s) => ({
			...s,
			status: 'error',
			error: `Unknown variable "${variable}"`
		}));
		return;
	}

	cancelArchiveRequest();
	const controller = new AbortController();
	inflight = controller;
	const seq = ++requestCounter;

	archiveState.update((s) => ({ ...s, status: 'loading', error: undefined, requestSeq: seq }));

	try {
		const result = await fetchArchiveSeriesCached(definition, model, lat, lon, startYear, endYear);
		if (seq !== requestCounter) return;
		archiveState.update((s) => ({
			...s,
			status: 'ready',
			series: result,
			gridLatitude: result.latitude,
			gridLongitude: result.longitude,
			elevation: result.elevation,
			error: undefined
		}));
	} catch (e) {
		if (seq !== requestCounter) return;
		if (e instanceof DOMException && e.name === 'AbortError') return;
		archiveState.update((s) => ({
			...s,
			status: 'error',
			series: undefined,
			error: e instanceof Error ? e.message : 'Failed to load archive data'
		}));
	} finally {
		if (inflight === controller) inflight = undefined;
	}
}

/** Open the panel at a map location and load the currently selected variable. */
export function openArchiveAt(
	lat: number,
	lon: number,
	variable = 'temperature_2m',
	model: ArchiveModel = 'era5'
): void {
	archiveState.update((s) => ({
		...s,
		open: true,
		latitude: lat,
		longitude: lon,
		variable,
		model
	}));
	const { startYear, endYear } = get(archiveState);
	void loadArchive(variable, model, lat, lon, startYear, endYear);
}

export function closeArchive(): void {
	cancelArchiveRequest();
	archiveState.update((s) => ({ ...s, open: false }));
}

/** Change variable and reload, keeping location and period. */
export function setArchiveVariable(variable: string): void {
	archiveState.update((s) => ({ ...s, variable }));
	const s = get(archiveState);
	if (s.latitude !== undefined && s.longitude !== undefined) {
		void loadArchive(variable, s.model, s.latitude, s.longitude, s.startYear, s.endYear);
	}
}

/** Change model and reload, keeping location and period. */
export function setArchiveModel(model: ArchiveModel): void {
	archiveState.update((s) => ({ ...s, model }));
	const s = get(archiveState);
	if (s.latitude !== undefined && s.longitude !== undefined) {
		void loadArchive(s.variable, model, s.latitude, s.longitude, s.startYear, s.endYear);
	}
}

/** Change the analysis period and reload. */
export function setArchivePeriod(startYear: number, endYear: number): void {
	const from = Math.min(startYear, endYear);
	const to = Math.max(startYear, endYear);
	archiveState.update((s) => ({ ...s, startYear: from, endYear: to }));
	const s = get(archiveState);
	if (s.latitude !== undefined && s.longitude !== undefined) {
		void loadArchive(s.variable, s.model, s.latitude, s.longitude, from, to);
	}
}

// Minimal `get` so this module does not need to import from svelte/store's
// component-context-aware helpers.
function get(store: Writable<ArchiveState>): ArchiveState {
	let value!: ArchiveState;
	const unsubscribe = store.subscribe((v) => {
		value = v;
	});
	unsubscribe();
	return value;
}
