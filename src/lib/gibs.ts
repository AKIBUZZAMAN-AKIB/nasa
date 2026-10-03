/**
 * NASA GIBS (Global Imagery Browse Services) catalogue and date logic.
 *
 * The hand-curated layer definitions below are retained as richer quick picks,
 * then merged with a generated snapshot of the four official WMTS `/all`
 * Capabilities documents (Best Available, standard, and NRT variants). The
 * snapshot makes the complete WMTS catalogue immediately searchable;
 * per-layer temporal coverage is still resolved live through DescribeDomains.
 *
 * The map itself is MapLibre/Web Mercator (EPSG:3857). Raster WMTS layers use
 * their native Web-Mercator tiles; vector products are requested as the NASA
 * default-styled WMS raster (GIBS's WMTS vector tiles are not a reliable
 * EPSG:3857 source); polar-only products stay discoverable but are explicitly
 * marked as not renderable in this map.
 */
import gibsCatalogSnapshot from './gibs-catalog.generated.json';

/** Key-free, CORS-enabled WMTS endpoint in Web Mercator (matches MapLibre). */
export const GIBS_BASE_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/all';

export const GIBS_WMTS_BASE_URLS = {
	epsg3857: GIBS_BASE_URL,
	epsg4326: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/all',
	epsg3413: 'https://gibs.earthdata.nasa.gov/wmts/epsg3413/all',
	epsg3031: 'https://gibs.earthdata.nasa.gov/wmts/epsg3031/all'
} as const;

/** `WMS/epsg4326` supports vector products returned as images in EPSG:3857. */
export const GIBS_VECTOR_WMS_URL = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/all/wms.cgi';

/** Credit required by the GIBS terms of use, added to the raster source. */
export const GIBS_ATTRIBUTION = 'NASA GIBS / EOSDIS';

/** Categories group the selector; the order here is the order in the UI. */
export const GIBS_CATEGORIES = [
	{ id: 'imagery', label: 'Imagery & reflectance' },
	{ id: 'flood', label: 'Floods & water' },
	{ id: 'precipitation', label: 'Precipitation' },
	{ id: 'temperature', label: 'Temperature & thermal' },
	{ id: 'aerosol', label: 'Aerosol & air quality' },
	{ id: 'atmosphere', label: 'Atmosphere & clouds' },
	{ id: 'land', label: 'Land & vegetation' },
	{ id: 'ocean', label: 'Ocean & coasts' },
	{ id: 'cryosphere', label: 'Ice & snow' },
	{ id: 'hazards', label: 'Hazards & fires' },
	{ id: 'topography', label: 'Elevation & terrain' },
	{ id: 'biodiversity', label: 'Biodiversity' },
	{ id: 'other', label: 'Other' }
] as const;

export type GibsCategory = (typeof GIBS_CATEGORIES)[number]['id'];
export type GibsProjection = 'epsg3857' | 'epsg4326' | 'epsg3413' | 'epsg3031';
export type GibsMapSupport = 'wmts-raster' | 'wms-rasterized-vector' | 'projection-only';

/** ISO-8601 durations published by GIBS, or `static` for timeless layers. */
export type GibsPeriod = string;

/** NASA CMR source product associated with a Worldview/GIBS visualization. */
export interface GibsSourceProduct {
	id: string;
	shortName?: string;
	title?: string;
	version?: string;
	type?: string;
}

