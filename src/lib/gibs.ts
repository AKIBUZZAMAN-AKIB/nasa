/**
 * NASA GIBS (Global Imagery Browse Services) catalogue and date logic.
 *
 * The forecast layers of this app come from the Open-Meteo data pipeline,
 * which only keeps roughly the last week of model runs. GIBS serves the same
 * kind of raster imagery straight from NASA's EOSDIS archive instead: every
 * layer is a WMTS tile service with a `{Time}` dimension and **no API key**,
 * so imagery from 1980 onwards can be shown on the map by only changing the
 * date in the tile URL.
 *
 * Everything in this module is pure: catalogue data, URL builders and the
 * date arithmetic (snapping a requested day to a layer's real cadence, and
 * finding the nearest day that actually has imagery). The map wiring lives in
 * `$lib/gibs-layers`, the UI state in `$lib/stores/gibs`.
 *
 * Sources, verified live against
 * https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/WMTSCapabilities.xml:
 *  - tile template   `${base}/{LAYER}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}.{ext}`
 *  - available dates `${base}/1.0.0/{LAYER}/default/{TileMatrixSet}/all/{start}--{end}.xml`
 *  - metadata        `https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/{LAYER}.json`
 * All three answer with `Access-Control-Allow-Origin: *`, so they are usable
 * directly from the browser.
 */

/** Key-free, CORS-enabled WMTS endpoint in Web Mercator (matches MapLibre). */
export const GIBS_BASE_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

/** Credit required by the GIBS terms of use, added to the raster source. */
export const GIBS_ATTRIBUTION = 'NASA GIBS / EOSDIS';

/** Categories group the picker; the order here is the order in the UI. */
export const GIBS_CATEGORIES = [
	{ id: 'imagery', label: 'Imagery' },
	{ id: 'flood', label: 'Floods & water' },
	{ id: 'precipitation', label: 'Precipitation' },
	{ id: 'temperature', label: 'Temperature' },
	{ id: 'aerosol', label: 'Aerosol & air quality' },
	{ id: 'land', label: 'Land & vegetation' },
	{ id: 'ocean', label: 'Ocean' }
] as const;

export type GibsCategory = (typeof GIBS_CATEGORIES)[number]['id'];

/**
 * Temporal cadence of a layer. Daily layers accept any day inside an
 * availability range; 16-day and monthly layers accept any date but only
 * change every 16 days / month, so a requested day is snapped to the start of
 * the period its imagery belongs to.
 */
export type GibsPeriod = 'P1D' | 'P16D' | 'P1M';

export interface GibsLayerDef {
	/** GIBS layer identifier (also the Worldview layer id). */
	id: string;
	/** Official GIBS title. */
	title: string;
	/** Platform / sensor, e.g. `Terra / MODIS`. */
	subtitle: string;
	category: GibsCategory;
	period: GibsPeriod;
	/** Lowest-resolution TileMatrixSet the layer is published on. */
	tileMatrixSet: string;
	/** Native ground resolution of the underlying product. */
	resolution: string;
	/** Source dataset short name and version (from GIBS layer metadata). */
	dataset?: string;
	/** First day with imagery, from the WMTS capabilities (ISO `YYYY-MM-DD`). */
	coverageStart: string;
	/** Colour-bar SVG published by GIBS, shown under the map controls. */
	legend?: string;
	/** Extra guidance for interpreting the layer. */
	note?: string;
	/** `png` keeps transparency (data layers); `jpg` is for imagery. */
	extension: 'png' | 'jpg';
}

/**
 * The catalogue. Each entry was verified tile by tile against the live
 * endpoint (HTTP 200, `image/*`) and its metadata cross-checked with
 * `layer-metadata/v1.0/<id>.json`.
 */
