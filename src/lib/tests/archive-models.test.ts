import { describe, expect, it } from 'vitest';

import {
	ARCHIVE_MODELS,
	ARCHIVE_VARIABLES,
	archiveStartDate,
	buildArchiveUrl,
	clampArchivePeriod,
	maxYearForVariable,
	modelSupportsPressureLevels,
	startYearForVariable
} from '$lib/stores/archive';

const temperature = ARCHIVE_VARIABLES.find((variable) => variable.name === 'temperature_2m')!;

describe('historical source metadata', () => {
	it('preserves the deep, consistent reanalysis records', () => {
		expect(startYearForVariable(temperature, 'era5')).toBe(1940);
		expect(startYearForVariable(temperature, 'era5_land')).toBe(1950);
		expect(startYearForVariable(temperature, 'era5_ensemble')).toBe(1940);
		expect(ARCHIVE_MODELS.find((model) => model.value === 'cerra')?.startYear).toBe(1985);
	});

	it('uses the documented start dates for short forecast archives', () => {
		expect(ARCHIVE_MODELS.find((model) => model.value === 'gfs_seamless')?.firstAvailableDate).toBe(
			'2021-03-23'
		);
		expect(
			ARCHIVE_MODELS.find((model) => model.value === 'icon_seamless')?.firstAvailableDate
		).toBe('2022-11-24');
		expect(
			ARCHIVE_MODELS.find((model) => model.value === 'cma_grapes_global')?.firstAvailableDate
		).toBe('2023-12-31');
		expect(startYearForVariable(temperature, 'gfs_seamless')).toBe(2021);
		expect(startYearForVariable(temperature, 'icon_seamless')).toBe(2022);
		expect(startYearForVariable(temperature, 'cma_grapes_global')).toBe(2023);
	});

	it('caps year-based CERRA analysis at the last complete year', () => {
		expect(maxYearForVariable(temperature, 'cerra', 2026)).toBe(2020);
		expect(maxYearForVariable(temperature, 'era5', 2026)).toBe(2025);
	});

	it('starts the first selected forecast year on the model’s real coverage date', () => {
		expect(archiveStartDate('gfs_seamless', 2021)).toBe('2021-03-23');
		expect(archiveStartDate('gfs_seamless', 2022)).toBe('2022-01-01');
		expect(archiveStartDate('icon_seamless', 2022)).toBe('2022-11-24');
		expect(archiveStartDate('cma_grapes_global', 2023)).toBe('2023-12-31');
		expect(archiveStartDate('era5', 1940)).toBe('1940-01-01');
	});

	it('switches to the full new-source range when two source periods do not overlap', () => {
		expect(clampArchivePeriod(temperature, 'gfs_seamless', 1985, 2020, 2026)).toEqual({
			startYear: 2021,
			endYear: 2025
		});
		expect(clampArchivePeriod(temperature, 'cerra', 2021, 2025, 2026)).toEqual({
			startYear: 1985,
			endYear: 2020
		});
	});

	it('routes forecast models to the official Historical Forecast API', () => {
		const forecastUrl = new URL(
			buildArchiveUrl(
				temperature,
				'gfs_seamless',
				23.81,
				90.41,
				'2021-03-23',
				'2021-03-24',
				'hourly'
			)
		);
		expect(forecastUrl.origin).toBe('https://historical-forecast-api.open-meteo.com');
		expect(forecastUrl.pathname).toBe('/v1/forecast');
		expect(forecastUrl.searchParams.get('models')).toBe('gfs_seamless');

		const reanalysisUrl = new URL(
			buildArchiveUrl(temperature, 'era5', 23.81, 90.41, '1940-01-01', '1940-01-02', 'daily')
		);
		expect(reanalysisUrl.origin).toBe('https://archive-api.open-meteo.com');
		expect(reanalysisUrl.pathname).toBe('/v1/archive');
	});

	it('offers pressure levels only for models verified to return them', () => {
		expect(modelSupportsPressureLevels('era5')).toBe(false);
		expect(modelSupportsPressureLevels('gfs_seamless')).toBe(true);
		expect(modelSupportsPressureLevels('icon_seamless')).toBe(true);
		expect(modelSupportsPressureLevels('cma_grapes_global')).toBe(true);
	});
});