export interface GibsLayerDef {
	/** GIBS layer identifier (also the Worldview layer id). */
	id: string;
	/** Official GIBS title. */
	title: string;
	/** Platform / sensor, e.g. `Terra / MODIS`; from the official Worldview catalog. */
	subtitle: string;
	/** Official Worldview measurement and product-group labels. */
	layerGroup?: string | string[];
	productGroup?: string;
	/** Official search tags and source science products. */
	searchTags?: string[];
	dataProducts?: GibsSourceProduct[];
	/** Exact Worldview config ID, when this WMTS ID is included in its layer picker. */
	worldviewLayerId?: string;
	category: GibsCategory;
	/** ISO cadence such as `P1D`, `P8D`, `P1M`, `PT10M`, or `static`. */
	period: GibsPeriod;
	/** TileMatrixSet used by the map service for this layer. */
	tileMatrixSet: string;
	/** GIBS imagery pixel resolution; not the projected map's maximum zoom. */
	resolution: string;
	/** Matrix set and projection used to determine the imagery-resolution label. */
	resolutionMatrixSet?: string;
	resolutionProjection?: GibsProjection;
	/** Source dataset short name and version (from curated GIBS metadata). */
	dataset?: string;
	/** Earliest date shown by the Capabilities snapshot (for UI fallback only). */
	coverageStart: string;
	/** Colour-bar or vector legend published by GIBS. */
	legend?: string;
	/** Extra guidance for interpreting the layer. */
	note?: string;
	/** Extension used by the curated WMTS URL builder. */
	extension: string;
	/** Primary official advertised MIME type. */
	format?: string;
	/** Every response format advertised in the official WMTS capabilities. */
	formats?: string[];
	/** Tile URL template normalized to the placeholders MapLibre expects. */
	tileTemplate?: string;
	/** Projections in which this layer appears in the official WMTS catalogue. */
	availableProjections?: GibsProjection[];
	/** Projection of the selected/native catalogue entry. */
	projection?: GibsProjection;
	/** How this layer is safely rendered, or why it cannot be rendered here. */
	mapSupport?: GibsMapSupport;
	/** Projection and matrix set used for DescribeDomains availability requests. */
	availabilityProjection?: GibsProjection;
	availabilityTileMatrixSet?: string;
	/** Whether the official WMTS document publishes a Time dimension. */
	timeDimension?: boolean;
	/** Default frame published by GIBS, when the layer has a Time dimension. */
	defaultTime?: string;
	/** Earliest date sent to DescribeDomains; the live response provides actual coverage. */
	availabilityStart?: string;
	/** Layer, colormap and vector metadata URLs from the official Capabilities. */
	metadataUrl?: string;
	colormapUrl?: string;
	vectorStyleUrl?: string;
	vectorMetadataUrl?: string;
	abstract?: string;
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
	{
		id: 'IMERG_Precipitation_Rate_30min',
		title: 'Precipitation Rate (30-minute)',
		subtitle: 'IMERG / GPM',
		category: 'precipitation',
		period: 'PT30M',
		tileMatrixSet: 'GoogleMapsCompatible_Level6',
		resolution: '0.1° (~10 km)',
		dataset: 'GPM_3IMERGHH v07',
		coverageStart: '1998-01-01',
		legend: 'https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg',
		note: 'Rate in mm/hr for each nominal 30-minute period. The timestamp is the period start in UTC; the estimate represents its midpoint (:15 or :45). GIBS Best Available uses the Final product when available and Early near real time otherwise.',
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

interface GibsCatalogSnapshotLayer {
	id: string;
	title: string;
	abstract?: string | null;
	projections: GibsProjection[];
	projection: GibsProjection;
	mapSupport: GibsMapSupport;
	format: string;
	formats: string[];
	tileMatrixSet: string;
	resolutionMatrixSet?: string;
	resolutionProjection?: GibsProjection;
	extension: string;
	timeDimension: boolean;
	period: string;
	defaultTime?: string | null;
	coverageStart: string;
	availabilityProjection: GibsProjection;
	availabilityTileMatrixSet: string;
	legendUrl?: string | null;
	metadataUrl?: string | null;
	colormapUrl?: string | null;
	vectorStyleUrl?: string | null;
	vectorMetadataUrl?: string | null;
	tileTemplate?: string | null;
	subtitle?: string;
	layerGroup?: string | string[];
	productGroup?: string;
	searchTags?: string[];
	dataProducts?: GibsSourceProduct[];
	worldviewLayerId?: string;
}

interface GibsCatalogSnapshot {
	generatedAt: string;
	sources: Record<GibsProjection, string>;
	worldviewCatalog?: {
		url: string;
		lastModified?: string | null;
		buildDate?: number | null;
	};
	layers: GibsCatalogSnapshotLayer[];
}

const CATALOG_SNAPSHOT = gibsCatalogSnapshot as GibsCatalogSnapshot;
export const GIBS_CATALOG_SNAPSHOT_DATE = CATALOG_SNAPSHOT.generatedAt;
export const GIBS_WORLDVIEW_CATALOG_LAST_MODIFIED =
	CATALOG_SNAPSHOT.worldviewCatalog?.lastModified ?? undefined;

const categoryFromMetadata = (id: string, title: string, extra = ''): GibsCategory => {
	const text = `${id} ${title} ${extra}`.toLowerCase().replace(/[_-]+/g, ' ');
	if (
		/thermal anomal|wildfire|fire radiative|\bfire\b|cyclone hazard|volcano hazard|lightning|tropical storm|dust storm/.test(
			text
		)
	)
		return 'hazards';
	if (/flood|river discharge|surface water|water mask|reservoir|dam\b|\bwater\b/.test(text))
		return 'flood';
	if (
		/sea ice|\bice\b|snow|glacier|ice sheet|greenland|antarctica|cryosphere|freeze thaw/.test(text)
	)
		return 'cryosphere';
	if (/precip|rainfall|rain rate|rain rate|\brain\b/.test(text)) return 'precipitation';
	if (/temperature|\btemp\b|thermal infrared|brightness temp/.test(text)) return 'temperature';
	if (
		/aerosol|air quality|\bozone\b|smoke|carbon monoxide|nitrogen dioxide|sulfur dioxide/.test(text)
	)
		return 'aerosol';
	if (
		/cloud|water vapor|water vapour|radiation|radiative|air mass|wind speed|wind direction|humidity|atmosphere|\bceres\b|\bairs\b/.test(
			text
		)
	)
		return 'atmosphere';
	if (
		/chlorophyll|ocean|sea surface|sea level|sea surface|currents|salinity|bathymetry|coast|\bwave\b/.test(
			text
		)
	)
		return 'ocean';
	if (/species|biodiversity|amphibian|biome|habitat|coral reef|ecoregion/.test(text))
		return 'biodiversity';
	if (/elevation|digital elevation|shaded relief|topography|\bsrtm\b|\bgdem\b/.test(text))
		return 'topography';
	if (
		/vegetation|\bndvi\b|\bevi\b|fpar|leaf area|land cover|land surface|\bsoil\b|biomass|forest|agricultur|crop|albedo/.test(
			text
		)
	)
		return 'land';
	if (
		/reflectance|true color|false color|day night band|nighttime imagery|black marble|blue marble|imagery/.test(
			text
		)
	)
		return 'imagery';
	return 'other';
};

const resolutionForMatrixSet = (matrixSet: string, projection: GibsProjection): string => {
	const known: Record<string, string> = {
		'15.625m': '15.625 m',
		'31.25m': '31.25 m',
		'250m': '250 m',
		'500m': '500 m',
		'1km': '1 km',
		'1.5km': '1.5 km',
		'2km': '2 km'
	};
	if (known[matrixSet]) return known[matrixSet];
	const pixelResolution = /^(\d+(?:\.\d+)?)(m|km)$/.exec(matrixSet);
	if (pixelResolution) return `${pixelResolution[1]} ${pixelResolution[2]}`;
	const match = /GoogleMapsCompatible_Level(\d+)$/.exec(matrixSet);
	return match
		? `Web Mercator · max zoom ${match[1]}`
		: `${matrixSet} · ${projection.toUpperCase()}`;
};

const layerFromSnapshot = (entry: GibsCatalogSnapshotLayer): GibsLayerDef => ({
	id: entry.id,
	title: entry.title,
	subtitle: entry.subtitle ?? 'NASA GIBS',
	layerGroup: entry.layerGroup,
	productGroup: entry.productGroup,
	searchTags: entry.searchTags,
	dataProducts: entry.dataProducts,
	worldviewLayerId: entry.worldviewLayerId,
	category: categoryFromMetadata(
		entry.id,
		entry.title,
		[
			entry.subtitle,
			Array.isArray(entry.layerGroup) ? entry.layerGroup.join(' ') : entry.layerGroup,
			entry.productGroup,
			...(entry.searchTags ?? [])
		]
			.filter(Boolean)
			.join(' ')
	),
	period: entry.period,
	tileMatrixSet: entry.tileMatrixSet,
	resolutionMatrixSet: entry.resolutionMatrixSet ?? entry.tileMatrixSet,
	resolutionProjection: entry.resolutionProjection ?? entry.projection,
	resolution: resolutionForMatrixSet(
		entry.resolutionMatrixSet ?? entry.tileMatrixSet,
		entry.resolutionProjection ?? entry.projection
	),
	coverageStart: entry.coverageStart,
	legend: entry.legendUrl ?? undefined,
	extension: entry.mapSupport === 'wms-rasterized-vector' ? 'png' : entry.extension,
	format: entry.format,
	formats: entry.formats,
	tileTemplate: entry.tileTemplate ?? undefined,
	availableProjections: entry.projections,
	projection: entry.projection,
	mapSupport: entry.mapSupport,
	availabilityProjection: entry.availabilityProjection,
	availabilityTileMatrixSet: entry.availabilityTileMatrixSet,
	timeDimension: entry.timeDimension,
	defaultTime: entry.defaultTime ?? undefined,
	availabilityStart: '0001-01-01',
	metadataUrl: entry.metadataUrl ?? undefined,
	colormapUrl: entry.colormapUrl ?? undefined,
	vectorStyleUrl: entry.vectorStyleUrl ?? undefined,
	vectorMetadataUrl: entry.vectorMetadataUrl ?? undefined,
	abstract: entry.abstract ?? undefined
});

const curatedById = new Map(GIBS_LAYERS.map((layer) => [layer.id, layer]));
const snapshotById = new Map(CATALOG_SNAPSHOT.layers.map((entry) => [entry.id, entry]));

/**
 * Full, locally bundled snapshot of NASA's four official WMTS catalogues.
 * Curated entries stay first and retain their hand-checked notes/dataset links;
 * every other official layer follows in alphabetical identifier order.
 */
export const GIBS_CATALOG_LAYERS: GibsLayerDef[] = [
	...GIBS_LAYERS.map((curated) => {
		const snapshot = snapshotById.get(curated.id);
		if (!snapshot) return { ...curated, mapSupport: 'wmts-raster' as const };
		const generated = layerFromSnapshot(snapshot);
		// Keep the existing, manually verified WMTS URL/extension and date
		// behaviour for these featured entries while adding official metadata.
		return {
			...generated,
			...curated,
			tileTemplate: undefined,
			availabilityStart: curated.coverageStart
		};
	}),
	...CATALOG_SNAPSHOT.layers.filter((entry) => !curatedById.has(entry.id)).map(layerFromSnapshot)
];

const catalogueById = new Map(GIBS_CATALOG_LAYERS.map((layer) => [layer.id, layer]));

export const GIBS_CATALOG_TOTAL = GIBS_CATALOG_LAYERS.length;
export const GIBS_WEB_MERCATOR_TOTAL = GIBS_CATALOG_LAYERS.filter(
	(layer) => layer.mapSupport !== 'projection-only'
).length;

/** Look up a catalogue entry by its GIBS identifier. */
export const gibsLayerById = (id: string | null | undefined): GibsLayerDef | undefined =>
	id ? catalogueById.get(id) : undefined;

/** Layers of one topic, in catalogue order. */
export const gibsLayersByCategory = (category: GibsCategory): GibsLayerDef[] =>
	GIBS_CATALOG_LAYERS.filter((layer) => layer.category === category);

/** Whether this entry can be honestly drawn on the app's Web-Mercator map. */
export const gibsLayerCanRender = (layer: GibsLayerDef | undefined): boolean =>
	!!layer && layer.mapSupport !== 'projection-only';

/** Time dimensions shorter than one day use exact ISO UTC timestamps. */
export const isSubdailyGibsPeriod = (period: GibsPeriod | undefined): boolean =>
	!!period && /^PT/i.test(period);

export const isSubdailyGibsLayer = (layer: GibsLayerDef | undefined): boolean =>
	isSubdailyGibsPeriod(layer?.period);

/** Parse a GIBS `PT…` duration into milliseconds. */
export const gibsPeriodMilliseconds = (period: string | undefined): number | undefined => {
	if (!period) return undefined;
	const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(period);
	if (!match || !match.slice(1).some(Boolean)) return undefined;
	return (
		Number(match[1] ?? 0) * 3_600_000 +
		Number(match[2] ?? 0) * 60_000 +
		Number(match[3] ?? 0) * 1000
	);
};

/** A compact label for a capability's ISO cadence. */
export const describeGibsPeriod = (period: GibsPeriod): string => {
	if (period === 'static') return 'static layer';
	if (period === 'P1D') return 'daily';
	if (period === 'P1M') return 'monthly';
	if (period === 'P1Y') return 'yearly';
	const datePeriod = /^P(\d+)(D|M|Y)$/.exec(period);
	if (datePeriod) {
		const count = Number(datePeriod[1]);
		const unit = datePeriod[2] === 'D' ? 'day' : datePeriod[2] === 'M' ? 'month' : 'year';
		return `every ${count} ${unit}${count === 1 ? '' : 's'}`;
	}
	const milliseconds = gibsPeriodMilliseconds(period);
	if (milliseconds !== undefined) {
		const seconds = Math.round(milliseconds / 1000);
		if (seconds < 60) return `every ${seconds} sec`;
		const minutes = Math.floor(seconds / 60);
		const remainder = seconds % 60;
		if (minutes < 60) return `every ${minutes} min${remainder ? ` ${remainder} sec` : ''}`;
		const hours = Math.floor(minutes / 60);
		const extraMinutes = minutes % 60;
		return `every ${hours} hr${extraMinutes ? ` ${extraMinutes} min` : ''}`;
	}
	return period;
};

const vectorWmsTileUrl = (layer: GibsLayerDef, frame?: string): string => {
	const time = layer.timeDimension ? (frame ?? layer.defaultTime) : undefined;
	const params = [
		'SERVICE=WMS',
		'VERSION=1.1.1',
		'REQUEST=GetMap',
		`LAYERS=${encodeURIComponent(layer.id)}`,
		'STYLES=',
		'FORMAT=image%2Fpng',
		'TRANSPARENT=TRUE',
		'SRS=EPSG%3A3857',
		'WIDTH=256',
		'HEIGHT=256',
		'BBOX={bbox-epsg-3857}'
	];
	if (time) params.push(`TIME=${encodeURIComponent(time)}`);
	return `${GIBS_VECTOR_WMS_URL}?${params.join('&')}`;
};

/**
 * WMTS tile template for an exact frame, normalized to MapLibre's
 * `{z}/{x}/{y}` tokens. MVT products use NASA's default-styled WMS image path.
 */
export const gibsTileUrl = (layer: GibsLayerDef, frame?: string): string => {
	if (layer.mapSupport === 'wms-rasterized-vector') return vectorWmsTileUrl(layer, frame);

	if (layer.tileTemplate) {
		let url = layer.tileTemplate
			.replaceAll('{TileMatrixSet}', layer.tileMatrixSet)
			.replaceAll('{TileMatrix}', '{z}')
			.replaceAll('{TileRow}', '{y}')
			.replaceAll('{TileCol}', '{x}');
		if (url.includes('{Time}')) {
			const time = frame ?? layer.defaultTime ?? '';
			url = url.replaceAll('{Time}', time);
		}
		return url;
	}

	if (layer.period === 'static')
		return `${GIBS_BASE_URL}/${layer.id}/default/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.extension}`;

	return `${GIBS_BASE_URL}/${layer.id}/default/${frame ?? layer.defaultTime ?? ''}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.extension}`;
};

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

/** One compact run of exact sub-daily GIBS timestamps (never expanded globally). */
export interface GibsTimeRange {
	/** First exact UTC instant, normalized to `YYYY-MM-DDTHH:mm:ssZ`. */
	start: string;
	/** Last exact UTC instant, inclusive. */
	end: string;
	/** Interval between records in this range. */
	stepMs: number;
}

/** Parse the minute/hour/second ISO durations used by sub-daily WMTS domains. */
const isoDurationMs = (duration: string): number | undefined => gibsPeriodMilliseconds(duration);

/**
 * Normalize a GIBS UTC frame key. Date-only input means midnight UTC; a
 * datetime-local value must be made UTC by its caller before it reaches here.
 */
export const normalizeGibsTimestamp = (value: string | undefined): string | undefined => {
	if (!value) return undefined;
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		const dayMs = Date.parse(`${value}T00:00:00Z`);
		return Number.isFinite(dayMs) && new Date(dayMs).toISOString().slice(0, 10) === value
			? `${value}T00:00:00Z`
			: undefined;
	}
	const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?Z$/.exec(value);
	if (!match) return undefined;
	const canonical = `${match[1]}:${match[2] ?? '00'}Z`;
	const ms = Date.parse(canonical);
	return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === canonical.slice(0, 19)
		? canonical
		: undefined;
};

const timeBoundaryMs = (value: string, isEnd: boolean, stepMs: number): number | undefined => {
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		const midnight = Date.parse(`${value}T00:00:00Z`);
		if (!Number.isFinite(midnight)) return undefined;
		// DescribeDomains compacts date-bounded sub-daily windows to whole days.
		// A date-only start is 00:00Z; a date-only inclusive end is the last
		// cadence slot of that UTC day (e.g. 23:30Z for PT30M).
		return isEnd ? midnight + DAY_MS - stepMs : midnight;
	}
	const normalized = normalizeGibsTimestamp(value);
	return normalized ? Date.parse(normalized) : undefined;
};

