/**
 * The Earth System -> Variable catalogue. Each variable says where its data
 * comes from, whether it is read live from a NASA service in the browser or
 * from a bundled sample file, how months combine into a season, and which
 * independent dataset (if any) is used to check dataset agreement.
 */
import type { Domain } from './regions';

export type SystemId = 'biosphere' | 'climate' | 'cryosphere' | 'land' | 'ocean';

export interface EarthSystem {
	id: SystemId;
	name: string;
	short: string;
	description: string;
	everyday: string;
}

export const EARTH_SYSTEMS: EarthSystem[] = [
	{
		id: 'biosphere',
		name: 'Biosphere',
		short: 'Plants & life',
		description: 'Vegetation greenness and plant productivity.',
		everyday: 'Are crops, forests and mangroves getting greener or browner?'
	},
	{
		id: 'climate',
		name: 'Climate',
		short: 'Heat & rain',
		description: 'Air temperature, rainfall, humidity and sunshine.',
		everyday: 'Is it getting hotter? Is the rain changing?'
	},
	{
		id: 'cryosphere',
		name: 'Cryosphere',
		short: 'Snow & ice',
		description: 'Snow in the Himalaya that feeds our rivers, and Arctic sea ice.',
		everyday: 'Is the snow that feeds our rivers shrinking?'
	},
	{
		id: 'land',
		name: 'Land Surface',
		short: 'Soil & ground',
		description: 'Soil moisture, ground temperature and evaporation.',
		everyday: 'Is the soil getting drier? Is the ground getting hotter?'
	},
	{
		id: 'ocean',
		name: 'Ocean',
		short: 'Sea & coast',
		description: 'Sea surface temperature and ocean colour in the Bay of Bengal.',
		everyday: 'Is the sea next to us getting warmer?'
	}
];

export type Aggregation = 'mean' | 'sum';

export type VariableSource =
	/** NASA POWER monthly regional grid (MERRA-2 / CERES), read live. */
	| { kind: 'power-monthly'; parameter: string; scale?: number; perDay?: boolean }
	/** NASA POWER daily point series summed to months (used for GPM IMERG), read live. */
	| { kind: 'power-daily'; parameter: string; firstYear: number }
	/** Bundled monthly or yearly series from static/trend-samples. */
	| { kind: 'sample'; file: string; annualOnly?: boolean }
	/** Bundled regional means keyed by region id (precomputed for the listed regions). */
	| { kind: 'regional'; file: string; regions: string[] };

export type AgreementSource =
	| { kind: 'era5'; variable: string; label: string }
	/**
	 * An independent observation-based series precomputed for the predefined
	 * regions (NOAA PSL); a tapped point asks ERA5 live for that one point.
	 */
	| { kind: 'reference'; key: string; label: string; era5: string; era5Label: string }
	| { kind: 'variable'; variableId: string; label: string };

export interface GibsOverlay {
	layer: string;
	title: string;
	level: number;
	extension: 'png' | 'jpeg';
	monthly?: boolean;
}

export interface Variable {
	id: string;
	system: SystemId;
	name: string;
	/** Words for farmers, students and citizens. */
	everydayName: string;
	unit: string;
	/** Unit of the per-decade trend (sum variables add up to a season total). */
	decimals: number;
	agg: Aggregation;
	source: VariableSource;
	domain: Domain | 'any-surface';
	dataset: {
		name: string;
		provider: string;
		url: string;
		resolution: string;
		firstYear: number;
		live: boolean;
	};
	description: string;
	/** Everyday words for a rise and a fall. */
	up: string;
	down: string;
	agreement?: AgreementSource;
	overlay?: GibsOverlay;
	/** Region to switch to when the current one cannot show this variable. */
	preferredRegion?: string;
	/** Share of a season's months a mean needs (cloudy ocean-colour data needs less). */
	minShare?: number;
	/** Regions where the sample file has no valid values. */
	missingRegions?: string[];
}