export const GIBS_LAYERS: GibsLayerDef[] = [
	// ── Imagery ───────────────────────────────────────────────────────────────
	{
		id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
		title: 'Corrected Reflectance (True Color)',
		subtitle: 'Terra / MODIS',
		category: 'imagery',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '250 m',
		dataset: 'MOD02QKM v6.1',
		coverageStart: '2000-02-24',
		note: 'How the Earth looks from space, clouds included — the reference image for any date.',
		extension: 'jpg'
	},
	{
		id: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
		title: 'Corrected Reflectance (True Color)',
		subtitle: 'Aqua / MODIS',
		category: 'imagery',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '250 m',
		dataset: 'MYD02QKM v6.1',
		coverageStart: '2002-07-03',
		note: 'Afternoon overpass — pairs with Terra (morning) to see the same day twice.',
		extension: 'jpg'
	},
	{
		id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
		title: 'Corrected Reflectance (True Color)',
		subtitle: 'Suomi NPP / VIIRS',
		category: 'imagery',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '375 m',
		dataset: 'VNP02IMG_NRT v2',
		coverageStart: '2015-11-24',
		note: 'Sharper successor to MODIS, still flying on Suomi NPP.',
		extension: 'jpg'
	},
	{
		id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
		title: 'Corrected Reflectance (True Color)',
		subtitle: 'NOAA-20 / VIIRS',
		category: 'imagery',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '375 m',
		dataset: 'VJ102IMG_NRT v2.1',
		coverageStart: '2018-01-05',
		extension: 'jpg'
	},
	{
		id: 'MODIS_Terra_CorrectedReflectance_Bands721',
		title: 'Corrected Reflectance (Bands 7-2-1)',
		subtitle: 'Terra / MODIS',
		category: 'imagery',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '250 m',
		dataset: 'MOD02QKM v6.1',
		coverageStart: '2000-02-24',
		note: 'Water is black, vegetation green, clouds bright — the classic flood-extent view.',
		extension: 'jpg'
	},
	{
		id: 'MODIS_Terra_CorrectedReflectance_Bands367',
		title: 'Corrected Reflectance (Bands 3-6-7)',
		subtitle: 'Terra / MODIS',
		category: 'imagery',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '500 m',
		dataset: 'MOD02QKM v6.1',
		coverageStart: '2000-02-24',
		note: 'Fires glow red, smoke appears yellow — for burning and haze episodes.',
		extension: 'jpg'
	},
	{
		id: 'VIIRS_SNPP_DayNightBand',
		title: 'Nighttime Imagery (Day/Night Band)',
		subtitle: 'Suomi NPP / VIIRS',
		category: 'imagery',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level7',
		resolution: '750 m',
		dataset: 'VNP02DNB v2',
		coverageStart: '2012-03-01',
		legend: 'https://gibs.earthdata.nasa.gov/legends/VIIRS_SNPP_DayNightBand_ENCC_H.svg',
		note: 'Moonlit night imagery: city lights, gas flares and power outages.',
		extension: 'png'
	},

	// ── Floods & water ────────────────────────────────────────────────────────
	{
		id: 'MODIS_Combined_Flood_1-Day',
		title: 'Flood (1-Day Window)',
		subtitle: 'Terra and Aqua / MODIS',
		category: 'flood',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '250 m',
		dataset: 'MCDWD_L3_NRT v6.1',
		coverageStart: '2021-01-01',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Flood_H.svg',
		note: 'Surface water mapped from both MODIS sensors; gaps mean cloud cover, not dry land.',
		extension: 'png'
	},
	{
		id: 'MODIS_Combined_Flood_3-Day',
		title: 'Flood (3-Day Window)',
		subtitle: 'Terra and Aqua / MODIS',
		category: 'flood',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '250 m',
		dataset: 'MCDWD_L3_NRT v6.1',
		coverageStart: '2021-01-01',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Flood_H.svg',
		note: 'Composite of three days — better monsoon coverage when clouds hide single days.',
		extension: 'png'
	},
	{
		id: 'VIIRS_Combined_Flood_1-Day',
		title: 'Flood (1-Day Window)',
		subtitle: 'NOAA-20 and NOAA-21/VIIRS',
		category: 'flood',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '375 m',
		dataset: 'VCDWD_L3_NRT v2',
		coverageStart: '2025-06-03',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Flood_H.svg',
		note: 'Newer, higher-resolution flood mapping — available from mid-2025 only.',
		extension: 'png'
	},
	{
		id: 'MODIS_Terra_NDSI_Snow_Cover',
		title: 'Snow Cover (Normalized Difference Snow Index)',
		subtitle: 'Terra / MODIS',
		category: 'flood',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level8',
		resolution: '500 m',
		dataset: 'MOD10_L2 v61',
		coverageStart: '2000-02-24',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_NDSI_Snow_Cover_H.svg',
		note: 'Himalayan snowpack feeds the Ganges–Brahmaputra; snowmelt precedes monsoon flooding.',
		extension: 'png'
	},

	// ── Precipitation ─────────────────────────────────────────────────────────
	{
		id: 'IMERG_Precipitation_Rate',
		title: 'Precipitation Rate',
		subtitle: 'IMERG',
		category: 'precipitation',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '0.1° (~11 km)',
		dataset: 'GPM_3IMERGHH v07',
		coverageStart: '2000-06-01',
		legend: 'https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg',
		note: 'Merged satellite + gauge rainfall — the longest satellite precipitation record on GIBS.',
		extension: 'png'
	},

	// ── Temperature ───────────────────────────────────────────────────────────
	{
		id: 'MODIS_Terra_Land_Surface_Temp_Day',
		title: 'Land Surface Temperature (Day)',
		subtitle: 'Terra / MODIS',
		category: 'temperature',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level7',
		resolution: '1 km',
		dataset: 'MOD11_L2 v006',
		coverageStart: '2000-02-24',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_H.svg',
		note: 'Skin temperature of the ground, not air temperature — heat-island and drought studies.',
		extension: 'png'
	},
	{
		id: 'MODIS_Terra_Land_Surface_Temp_Night',
		title: 'Land Surface Temperature (Night)',
		subtitle: 'Terra / MODIS',
		category: 'temperature',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level7',
		resolution: '1 km',
		dataset: 'MOD11_L2 v006',
		coverageStart: '2000-02-24',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_H.svg',
		note: 'Night cooling — compare with the day layer to see how fast surfaces re-radiate heat.',
		extension: 'png'
	},
	{
		id: 'MODIS_Terra_Cloud_Top_Temp_Day',
		title: 'Cloud Top Temperature (Day)',
		subtitle: 'Terra / MODIS',
		category: 'temperature',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '5 km',
		dataset: 'MOD06_L2 v6.1',
		coverageStart: '2000-02-24',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Cloud_Top_Temp_H.svg',
		note: 'Cold tops (purple) mark deep convection — the signature of monsoon thunderstorms.',
		extension: 'png'
	},
	{
		id: 'AIRS_L2_Surface_Air_Temperature_Day',
		title: 'Surface Air Temperature (L2, Day)',
		subtitle: 'Aqua / AIRS',
		category: 'temperature',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '45 km / pixel at nadir',
		dataset: 'AIRS2RET v7.0',
		coverageStart: '2002-08-30',
		legend: 'https://gibs.earthdata.nasa.gov/legends/AIRS_Temperature_H.svg',
		note: 'Infrared sounder, so it sees through thin cloud and reports air (not skin) temperature.',
		extension: 'png'
	},
	{
		id: 'MERRA2_2m_Air_Temperature_Monthly',
		title: '2-meter Air Temperature (Monthly)',
		subtitle: 'MERRA-2',
		category: 'temperature',
		period: 'P1M',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '0.5° × 0.625° (~55 × 70 km)',
		dataset: 'M2TMNXSLV v5.12.4',
		coverageStart: '1980-01-01',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MERRA2_2m_Air_Temperature_Monthly_H.svg',
		note: 'Model reanalysis, complete since 1980 — monthly climate context for any point on Earth.',
		extension: 'png'
	},

	// ── Aerosol & air quality ─────────────────────────────────────────────────
	{
		id: 'MODIS_Terra_Aerosol_Optical_Depth_3km',
		title: 'Aerosol Optical Depth 3km (3km, Land and Ocean)',
		subtitle: 'Terra / MODIS',
		category: 'aerosol',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '3 km',
		dataset: 'MOD04_3K v6.1',
		coverageStart: '2000-02-24',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_VIIRS_AOD_H.svg',
		note: 'Morning overpass; thick haze shows as orange to red — Dhaka winter smog is unmistakable.',
		extension: 'png'
	},
	{
		id: 'MODIS_Aqua_Aerosol_Optical_Depth_3km',
		title: 'Aerosol Optical Depth 3km (3km, Land and Ocean)',
		subtitle: 'Aqua / MODIS',
		category: 'aerosol',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '3 km',
		dataset: 'MYD04_3K v6.1',
		coverageStart: '2002-07-03',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_VIIRS_AOD_H.svg',
		note: 'Afternoon overpass — the second look at the same day.',
		extension: 'png'
	},
	{
		id: 'MERRA2_Aerosol_Optical_Depth_Analysis_Monthly',
		title: 'Aerosol Optical Depth Analysis (Monthly)',
		subtitle: 'MERRA-2',
		category: 'aerosol',
		period: 'P1M',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '0.5° × 0.625° (~55 × 70 km)',
		dataset: 'M2IMNXGAS v5.12.4',
		coverageStart: '1980-01-01',
		legend:
			'https://gibs.earthdata.nasa.gov/legends/MERRA2_Aerosol_Optical_Depth_Analysis_Monthly_H.svg',
		note: 'Gap-free monthly aerosol since 1980 — the only long aerosol baseline on GIBS.',
		extension: 'png'
	},
	{
		id: 'OMI_Nitrogen_Dioxide_Tropo_Column',
		title: 'Nitrogen Dioxide (Tropospheric Column)',
		subtitle: 'Aura / OMI',
		category: 'aerosol',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '0.25° (pixel 13 × 24 km)',
		dataset: 'OMNO2d v004',
		coverageStart: '2004-10-01',
		legend: 'https://gibs.earthdata.nasa.gov/legends/OMI_Nitrogen_Dioxide_Tropo_Column_H.svg',
		note: 'Combustion tracer: traffic, industry and crop-residue burning.',
		extension: 'png'
	},

	// ── Land & vegetation ─────────────────────────────────────────────────────
	{
		id: 'MODIS_Terra_L3_NDVI_16Day',
		title: 'Vegetation Index (L3, 16-Day)',
		subtitle: 'Terra / MODIS',
		category: 'land',
		period: 'P16D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '250 m',
		dataset: 'MOD13Q1 v006',
		coverageStart: '2000-03-05',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_L3_NDVI_H.svg',
		note: 'Greenness index — crop calendars, drought stress and post-flood recovery.',
		extension: 'png'
	},
	{
		id: 'MODIS_Aqua_L3_NDVI_16Day',
		title: 'Vegetation Index (L3, 16-Day)',
		subtitle: 'Aqua / MODIS',
		category: 'land',
		period: 'P16D',
		tileMatrixSet: 'GoogleMapsCompatible_Level9',
		resolution: '250 m',
		dataset: 'MYD13Q1 v006',
		coverageStart: '2002-07-04',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_L3_NDVI_H.svg',
		extension: 'png'
	},
	{
		id: 'SMAP_L3_Passive_Day_Soil_Moisture',
		title: 'Soil Moisture 36 km (L3, Passive, Day)',
		subtitle: 'SMAP / Radiometer',
		category: 'land',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '36 km',
		dataset: 'SPL3SMP v009',
		coverageStart: '2015-03-31',
		legend: 'https://gibs.earthdata.nasa.gov/legends/SMAP_Soil_Moisture_H.svg',
		note: 'Microwave soil moisture — root-zone wetness before floods appear on the surface.',
		extension: 'png'
	},
	{
		id: 'MODIS_Combined_L3_Black_Sky_Albedo_Daily',
		title: 'Black Sky Albedo (L3, Daily)',
		subtitle: 'Terra and Aqua / MODIS',
		category: 'land',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level8',
		resolution: '500 m',
		dataset: 'MCD43A3 v061',
		coverageStart: '2000-05-18',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Combined_Albedo_Daily_H.svg',
		note: 'How much sunlight the surface reflects — surface-energy and land-cover research.',
		extension: 'png'
	},

	// ── Ocean ─────────────────────────────────────────────────────────────────
	{
		id: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
		title: 'Sea Surface Temperature (L4, MUR)',
		subtitle: 'Multi-mission / GHRSST',
		category: 'ocean',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level7',
		resolution: '0.01° (~1 km)',
		dataset: 'MUR-JPL-L4-GLOB-v4.1 v4.1',
		coverageStart: '2002-06-01',
		legend: 'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_H.svg',
		note: 'Bay of Bengal SST — warm anomalies fuel cyclogenesis before landfall.',
		extension: 'png'
	},
	{
		id: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies',
		title: 'Sea Surface Temperature Anomalies (L4, MUR)',
		subtitle: 'Multi-mission / GHRSST',
		category: 'ocean',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level7',
		resolution: '0.01° (~1 km)',
		dataset: 'MUR-JPL-L4-GLOB-v4.1 v4.1',
		coverageStart: '2019-07-23',
		legend:
			'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_Anomalies_H.svg',
		note: 'Warm or cool against the 2003–2014 climatology — the quickest storm-fuel check.',
		extension: 'png'
	},
	{
		id: 'MODIS_Terra_L2_Chlorophyll_A',
		title: 'Chlorophyll a (L2)',
		subtitle: 'Terra / MODIS',
		category: 'ocean',
		period: 'P1D',
		tileMatrixSet: 'GoogleMapsCompatible_Level7',
		resolution: '1 km',
		dataset: 'MODIST_L2_OC v2022.0',
		coverageStart: '2000-02-24',
		legend: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Chlorophyll_H.svg',
		note: 'Phytoplankton pigment — fishery productivity and river-plume mapping.',
		extension: 'png'
	}
];