/**
 * Parse the DescribeDomains `time` dimension without turning a 28.75-year,
 * 30-minute archive into ~504,000 strings. GIBS may shorten date-only range
 * bounds; those mean the start/end of the UTC day at the published cadence.
 */
export const parseGibsTimeAvailability = (xml: string): GibsTimeRange[] => {
	const domain = /<Domain>([\s\S]*?)<\/Domain>/i.exec(xml)?.[1];
	if (!domain || !domain.trim()) return [];
	const ranges: GibsTimeRange[] = [];
	for (const part of domain.split(',')) {
		const [start, end, duration] = part.trim().split('/');
		if (!start || !end || !duration) continue;
		const stepMs = isoDurationMs(duration);
		if (!stepMs) continue;
		const startMs = timeBoundaryMs(start, false, stepMs);
		const rawEndMs = timeBoundaryMs(end, true, stepMs);
		if (startMs === undefined || rawEndMs === undefined || rawEndMs < startMs) continue;
		const endMs = startMs + Math.floor((rawEndMs - startMs) / stepMs) * stepMs;
		ranges.push({
			start: new Date(startMs).toISOString().replace('.000Z', 'Z'),
			end: new Date(endMs).toISOString().replace('.000Z', 'Z'),
			stepMs
		});
	}
	return ranges.sort((a, b) => a.start.localeCompare(b.start));
};