const POWER_URL = 'https://power.larc.nasa.gov/';
const MERRA2 = 'NASA GMAO MERRA-2 reanalysis via NASA POWER';

export const VARIABLES: Variable[] = [
	// ----------------------------------------------------------------- Climate
	{
		id: 'gistemp',
		system: 'climate',
		name: 'Surface temperature anomaly (NASA GISTEMP, since 1951)',
		everydayName: 'temperature',
		unit: '°C',
		decimals: 2,
		agg: 'mean',
		source: {
			kind: 'regional',
			file: 'nasa-gistemp.json',
			regions: [
				'bangladesh',
				'rajshahi',
				'dhaka',
				'chattogram',
				'khulna',
				'sylhet',
				'rangpur',
				'barishal',
				'mymensingh',
				'sundarbans',
				'kangchenjunga',
				'everest'
			]
		},
		domain: 'land',
		dataset: {
			name: 'NASA GISTEMP v4',
			provider: 'NASA Goddard Institute for Space Studies (GISS), station + ship + buoy based',
			url: 'https://data.giss.nasa.gov/gistemp/',
			resolution: '2° × 2°, monthly anomalies vs 1951–1980 (250 km smoothing)',
			firstYear: 1951,
			live: false
		},
		description:
			"NASA's station-based record of surface temperature change: how much warmer or cooler each month was than the 1951–1980 average.",
		up: 'warmer',
		down: 'cooler',
		agreement: {
			kind: 'reference',
			key: 'ghcncams_t2m',
			label: 'NOAA GHCN_CAMS station air temperature',
			era5: 'temperature_2m_mean',
			era5Label: 'ECMWF ERA5 air temperature'
		}
	},
	{
		id: 't2m',
		system: 'climate',
		name: 'Air temperature (2 m)',
		everydayName: 'temperature',
		unit: '°C',
		decimals: 2,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'T2M' },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 T2M',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Mean air temperature two metres above the ground.',
		up: 'warmer',
		down: 'cooler',
		agreement: {
			kind: 'reference',
			key: 'ghcncams_t2m',
			label: 'NOAA GHCN_CAMS station air temperature',
			era5: 'temperature_2m_mean',
			era5Label: 'ECMWF ERA5 air temperature'
		},
		overlay: {
			layer: 'AIRS_L3_Surface_Air_Temperature_Monthly_Day',
			title: 'AIRS surface air temperature (monthly, day)',
			level: 6,
			extension: 'png',
			monthly: true
		}
	},
	{
		id: 't2m_max',
		system: 'climate',
		name: 'Daily maximum temperature',
		everydayName: 'daytime heat',
		unit: '°C',
		decimals: 2,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'T2M_MAX' },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 T2M_MAX',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Monthly mean of the daily highest air temperature: how hot afternoons get.',
		up: 'hotter',
		down: 'less hot',
		agreement: {
			kind: 'reference',
			key: 'ghcncams_t2m',
			label: 'NOAA GHCN_CAMS station mean air temperature',
			era5: 'temperature_2m_max',
			era5Label: 'ECMWF ERA5 daily maximum temperature'
		}
	},
	{
		id: 'rain_imerg',
		system: 'climate',
		name: 'Rainfall (GPM IMERG satellite)',
		everydayName: 'rainfall',
		unit: 'mm',
		decimals: 0,
		agg: 'sum',
		source: { kind: 'power-daily', parameter: 'IMERG_PRECTOT', firstYear: 2001 },
		domain: 'any-surface',
		dataset: {
			name: 'GPM IMERG Final precipitation',
			provider: 'NASA GPM IMERG via NASA POWER (daily, summed to months)',
			url: 'https://gpm.nasa.gov/data/imerg',
			resolution: '0.1°, daily',
			firstYear: 2001,
			live: true
		},
		description:
			'Total rainfall measured by the Global Precipitation Measurement satellite constellation.',
		up: 'wetter',
		down: 'drier',
		agreement: {
			kind: 'reference',
			key: 'gpcp_precip',
			label: 'GPCP v2.3 satellite-gauge rainfall',
			era5: 'precipitation_sum',
			era5Label: 'ECMWF ERA5 rainfall'
		},
		overlay: {
			layer: 'IMERG_Precipitation_Rate',
			title: 'GPM IMERG precipitation rate (daily)',
			level: 6,
			extension: 'png'
		}
	},
	{
		id: 'rain_merra',
		system: 'climate',
		name: 'Rainfall (MERRA-2, since 1981)',
		everydayName: 'rainfall',
		unit: 'mm',
		decimals: 0,
		agg: 'sum',
		source: { kind: 'power-monthly', parameter: 'PRECTOTCORR', perDay: true },
		domain: 'any-surface',
		dataset: {
			name: 'MERRA-2 PRECTOTCORR',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Gauge-corrected model rainfall; a longer record than the satellite series.',
		up: 'wetter',
		down: 'drier',
		agreement: {
			kind: 'reference',
			key: 'gpcp_precip',
			label: 'GPCP v2.3 satellite-gauge rainfall',
			era5: 'precipitation_sum',
			era5Label: 'ECMWF ERA5 rainfall'
		}
	},
	{
		id: 'rh2m',
		system: 'climate',
		name: 'Relative humidity',
		everydayName: 'humidity',
		unit: '%',
		decimals: 1,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'RH2M' },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 RH2M',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Relative humidity two metres above the ground.',
		up: 'more humid',
		down: 'less humid',
		agreement: {
			kind: 'reference',
			key: 'r1_rhum',
			label: 'NCEP/NCAR Reanalysis 1 relative humidity',
			era5: 'relative_humidity_2m_mean',
			era5Label: 'ECMWF ERA5 humidity'
		}
	},
	{
		id: 'solar',
		system: 'climate',
		name: 'Sunshine (surface solar radiation)',
		everydayName: 'sunshine',
		unit: 'MJ/m²/day',
		decimals: 2,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'ALLSKY_SFC_SW_DWN' },
		domain: 'land',
		dataset: {
			name: 'CERES SYN1deg / GEWEX SRB all-sky shortwave',
			provider: 'NASA CERES via NASA POWER',
			url: POWER_URL,
			resolution: '1°, monthly',
			firstYear: 1984,
			live: true
		},
		description: 'Solar energy reaching the ground under real (cloudy and clear) skies.',
		up: 'sunnier',
		down: 'dimmer',
		agreement: {
			kind: 'reference',
			key: 'r2_dswrf',
			label: 'NCEP-DOE Reanalysis 2 solar radiation',
			era5: 'shortwave_radiation_sum',
			era5Label: 'ECMWF ERA5 solar radiation'
		}
	},
	{
		id: 'aod',
		system: 'climate',
		name: 'Aerosol haze (AOD, 550 nm)',
		everydayName: 'haze',
		unit: 'AOD',
		decimals: 2,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'AOD_55' },
		domain: 'land',
		dataset: {
			name: 'NASA POWER AOD_55',
			provider: 'NASA POWER (solar radiation inputs)',
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 2001,
			live: true
		},
		description:
			'How much sunlight dust, smoke and pollution particles block, at 550 nm. Below 0.1 is a crystal-clear sky; around 1 is very hazy (NASA Earth Observatory). POWER lists it with its solar radiation parameters, from 2001.',
		up: 'hazier',
		down: 'clearer'
	},
	// --------------------------------------------------------------- Biosphere
	{
		id: 'ndvi',
		system: 'biosphere',
		name: 'Vegetation greenness (MODIS NDVI)',
		everydayName: 'vegetation greenness',
		unit: 'NDVI',
		decimals: 3,
		agg: 'mean',
		source: { kind: 'sample', file: 'modis-ndvi.json' },
		domain: 'land',
		dataset: {
			name: 'MODIS Terra MOD13Q1 v6.1 NDVI',
			provider: 'NASA LP DAAC, subset by ORNL DAAC',
			url: 'https://modis.ornl.gov/sites/',
			resolution: '250 m, 16-day (sample sites)',
			firstYear: 2001,
			live: false
		},
		description:
			'Normalized Difference Vegetation Index: 0 is bare, about 0.8 is dense healthy plants.',
		up: 'greener',
		down: 'browner',
		preferredRegion: 'bangladesh',
		overlay: {
			layer: 'MODIS_Terra_L3_NDVI_Monthly',
			title: 'MODIS Terra NDVI (monthly)',
			level: 7,
			extension: 'png',
			monthly: true
		}
	},
	{
		id: 'npp',
		system: 'biosphere',
		name: 'Plant productivity (MODIS NPP)',
		everydayName: 'plant growth',
		unit: 'g C/m²/yr',
		decimals: 0,
		agg: 'mean',
		source: { kind: 'sample', file: 'modis-npp.json', annualOnly: true },
		domain: 'land',
		dataset: {
			name: 'MODIS Terra MOD17A3HGF v6.1 NPP',
			provider: 'NASA LP DAAC, subset by ORNL DAAC',
			url: 'https://modis.ornl.gov/sites/',
			resolution: '500 m, yearly (sample sites)',
			firstYear: 2001,
			live: false
		},
		description:
			'Net primary productivity: carbon that plants fix in a year after their own respiration.',
		up: 'more plant growth',
		down: 'less plant growth',
		preferredRegion: 'bangladesh',
		missingRegions: ['sundarbans']
	},
	// ------------------------------------------------------------ Land surface
	{
		id: 'soil_top',
		system: 'land',
		name: 'Surface soil moisture (0–5 cm)',
		everydayName: 'topsoil moisture',
		unit: '% wet',
		decimals: 1,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'GWETTOP', scale: 100 },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 GWETTOP (surface soil wetness)',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description:
			'How full the top 5 cm of soil is with water, in percent of saturation (0 dry, 100 saturated).',
		up: 'wetter soil',
		down: 'drier soil',
		agreement: {
			kind: 'reference',
			key: 'cpc_soilw',
			label: 'NOAA CPC soil moisture (observation-driven)',
			era5: 'soil_moisture_0_to_7cm_mean',
			era5Label: 'ECMWF ERA5 soil moisture 0–7 cm'
		},
		overlay: {
			layer: 'SMAP_L4_Analyzed_Surface_Soil_Moisture',
			title: 'SMAP L4 surface soil moisture (daily)',
			level: 6,
			extension: 'png'
		}
	},
	{
		id: 'soil_root',
		system: 'land',
		name: 'Root-zone soil moisture (0–100 cm)',
		everydayName: 'soil moisture for crops',
		unit: '% wet',
		decimals: 1,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'GWETROOT', scale: 100 },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 GWETROOT (root-zone soil wetness)',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description:
			'Water available to plant roots in the top metre of soil, in percent of saturation.',
		up: 'wetter soil',
		down: 'drier soil',
		agreement: {
			kind: 'reference',
			key: 'cpc_soilw',
			label: 'NOAA CPC soil moisture (observation-driven)',
			era5: 'soil_moisture_28_to_100cm_mean',
			era5Label: 'ECMWF ERA5 soil moisture 28–100 cm'
		}
	},
	{
		id: 'ts',
		system: 'land',
		name: 'Land surface (skin) temperature',
		everydayName: 'ground temperature',
		unit: '°C',
		decimals: 2,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'TS' },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 TS (earth skin temperature)',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description:
			'Temperature of the ground surface itself, which heats faster than the air above it.',
		up: 'hotter ground',
		down: 'cooler ground',
		overlay: {
			layer: 'MODIS_Terra_Land_Surface_Temp_Day',
			title: 'MODIS Terra land surface temperature (day)',
			level: 7,
			extension: 'png'
		},
		agreement: {
			kind: 'reference',
			key: 'ghcncams_t2m',
			label: 'NOAA GHCN_CAMS station air temperature',
			era5: 'soil_temperature_0_to_7cm_mean',
			era5Label: 'ECMWF ERA5 soil temperature 0–7 cm'
		}
	},
	{
		id: 'evap',
		system: 'land',
		name: 'Evaporation from land',
		everydayName: 'evaporation',
		unit: 'mm',
		decimals: 0,
		agg: 'sum',
		source: { kind: 'power-monthly', parameter: 'EVLAND', perDay: true },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 EVLAND',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Water returned to the air from soil and plants (evapotranspiration).',
		up: 'more evaporation',
		down: 'less evaporation'
	},
	// -------------------------------------------------------------- Cryosphere
	{
		id: 'snow_cover',
		system: 'cryosphere',
		name: 'Snow cover fraction',
		everydayName: 'snow cover',
		unit: '%',
		decimals: 1,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'FRSNO', scale: 100 },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 FRSNO (land snow cover fraction)',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Share of the land covered by snow.',
		up: 'more snow cover',
		down: 'less snow cover',
		preferredRegion: 'kangchenjunga',
		overlay: {
			layer: 'MODIS_Terra_NDSI_Snow_Cover',
			title: 'MODIS Terra snow cover (daily)',
			level: 8,
			extension: 'png'
		}
	},
	{
		id: 'snow_depth',
		system: 'cryosphere',
		name: 'Snow depth',
		everydayName: 'snow depth',
		unit: 'cm',
		decimals: 1,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'SNODP' },
		domain: 'land',
		dataset: {
			name: 'MERRA-2 SNODP',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Average depth of snow on the ground.',
		up: 'deeper snow',
		down: 'thinner snow',
		preferredRegion: 'kangchenjunga'
	},
	{
		id: 'frost_days',
		system: 'cryosphere',
		name: 'Frost days',
		everydayName: 'frost days',
		unit: 'days',
		decimals: 1,
		agg: 'sum',
		source: { kind: 'power-monthly', parameter: 'FROST_DAYS' },
		domain: 'land',
		dataset: {
			name: 'NASA POWER FROST_DAYS (from MERRA-2)',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Number of days when the temperature at 2 m drops below 0 °C.',
		up: 'more frost days',
		down: 'fewer frost days',
		preferredRegion: 'kangchenjunga'
	},
	{
		id: 'sea_ice',
		system: 'cryosphere',
		name: 'Arctic sea-ice extent',
		everydayName: 'Arctic sea ice',
		unit: 'million km²',
		decimals: 2,
		agg: 'mean',
		source: { kind: 'sample', file: 'nsidc-sea-ice.json' },
		domain: 'arctic',
		dataset: {
			name: 'NSIDC Sea Ice Index v4 (G02135)',
			provider: 'NOAA@NSIDC, from NASA passive-microwave satellites',
			url: 'https://nsidc.org/data/g02135',
			resolution: '25 km, monthly (Arctic total)',
			firstYear: 1979,
			live: false
		},
		description: 'Area of the Arctic Ocean with at least 15% ice cover.',
		up: 'more sea ice',
		down: 'less sea ice',
		preferredRegion: 'arctic'
	},
	// ------------------------------------------------------------------- Ocean
	{
		id: 'sst_merra',
		system: 'ocean',
		name: 'Sea surface temperature (since 1981)',
		everydayName: 'sea temperature',
		unit: '°C',
		decimals: 2,
		agg: 'mean',
		source: { kind: 'power-monthly', parameter: 'TS' },
		domain: 'ocean',
		dataset: {
			name: 'MERRA-2 TS over ocean (skin temperature)',
			provider: MERRA2,
			url: POWER_URL,
			resolution: '0.5° × 0.625°, monthly',
			firstYear: 1981,
			live: true
		},
		description: 'Temperature of the sea surface; warmer water fuels stronger cyclones.',
		up: 'warmer sea',
		down: 'cooler sea',
		preferredRegion: 'bay-north',
		agreement: { kind: 'variable', variableId: 'sst_mur', label: 'NASA JPL MUR satellite SST' },
		overlay: {
			layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
			title: 'GHRSST MUR sea surface temperature (daily)',
			level: 7,
			extension: 'png'
		}
	},
	{
		id: 'sst_mur',
		system: 'ocean',
		name: 'Sea surface temperature (MUR satellite)',
		everydayName: 'sea temperature',
		unit: '°C',
		decimals: 2,
		agg: 'mean',
		source: { kind: 'sample', file: 'mur-sst.json' },
		domain: 'ocean',
		dataset: {
			name: 'NASA JPL MUR SST v4.1 (monthly)',
			provider: 'NASA JPL PO.DAAC, served by NOAA CoastWatch ERDDAP',
			url: 'https://podaac.jpl.nasa.gov/MEaSUREs-MUR',
			resolution: '0.01°, monthly (sample points)',
			firstYear: 2003,
			live: false
		},
		description: 'Multi-sensor satellite sea surface temperature.',
		up: 'warmer sea',
		down: 'cooler sea',
		preferredRegion: 'bay-north',
		agreement: { kind: 'variable', variableId: 'sst_merra', label: 'MERRA-2 sea skin temperature' }
	},
	{
		id: 'chl',
		system: 'ocean',
		name: 'Chlorophyll-a (ocean colour)',
		everydayName: 'plankton (sea greenness)',
		unit: 'mg/m³',
		decimals: 3,
		agg: 'mean',
		source: { kind: 'sample', file: 'modis-chlorophyll.json' },
		domain: 'ocean',
		dataset: {
			name: 'NASA MODIS-Aqua chlorophyll-a (OCI)',
			provider: 'NASA OBPG, served by NOAA CoastWatch ERDDAP',
			url: 'https://oceancolor.gsfc.nasa.gov/',
			resolution: '4 km, monthly (sample points)',
			firstYear: 2003,
			live: false
		},
		description:
			'Concentration of the green pigment of phytoplankton, the base of the marine food web.',
		up: 'more plankton',
		down: 'less plankton',
		preferredRegion: 'bay-north',
		minShare: 0.5
	}
];

