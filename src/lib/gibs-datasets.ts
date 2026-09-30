/**
 * Official dataset records behind each GIBS catalogue layer.
 *
 * Generated from NASA's layer-metadata service,
 * `https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/<layer>.json`, which
 * resolves every visual layer to the CMR concept ids it is built from (both the
 * science-quality STD and the near-real-time NRT records). The panel links the
 * first STD record to Earthdata Search, so a reader can go from "this picture"
 * to the actual citable dataset in one click.
 *
 * Regenerate with the same service when the catalogue changes; do not hand-edit
 * the ids, a wrong CMR id silently points at another dataset.
 */

export interface GibsDatasetRecord {
	/** CMR short name, e.g. `MOD02QKM`. */
	shortName: string;
	/** Dataset version, e.g. `v6.1`. */
	version?: string;
	/** CMR concept id, the stable handle Earthdata Search understands. */
	cmrId: string;
	/** Archiving data centre, e.g. `LAADS`. */
	center?: string;
	/** `STD` (science quality) or `NRT` (near real time). */
	type?: string;
}

/** CMR records per GIBS layer id, STD entries first (as published). */
export const GIBS_DATASETS: Record<string, GibsDatasetRecord[]> = {
	AIRS_L2_Surface_Air_Temperature_Day: [
		{
			shortName: 'AIRS2RET_NRT',
			version: '7.0',
			cmrId: 'C1701805625-GES_DISC',
			center: 'GES_DISC',
			type: 'NRT'
		},
		{
			shortName: 'AIRS2RET',
			version: '7.0',
			cmrId: 'C1701805619-GES_DISC',
			center: 'GES_DISC',
			type: 'STD'
		}
	],
	GHRSST_L4_MUR_Sea_Surface_Temperature: [
		{
			shortName: 'MUR-JPL-L4-GLOB-v4.1',
			version: '4.1',
			cmrId: 'C1996881146-POCLOUD',
			center: 'POCLOUD',
			type: 'STD'
		}
	],
	GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies: [
		{
			shortName: 'MUR-JPL-L4-GLOB-v4.1',
			version: '4.1',
			cmrId: 'C1996881146-POCLOUD',
			center: 'POCLOUD',
			type: 'STD'
		}
	],
	IMERG_Precipitation_Rate: [
		{
			shortName: 'GPM_3IMERGHH',
			version: '07',
			cmrId: 'C2723754847-GES_DISC',
			center: 'GES_DISC',
			type: 'STD'
		},
		{
			shortName: 'GPM_3IMERGHHE',
			version: '07',
			cmrId: 'C2723758340-GES_DISC',
			center: 'GES_DISC',
			type: 'NRT'
		}
	],
	MERRA2_2m_Air_Temperature_Monthly: [
		{
			shortName: 'M2TMNXSLV',
			version: '5.12.4',
			cmrId: 'C1276812859-GES_DISC',
			center: 'GES_DISC',
			type: 'STD'
		}
	],
	MERRA2_Aerosol_Optical_Depth_Analysis_Monthly: [
		{
			shortName: 'M2IMNXGAS',
			version: '5.12.4',
			cmrId: 'C1276812824-GES_DISC',
			center: 'GES_DISC',
			type: 'STD'
		}
	],
	MODIS_Aqua_Aerosol_Optical_Depth_3km: [
		{
			shortName: 'MYD04_3K',
			version: '6.1NRT',
			cmrId: 'C1426717545-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MYD04_3K',
			version: '6.1',
			cmrId: 'C1443528505-LAADS',
			center: 'LAADS',
			type: 'STD'
		}
	],
	MODIS_Aqua_CorrectedReflectance_TrueColor: [
		{
			shortName: 'MYD021KM',
			version: '6.1NRT',
			cmrId: 'C1426616847-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MYD02HKM',
			version: '6.1NRT',
			cmrId: 'C1426617060-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MYD02QKM',
			version: '6.1NRT',
			cmrId: 'C1426621826-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MYD02QKM',
			version: '6.1',
			cmrId: 'C1379759127-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MYD02HKM',
			version: '6.1',
			cmrId: 'C1379758778-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MYD021KM',
			version: '6.1',
			cmrId: 'C1379758607-LAADS',
			center: 'LAADS',
			type: 'STD'
		}
	],
	MODIS_Aqua_L3_NDVI_16Day: [
		{
			shortName: 'MYD13Q1',
			version: '006',
			cmrId: 'C194001221-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		},
		{
			shortName: 'MYD13Q1',
			version: '061',
			cmrId: 'C1621431683-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		}
	],
	'MODIS_Combined_Flood_1-Day': [
		{
			shortName: 'MCDWD_L3_NRT',
			version: '6.1',
			cmrId: 'C2018599131-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MCDWD_L3_F1_NRT',
			version: '6.1',
			cmrId: 'C2018623526-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		}
	],
	'MODIS_Combined_Flood_3-Day': [
		{
			shortName: 'MCDWD_L3_NRT',
			version: '6.1',
			cmrId: 'C2018599131-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MCDWD_L3_F3_NRT',
			version: '6.1',
			cmrId: 'C2019424090-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		}
	],
	MODIS_Combined_L3_Black_Sky_Albedo_Daily: [
		{
			shortName: 'MCD43A3N',
			version: '6.1NRT',
			cmrId: 'C2130636890-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MCD43A2N',
			version: '6.1NRT',
			cmrId: 'C2129016354-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MCD43A3',
			version: '061',
			cmrId: 'C1620265701-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		},
		{
			shortName: 'MCD43A3',
			version: '006',
			cmrId: 'C1000000426-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		},
		{
			shortName: 'MCD43A2',
			version: '006',
			cmrId: 'C1000000454-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		},
		{
			shortName: 'MCD43A2',
			version: '061',
			cmrId: 'C1620265582-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		}
	],
	MODIS_Terra_Aerosol_Optical_Depth_3km: [
		{
			shortName: 'MOD04_3K',
			version: '6.1',
			cmrId: 'C1443420430-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MOD04_3K',
			version: '6.1NRT',
			cmrId: 'C1426426499-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		}
	],
	MODIS_Terra_Cloud_Top_Temp_Day: [
		{
			shortName: 'MOD06_L2',
			version: '6.1',
			cmrId: 'C1443535037-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MOD06_L2',
			version: '6.1NRT',
			cmrId: 'C1426500206-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		}
	],
	MODIS_Terra_CorrectedReflectance_Bands367: [
		{
			shortName: 'MOD021KM',
			version: '6.1NRT',
			cmrId: 'C1426414410-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02HKM',
			version: '6.1NRT',
			cmrId: 'C1426415307-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02QKM',
			version: '6.1NRT',
			cmrId: 'C1426416980-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD03',
			version: '6.1NRT',
			cmrId: 'C1426422512-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02QKM',
			version: '6.1',
			cmrId: 'C1378579425-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MOD02HKM',
			version: '6.1',
			cmrId: 'C1378577630-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MOD021KM',
			version: '6.1',
			cmrId: 'C1378227407-LAADS',
			center: 'LAADS',
			type: 'STD'
		}
	],
	MODIS_Terra_CorrectedReflectance_Bands721: [
		{
			shortName: 'MOD021KM',
			version: '6.1NRT',
			cmrId: 'C1426414410-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02HKM',
			version: '6.1NRT',
			cmrId: 'C1426415307-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02QKM',
			version: '6.1NRT',
			cmrId: 'C1426416980-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD03',
			version: '6.1NRT',
			cmrId: 'C1426422512-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02QKM',
			version: '6.1',
			cmrId: 'C1378579425-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MOD02HKM',
			version: '6.1',
			cmrId: 'C1378577630-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MOD021KM',
			version: '6.1',
			cmrId: 'C1378227407-LAADS',
			center: 'LAADS',
			type: 'STD'
		}
	],
	MODIS_Terra_CorrectedReflectance_TrueColor: [
		{
			shortName: 'MOD021KM',
			version: '6.1NRT',
			cmrId: 'C1426414410-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02HKM',
			version: '6.1NRT',
			cmrId: 'C1426415307-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02QKM',
			version: '6.1NRT',
			cmrId: 'C1426416980-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD03',
			version: '6.1NRT',
			cmrId: 'C1426422512-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD02QKM',
			version: '6.1',
			cmrId: 'C1378579425-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MOD02HKM',
			version: '6.1',
			cmrId: 'C1378577630-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'MOD021KM',
			version: '6.1',
			cmrId: 'C1378227407-LAADS',
			center: 'LAADS',
			type: 'STD'
		}
	],
	MODIS_Terra_L2_Chlorophyll_A: [
		{
			shortName: 'MODIST_L2_OC_NRT',
			version: '2022.0',
			cmrId: 'C3384236977-OB_CLOUD',
			center: 'OB_CLOUD',
			type: 'NRT'
		},
		{
			shortName: 'MODIST_L2_OC',
			version: '2022.0',
			cmrId: 'C3384236979-OB_CLOUD',
			center: 'OB_CLOUD',
			type: 'STD'
		}
	],
	MODIS_Terra_L3_NDVI_16Day: [
		{
			shortName: 'MOD13Q1',
			version: '006',
			cmrId: 'C194001241-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		},
		{
			shortName: 'MOD13Q1',
			version: '061',
			cmrId: 'C1621383370-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		}
	],
	MODIS_Terra_Land_Surface_Temp_Day: [
		{
			shortName: 'MOD11_L2',
			version: '6.1NRT',
			cmrId: 'C2007658455-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD11_L2',
			version: '006',
			cmrId: 'C194001236-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		},
		{
			shortName: 'MOD11_L2',
			version: '061',
			cmrId: 'C2343115255-LPCLOUD',
			center: 'LPCLOUD',
			type: 'STD'
		}
	],
	MODIS_Terra_Land_Surface_Temp_Night: [
		{
			shortName: 'MOD11_L2',
			version: '6.1NRT',
			cmrId: 'C2007658455-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD11_L2',
			version: '006',
			cmrId: 'C194001236-LPDAAC_ECS',
			center: 'LPDAAC_ECS',
			type: 'STD'
		},
		{
			shortName: 'MOD11_L2',
			version: '061',
			cmrId: 'C2343115255-LPCLOUD',
			center: 'LPCLOUD',
			type: 'STD'
		}
	],
	MODIS_Terra_NDSI_Snow_Cover: [
		{
			shortName: 'MOD10_L2',
			version: '6.1NRT',
			cmrId: 'C2007659515-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'MOD10_L2',
			version: '61',
			cmrId: 'C3024162910-NSIDC_CPRD',
			center: 'NSIDC_CPRD',
			type: 'STD'
		}
	],
	OMI_Nitrogen_Dioxide_Tropo_Column: [
		{
			shortName: 'OMNO2d',
			version: '004',
			cmrId: 'C3333493715-GES_DISC',
			center: 'GES_DISC',
			type: 'STD'
		}
	],
	SMAP_L3_Passive_Day_Soil_Moisture: [
		{
			shortName: 'SPL3SMP',
			version: '009',
			cmrId: 'C2938664585-NSIDC_CPRD',
			center: 'NSIDC_CPRD',
			type: 'STD'
		}
	],
	'VIIRS_Combined_Flood_1-Day': [
		{
			shortName: 'VCDWD_L3_NRT',
			version: '2',
			cmrId: 'C3498036008-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VCDWDG_L3_NRT',
			version: '2',
			cmrId: 'C3498070684-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		}
	],
	VIIRS_NOAA20_CorrectedReflectance_TrueColor: [
		{
			shortName: 'VJ102IMG_NRT',
			version: '2.1',
			cmrId: 'C2208779826-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VJ103IMG_NRT',
			version: '2.1',
			cmrId: 'C2208793489-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VJ102MOD_NRT',
			version: '2.1',
			cmrId: 'C2208778455-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VJ102MOD_NRT',
			version: '2',
			cmrId: 'C1604614285-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		}
	],
	VIIRS_SNPP_CorrectedReflectance_TrueColor: [
		{
			shortName: 'VNP02IMG_NRT',
			version: '2',
			cmrId: 'C2185504759-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VNP03IMG_NRT',
			version: '2',
			cmrId: 'C2185522599-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VNP02MOD_NRT',
			version: '2',
			cmrId: 'C2185497928-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VNP03MOD_NRT',
			version: '2',
			cmrId: 'C2185511251-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		}
	],
	VIIRS_SNPP_DayNightBand: [
		{
			shortName: 'VNP02DNB_NRT',
			version: '2',
			cmrId: 'C2208367854-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VNP03DNB_NRT',
			version: '2',
			cmrId: 'C2185508532-LANCEMODIS',
			center: 'LANCEMODIS',
			type: 'NRT'
		},
		{
			shortName: 'VNP02DNB',
			version: '2',
			cmrId: 'C2105091380-LAADS',
			center: 'LAADS',
			type: 'STD'
		},
		{
			shortName: 'VNP03DNB',
			version: '2',
			cmrId: 'C1344465347-LAADS',
			center: 'LAADS',
			type: 'STD'
		}
	]
};

/**
 * Best citable record for a layer: the first science-quality entry, falling back
 * to whatever the service published first.
 */
export const gibsDatasetOf = (layerId: string): GibsDatasetRecord | undefined => {
	const records = GIBS_DATASETS[layerId];
	if (!records?.length) return undefined;
	return records.find((record) => record.type === 'STD') ?? records[0];
};

/** Earthdata Search link for a CMR concept id. */
export const gibsDatasetSearchUrl = (cmrId: string): string =>
	`https://search.earthdata.nasa.gov/search?q=${encodeURIComponent(cmrId)}`;

/** `MOD02QKM v6.1` style label for the panel chip. */
export const gibsDatasetLabel = (record: GibsDatasetRecord): string =>
	record.version ? `${record.shortName} ${record.version}` : record.shortName;