/** Project half-hour availability onto days for the shared archive rail. */
export const gibsTimeRangesToDayRanges = (ranges: GibsTimeRange[]): GibsAvailabilityRange[] => {
	const days = ranges
		.map((range) => ({ start: range.start.slice(0, 10), end: range.end.slice(0, 10) }))
		.sort((a, b) => a.start.localeCompare(b.start));
	const merged: GibsAvailabilityRange[] = [];
	for (const day of days) {
		const previous = merged[merged.length - 1];
		if (previous && day.start <= shiftIsoDay(previous.end, 1)) {
			if (day.end > previous.end) previous.end = day.end;
		} else {
			merged.push({ start: day.start, end: day.end, stepDays: 1, step: 'P1D' });
		}
	}
	return merged;
};

/** Earliest and latest exact timestamps published by a sub-daily layer. */
export const earliestAvailableTime = (ranges: GibsTimeRange[]): string | undefined =>
	ranges[0]?.start;
export const latestAvailableTime = (ranges: GibsTimeRange[]): string | undefined =>
	ranges[ranges.length - 1]?.end;

/** Closest real frame to a requested UTC timestamp; ties choose the earlier frame. */
export const resolveAvailableTime = (
	ranges: GibsTimeRange[],
	requested: string
): string | undefined => {
	const normalized = normalizeGibsTimestamp(requested);
	if (!normalized || !ranges.length) return undefined;
	const target = Date.parse(normalized);
	let nearest: number | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const range of ranges) {
		const start = Date.parse(range.start);
		const end = Date.parse(range.end);
		const clamped = Math.min(end, Math.max(start, target));
		const offset = (clamped - start) / range.stepMs;
		const lower = Math.floor(offset);
		const index = lower + (offset - lower > 0.5 ? 1 : 0); // exact ties choose the earlier frame
		const candidate = Math.min(end, start + index * range.stepMs);
		const distance = Math.abs(candidate - target);
		if (distance < nearestDistance) {
			nearest = candidate;
			nearestDistance = distance;
		}
	}
	return nearest === undefined ? undefined : new Date(nearest).toISOString().replace('.000Z', 'Z');
};