export const DEFAULT_VARIABLE_ID = 'gistemp';

export function variableById(id: string): Variable | undefined {
	return VARIABLES.find((v) => v.id === id);
}

export function variablesForSystem(system: SystemId): Variable[] {
	return VARIABLES.filter((v) => v.system === system);
}

export function systemById(id: string): EarthSystem | undefined {
	return EARTH_SYSTEMS.find((s) => s.id === id);
}

/** Can this variable be analysed for a region of this domain? */
export function variableFitsDomain(variable: Variable, domain: Domain): boolean {
	if (variable.domain === 'arctic' || domain === 'arctic') return variable.domain === domain;
	if (domain === 'any') return true;
	if (variable.domain === 'any-surface') return true;
	return variable.domain === domain;
}

export interface Season {
	id: string;
	name: string;
	months: number[];
	/** True when December belongs to the following year's season (DJF). */
	decemberNextYear?: boolean;
}

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export const SEASONS: Season[] = [
	{ id: 'annual', name: 'Whole year', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
	{ id: 'premonsoon', name: 'Pre-monsoon summer (Mar–May)', months: [3, 4, 5] },
	{ id: 'monsoon', name: 'Monsoon (Jun–Sep)', months: [6, 7, 8, 9] },
	{ id: 'postmonsoon', name: 'Post-monsoon (Oct–Nov)', months: [10, 11] },
	{ id: 'winter', name: 'Winter (Dec–Feb)', months: [12, 1, 2], decemberNextYear: true },
	...MONTH_NAMES.map((name, i) => ({ id: `m${i + 1}`, name: `${name} only`, months: [i + 1] }))
];

export function seasonById(id: string): Season {
	return SEASONS.find((s) => s.id === id) ?? SEASONS[0];
}

export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