/** Look up a catalogue entry by its GIBS identifier. */
export const gibsLayerById = (id: string | null | undefined): GibsLayerDef | undefined =>
	GIBS_LAYERS.find((layer) => layer.id === id);

/** Layers of one category, in catalogue order. */
export const gibsLayersByCategory = (category: GibsCategory): GibsLayerDef[] =>
	GIBS_LAYERS.filter((layer) => layer.category === category);

/**
 * WMTS tile template for one layer and day, with the `{z}/{x}/{y}` placeholders
 * MapLibre expects. `Time` accepts a full ISO 8601 date as used by GIBS.
 */
export const gibsTileUrl = (layer: GibsLayerDef, date: string): string =>
	`${GIBS_BASE_URL}/${layer.id}/default/${date}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.extension}`;

/** One contiguous run of available imagery, as published by GIBS. */
export interface GibsAvailabilityRange {
	/** First available day, ISO `YYYY-MM-DD`. */
	start: string;
	/** Last available day, ISO `YYYY-MM-DD`. */
	end: string;
	/** Cadence in days: 1 (daily), 16 (16-day composites), 1 for monthly too. */
	stepDays: number;
	/** Raw `P…` duration from the GIBS response, `P1D` / `P16D` / `P1M`. */
	step: GibsPeriod | string;
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` → epoch ms (UTC midnight). */
export const isoDayToMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Epoch ms → `YYYY-MM-DD` (UTC). */
export const msToIsoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Shift an ISO day by whole days (negative moves into the past). */
export const shiftIsoDay = (day: string, days: number): string =>
	msToIsoDay(isoDayToMs(day) + days * DAY_MS);

/** Whole days between two ISO days (b − a). */
export const isoDayDiff = (a: string, b: string): number =>
	Math.round((isoDayToMs(b) - isoDayToMs(a)) / DAY_MS);

/** `P1D` / `P16D` / `P1M` → cadence in days (monthly reported as 1, see `snapToPeriod`). */
const stepToDays = (step: string): number => {
	const match = /^P(\d+)D$/.exec(step);
	return match ? Number(match[1]) : 1;
};

/**
 * Parse the body of the available-dates endpoint, which lists compact ranges:
 * `2000-02-24/2000-04-25/P1D,2000-04-28/2000-08-06/P1D`. A single-day range
 * (`2025-04-08/2025-04-08/P1M`) is kept as-is. Unparseable parts are skipped
 * rather than throwing: the layer simply looks less covered.
 */
export const parseGibsAvailability = (xml: string): GibsAvailabilityRange[] => {
	const domain = /<Domain>([\s\S]*?)<\/Domain>/.exec(xml)?.[1];
	if (!domain || !domain.trim()) return [];
	const ranges: GibsAvailabilityRange[] = [];
	for (const part of domain.split(',')) {
		const [start, end, step = 'P1D'] = part.trim().split('/');
		if (!start || !end) continue;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
		ranges.push({ start, end, stepDays: stepToDays(step), step });
	}
	return ranges.sort((a, b) => (a.start < b.start ? -1 : 1));
};

/** The available-dates request for a layer and window (start and end inclusive). */
export const gibsAvailabilityUrl = (layer: GibsLayerDef, start: string, end: string): string =>
	`${GIBS_BASE_URL}/1.0.0/${layer.id}/default/${layer.tileMatrixSet}/all/${start}--${end}.xml`;

/** Last day with imagery, which is what "latest" means for this layer. */
export const latestAvailableDay = (ranges: GibsAvailabilityRange[]): string | undefined =>
	ranges.length ? ranges[ranges.length - 1].end : undefined;

/** First day with imagery published for this layer. */
export const earliestAvailableDay = (ranges: GibsAvailabilityRange[]): string | undefined =>
	ranges[0]?.start;

/** Range containing a day, or undefined when the day sits in a gap. */
const rangeAt = (ranges: GibsAvailabilityRange[], day: string): GibsAvailabilityRange | undefined =>
	ranges.find((range) => range.start <= day && day <= range.end);

/**
 * Snap a day to the start of the composite period it belongs to: aggregating
 * layers only publish one image per period (16 days, or a calendar month), so
 * asking for the snapped day keeps the label honest. Daily layers are
 * returned unchanged.
 */
export const snapToPeriod = (
	layer: GibsLayerDef,
	day: string,
	ranges: GibsAvailabilityRange[] = []
): string => {
	if (layer.period === 'P1M') return `${day.slice(0, 7)}-01`;
	if (layer.period === 'P1D') return day;
	const range = rangeAt(ranges, day);
	if (!range) return day;
	const offset = isoDayDiff(range.start, day);
	return shiftIsoDay(range.start, Math.floor(offset / range.stepDays) * range.stepDays);
};

/**
 * The day that will actually be rendered for a request: the snapped day when
 * it has imagery, otherwise the nearest available day (clamped to the ends of
 * the archive). Returns undefined only when the layer has no imagery at all in
 * the requested window.
 */
export const resolveAvailableDay = (
	layer: GibsLayerDef,
	day: string,
	ranges: GibsAvailabilityRange[]
): string | undefined => {
	if (!ranges.length) return undefined;
	const earliest = earliestAvailableDay(ranges);
	const latest = latestAvailableDay(ranges);
	if (earliest === undefined || latest === undefined) return undefined;

	if (day < earliest) return snapToPeriod(layer, earliest, ranges);
	if (day > latest) return snapToPeriod(layer, latest, ranges);

	const snapped = snapToPeriod(layer, day, ranges);
	if (rangeAt(ranges, snapped)) return snapped;

	// Inside the covered span but in a gap: walk outwards, day by day, until an
	// available range is hit — gaps are short (a few days) in practice.
	for (let distance = 1; distance <= 400; distance++) {
		const before = shiftIsoDay(snapped, -distance);
		const after = shiftIsoDay(snapped, distance);
		if (after <= latest && rangeAt(ranges, after)) return after;
		if (before >= earliest && rangeAt(ranges, before)) return before;
	}
	return undefined;
};

/** Human-readable coverage/summary line for the panel. */
export const describeCoverage = (ranges: GibsAvailabilityRange[]): string => {
	if (!ranges.length) return 'No imagery published for this layer';
	const first = ranges[0].start;
	const last = ranges[ranges.length - 1].end;
	const years = Math.floor(isoDayDiff(first, last) / 365.25);
	const gaps = ranges.length - 1;
	const span = `${first} → ${last}`;
	return gaps > 0
		? `${span} (${years} yr, ${gaps} gap${gaps === 1 ? '' : 's'})`
		: `${span} (${years} yr)`;
};

/**
 * Worldview link for the same layer and day — one click to the NASA tool, with
 * the map view (`west,south,east,north`) carried over when the caller has one.
 */
export const gibsWorldviewUrl = (
	layer: GibsLayerDef,
	day: string,
	view?: [number, number, number, number]
): string => {
	const [west, south, east, north] = view ?? [85, 18, 95, 29];
	const round = (value: number): number => Math.round(value * 100) / 100;
	return `https://worldview.earthdata.nasa.gov/?v=${round(west)},${round(south)},${round(east)},${round(north)}&t=${day}&l=${layer.id}&lg=false`;
};