/** Shift a canonical GIBS timestamp by whole minutes. */
export const shiftGibsTimestamp = (value: string, minutes: number): string | undefined => {
	const normalized = normalizeGibsTimestamp(value);
	if (!normalized || !Number.isFinite(minutes)) return undefined;
	return new Date(Date.parse(normalized) + minutes * 60_000).toISOString().replace('.000Z', 'Z');
};

/** The DescribeDomains request for a layer and inclusive date window. */
export const gibsAvailabilityUrl = (layer: GibsLayerDef, start: string, end: string): string => {
	const projection = layer.availabilityProjection ?? 'epsg3857';
	const matrixSet = layer.availabilityTileMatrixSet ?? layer.tileMatrixSet;
	return `${GIBS_WMTS_BASE_URLS[projection]}/1.0.0/${layer.id}/default/${matrixSet}/all/${start}--${end}.xml`;
};

/** Last day with imagery, which is what "latest" means for this layer. */
export const latestAvailableDay = (ranges: GibsAvailabilityRange[]): string | undefined =>
	ranges.length ? ranges[ranges.length - 1].end : undefined;

/** First day with imagery published for this layer. */
export const earliestAvailableDay = (ranges: GibsAvailabilityRange[]): string | undefined =>
	ranges[0]?.start;