/** One bar of the availability strip, as a fraction of the archive span. */
export interface GibsRibbonSegment {
	/** Left edge, 0–1 across the whole archive span. */
	left: number;
	/** Width, 0–1 across the whole archive span. */
	width: number;
}

/**
 * Coverage strip data for the panel: every availability range as a fraction
 * of the layer's archive span, so gaps (sensor outages, unprocessed days)
 * become visible at a glance instead of only being noticed when a date
 * refuses to load.
 *
 * The span counts both end days, so a range running to the end of the archive
 * reaches exactly the right edge of the bar.
 */
export const gibsRibbonSegments = (
	ranges: GibsAvailabilityRange[],
	first: string,
	last: string
): GibsRibbonSegment[] => {
	const span = Math.max(1, isoDayDiff(first, last) + 1);
	return ranges.map((range) => ({
		left: Math.max(0, Math.min(1, isoDayDiff(first, range.start) / span)),
		width: Math.max(0, Math.min(1, (isoDayDiff(range.start, range.end) + 1) / span))
	}));
};

/**
 * Left edge of a day on the same strip (0–1), for the "showing" marker: the
 * marker sits where that day's own slice starts, so on a single-day archive it
 * lands on the left edge and on the last day it stops just short of the right.
 */
export const gibsRibbonFraction = (day: string, first: string, last: string): number => {
	const span = Math.max(1, isoDayDiff(first, last) + 1);
	return Math.min(1, Math.max(0, isoDayDiff(first, day) / span));
};