/** Range containing a day, or undefined when the day sits in a gap. */
const rangeAt = (ranges: GibsAvailabilityRange[], day: string): GibsAvailabilityRange | undefined =>
	ranges.find((range) => range.start <= day && day <= range.end);

/** Shift a UTC day by calendar months, clamping month-end dates safely. */
export const shiftIsoMonth = (day: string, months: number): string => {
	const current = new Date(`${day}T00:00:00Z`);
	const wantedDay = current.getUTCDate();
	const target = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + months, 1));
	const monthEnd = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	target.setUTCDate(Math.min(wantedDay, monthEnd));
	return target.toISOString().slice(0, 10);
};

const monthsInPeriod = (period: string): number | undefined => {
	const match = /^P(\d+)(M|Y)$/.exec(period);
	if (!match) return undefined;
	return Number(match[1]) * (match[2] === 'Y' ? 12 : 1);
};

const snapWithinRange = (day: string, range: GibsAvailabilityRange): string => {
	const monthStep = monthsInPeriod(range.step);
	if (monthStep) {
		const startMonth = Date.parse(`${range.start.slice(0, 7)}-01T00:00:00Z`);
		const targetMonth = Date.parse(`${day.slice(0, 7)}-01T00:00:00Z`);
		const monthsApart =
			(new Date(targetMonth).getUTCFullYear() - new Date(startMonth).getUTCFullYear()) * 12 +
			new Date(targetMonth).getUTCMonth() -
			new Date(startMonth).getUTCMonth();
		return shiftIsoMonth(range.start, Math.floor(monthsApart / monthStep) * monthStep);
	}
	const dayStep = stepToDays(range.step);
	const offset = Math.max(0, isoDayDiff(range.start, day));
	return shiftIsoDay(range.start, Math.floor(offset / dayStep) * dayStep);
};