/** `2024-06-15` → `Sat 15 Jun 2024`, so a date is readable at a glance. */
export const formatGibsDay = (day: string, locale = 'en-GB'): string =>
	new Intl.DateTimeFormat(locale, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${day}T00:00:00Z`));

/**
 * `2024-06-15T13:45:00Z` → `2024-06-15`: the day the app's clock points at, in
 * UTC, which is the axis GIBS publishes on.
 */
export const isoDayOf = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * `2024-06-15` → noon UTC that day. The app renders the clock in local time, so
 * landing in the middle of the UTC day keeps the local date the same one the
 * imagery shows for every offset the app is realistically used in.
 */
export const isoDayAtNoon = (day: string): Date => new Date(`${day}T12:00:00Z`);

/** Address-bar keys for a shared satellite view. */
export const GIBS_URL_LAYER_PARAM = 'gibs';
export const GIBS_URL_DATE_PARAM = 'gibs-date';

/**
 * Parameters to write for the current selection. Defaults stay out of the URL:
 * the layer while the default one is shown, and the day while the newest day is
 * shown, so a shared link keeps following the archive instead of freezing on
 * the day it was copied.
 */
export const gibsUrlParams = (state: {
	browsing: boolean;
	layerId: string;
	day?: string;
	latest?: string;
	defaultLayerId: string;
}): Record<string, string> => {
	if (!state.browsing) return {};
	const params: Record<string, string> = {};
	if (state.layerId !== state.defaultLayerId) params[GIBS_URL_LAYER_PARAM] = state.layerId;
	if (state.day && state.day !== state.latest) params[GIBS_URL_DATE_PARAM] = state.day;
	return params;
};

/** A real `YYYY-MM-DD` day: the shape has to survive a round trip through Date. */
const isIsoDay = (value: string | null | undefined): value is string =>
	!!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftIsoDay(value, 0) === value;

/** Layer id and day from a location search string, ignoring anything invalid. */
export const parseGibsUrl = (search: string): { layerId?: string; day?: string } => {
	const params = new URLSearchParams(search);
	const layerId = params.get(GIBS_URL_LAYER_PARAM);
	const day = params.get(GIBS_URL_DATE_PARAM);
	return {
		layerId: layerId && gibsLayerById(layerId) ? layerId : undefined,
		day: isIsoDay(day) ? day : undefined
	};
};