/**
 * Snap a requested day to the layer's actual composite interval. GIBS publishes
 * daily, multi-day, monthly/quarterly/yearly and irregular ranges; each
 * DescribeDomains range is used as the alignment anchor, so the selected date
 * always names a frame that really exists.
 */
export const snapToPeriod = (
	layer: GibsLayerDef,
	day: string,
	ranges: GibsAvailabilityRange[] = []
): string => {
	const range = rangeAt(ranges, day);
	if (range) return snapWithinRange(day, range);

	const period = layer.period;
	if (period === 'P1M') return `${day.slice(0, 7)}-01`;
	const monthStep = monthsInPeriod(period);
	if (monthStep) {
		const anchor = layer.coverageStart || `${day.slice(0, 7)}-01`;
		const startMonth = Date.parse(`${anchor.slice(0, 7)}-01T00:00:00Z`);
		const targetMonth = Date.parse(`${day.slice(0, 7)}-01T00:00:00Z`);
		const monthsApart =
			(new Date(targetMonth).getUTCFullYear() - new Date(startMonth).getUTCFullYear()) * 12 +
			new Date(targetMonth).getUTCMonth() -
			new Date(startMonth).getUTCMonth();
		return shiftIsoMonth(anchor, Math.floor(monthsApart / monthStep) * monthStep);
	}
	const dayStep = /^P(\d+)D$/.exec(period);
	if (dayStep && Number(dayStep[1]) > 1) {
		const anchor = layer.coverageStart || day;
		const offset = Math.max(0, isoDayDiff(anchor, day));
		return shiftIsoDay(anchor, Math.floor(offset / Number(dayStep[1])) * Number(dayStep[1]));
	}
	return day;
};

/**
 * Resolve to the nearest published frame, snapping within each range. This
 * compares range edges directly rather than walking a fixed 400-day window,
 * which also handles sparse yearly and multi-year catalogue products.
 */
export const resolveAvailableDay = (
	_layer: GibsLayerDef,
	day: string,
	ranges: GibsAvailabilityRange[]
): string | undefined => {
	if (!ranges.length) return undefined;
	const containing = rangeAt(ranges, day);
	if (containing) return snapWithinRange(day, containing);

	let nearest: string | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const range of ranges) {
		const candidate = day < range.start ? range.start : snapWithinRange(range.end, range);
		const distance = Math.abs(isoDayDiff(day, candidate));
		if (
			distance < nearestDistance ||
			(distance === nearestDistance && candidate < (nearest ?? candidate))
		) {
			nearest = candidate;
			nearestDistance = distance;
		}
	}
	return nearest;
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
): string | undefined => {
	if (!layer.worldviewLayerId) return undefined;
	const [west, south, east, north] = view ?? [85, 18, 95, 29];
	const round = (value: number): number => Math.round(value * 100) / 100;
	return `https://worldview.earthdata.nasa.gov/?v=${round(west)},${round(south)},${round(east)},${round(north)}&t=${day}&l=${layer.worldviewLayerId}&lg=false`;
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
	}).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));

/** Readable label for the exact frame key, explicitly in NASA's UTC time axis. */
export const formatGibsTimestamp = (value: string, locale = 'en-GB'): string => {
	const timestamp = normalizeGibsTimestamp(value);
	if (!timestamp) return value;
	const clock = timestamp.slice(11, 16);
	const seconds = timestamp.slice(17, 19);
	return `${formatGibsDay(timestamp.slice(0, 10), locale)} ${clock}${seconds === '00' ? '' : `:${seconds}`} UTC`;
};

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
export const GIBS_URL_TIME_PARAM = 'gibs-time';

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
	timestamp?: string;
	latestTimestamp?: string;
	defaultLayerId: string;
}): Record<string, string> => {
	if (!state.browsing) return {};
	const params: Record<string, string> = {};
	if (state.layerId !== state.defaultLayerId) params[GIBS_URL_LAYER_PARAM] = state.layerId;
	if (state.timestamp) {
		if (state.timestamp !== state.latestTimestamp) params[GIBS_URL_TIME_PARAM] = state.timestamp;
	} else if (state.day && state.day !== state.latest) {
		params[GIBS_URL_DATE_PARAM] = state.day;
	}
	return params;
};

/** A real `YYYY-MM-DD` day: the shape has to survive a round trip through Date. */
const isIsoDay = (value: string | null | undefined): value is string =>
	!!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftIsoDay(value, 0) === value;

/** Layer and exact frame from a location search string, ignoring invalid values. */
export const parseGibsUrl = (
	search: string
): { layerId?: string; day?: string; timestamp?: string } => {
	const params = new URLSearchParams(search);
	const layerId = params.get(GIBS_URL_LAYER_PARAM);
	const timestamp = normalizeGibsTimestamp(params.get(GIBS_URL_TIME_PARAM) ?? undefined);
	const day = params.get(GIBS_URL_DATE_PARAM);
	return {
		layerId: layerId && gibsLayerById(layerId) ? layerId : undefined,
		day: timestamp?.slice(0, 10) ?? (isIsoDay(day) ? day : undefined),
		timestamp
	};
};
