<script lang="ts">
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { fly } from 'svelte/transition';

	import {
		BookOpen,
		ChevronDown,
		CircleHelp,
		CloudDownload,
		Copy,
		ExternalLink,
		Layers3,
		MapPin,
		MousePointer2,
		Search,
		Sun,
		X
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	import { map } from '$lib/stores/map';
	import {
		type PowerGridOverlay,
		type PowerGridPoint,
		clearPowerGridOverlay,
		powerGridOverlay,
		powerGridVisible,
		powerPanelState
	} from '$lib/stores/power';

	import {
		NASA_POWER_API,
		NASA_POWER_DOCS,
		POWER_API_DIRECTORY,
		POWER_ARCGIS_SERVICES,
		POWER_AWS_DATASETS,
		POWER_AWS_REGISTRY,
		POWER_COMMUNITIES,
		POWER_LIMITS,
		POWER_TEMPORALS,
		type PowerApiDefinition,
		type PowerApplication,
		type PowerApplicationRequest,
		type PowerApplicationSpatial,
		type PowerCommunity,
		type PowerJsonResponse,
		type PowerParameterMetadata,
		type PowerSeriesPoint,
		type PowerTemporal,
		type PowerTemporalRequest,
		buildPowerApplicationUrl,
		buildPowerTemporalUrl,
		isPowerImergParameter,
		makePowerWindrosePlotUrl,
		numericPowerValue,
		powerApiResourceUrl,
		powerConfigurationUrl,
		powerJsonError,
		powerOpenApiUrl,
		powerParameterCatalogUrl,
		powerParameterDetailUrl,
		powerResponseMessages,
		powerSeriesFromResponse,
		powerSourceResolutionNotes,
		powerSurfaceDetailUrl,
		validatePowerApplicationRequest,
		validatePowerCoverageRange,
		validatePowerTemporalRequest
	} from '$lib/nasa-power';
	import { syncPowerGridLayer } from '$lib/power-map';

	import type * as maplibregl from 'maplibre-gl';

	type MainTab = 'data' | 'applications' | 'catalog' | 'sources';
	type CatalogView = 'parameters' | 'surfaces' | 'groups' | 'availability' | 'content' | 'registry';
	type ApiDoc = {
		openapi?: string;
		info?: { title?: string; version?: string };
		components?: { schemas?: Record<string, { enum?: unknown[] }> };
		paths?: Record<
			string,
			{ get?: { parameters?: { name?: string; schema?: { enum?: unknown[]; $ref?: string } }[] } }
		>;
	};
	type ApiConfig = {
		documentation?: { version?: string; title?: string; description?: string; contact?: string };
		settings?: Record<string, unknown>;
	};
	type ApiResult = {
		url: string;
		format: string;
		data?: PowerJsonResponse;
		requestKey?: string;
		status: 'idle' | 'loading' | 'success' | 'error';
		messages: string[];
	};

	const tabItems: { id: MainTab; label: string }[] = [
		{ id: 'data', label: 'Data' },
		{ id: 'applications', label: 'Applications' },
		{ id: 'catalog', label: 'Catalog & system' },
		{ id: 'sources', label: 'Maps & bulk' }
	];
	const communities: Record<PowerCommunity, string> = {
		AG: 'Agroclimatology',
		RE: 'Renewable energy',
		SB: 'Sustainable buildings'
	};

	let activeTab = $state<MainTab>('data');
	let panelIsOpen = $state(false);
	const unsubscribePanelState = powerPanelState.subscribe((state) => {
		panelIsOpen = state.open;
	});
	let latitude = $state(23.8103);
	let longitude = $state(90.4125);
	let latitudeMin = $state(22.8);
	let latitudeMax = $state(24.8);
	let longitudeMin = $state(89.4);
	let longitudeMax = $state(91.4);
	let mapPickMessage = $state('');

	let temporal = $state<PowerTemporal>('daily');
	let spatial = $state<'point' | 'regional'>('point');
	let community = $state<string>('AG');
	let availableCommunities = $state<string[]>([...POWER_COMMUNITIES]);
	let parameters = $state<string[]>(['T2M']);
	let parameterSearch = $state('');
	let parameterCatalog: Record<string, PowerParameterMetadata> = $state({});
	let parameterCatalogError = $state('');
	let parameterCatalogLoading = $state(false);
	let dataFormats = $state<string[]>(['json']);
	let dataFormat = $state('json');
	let dataUnits: 'metric' | 'imperial' = $state('metric');
	let timeStandard: 'lst' | 'utc' = $state('lst');
	let apiUser = $state('');
	let dataStart = $state('2024-01-01');
	let dataEnd = $state('2024-01-07');
	let monthlyStart = $state('2023');
	let monthlyEnd = $state('2024');
	let climatologyStart = $state('2001');
	let climatologyEnd = $state('2020');
	let customClimatology = $state(false);
	let showAdvanced = $state(false);
	let includeHeader = $state(true);
	let siteElevation = $state('');
	let windElevation = $state('');
	let windSurface = $state('');
	let surfaces: Record<string, Record<string, unknown>> = $state({});
	let surfaceAliasLoading = $state(false);
	let surfaceAliasError = $state('');
	let surfaceDetailAlias = $state('');
	let surfaceDetail: Record<string, unknown> | undefined = $state(undefined);
	let surfaceDetailLoading = $state(false);
	let surfaceDetailError = $state('');
	let surfaceDetailController: AbortController | undefined;
	let temporalConfig = $state<ApiConfig | undefined>(undefined);
	let dataLoading = $state(false);
	let dataResult = $state<ApiResult | undefined>(undefined);
	let regionalResponse = $state<PowerJsonResponse | undefined>(undefined);
	let regionalPeriod = $state('');
	let dataLoadController: AbortController | undefined;
	let temporalRequestController: AbortController | undefined;
	let activeTemporalRequestKey = '';
	let catalogController: AbortController | undefined;
	let loadedDataKey = '';

	let application = $state<PowerApplication>('indicators');
	let applicationSpatial = $state<PowerApplicationSpatial>('point');
	let applicationConfig = $state<ApiConfig | undefined>(undefined);
	let applicationFormats = $state<string[]>(['json']);
	let applicationFormat = $state('json');
	let applicationStart = $state('2001');
	let applicationEnd = $state('2010');
	let windroseStart = $state('2010-01-01');
	let windroseEnd = $state('2014-12-31');
	let windroseHeight = $state<'WR10M' | 'WR50M'>('WR10M');
	let windroseTheme = $state<'light' | 'dark'>('light');
	let applicationUnits: 'metric' | 'imperial' = $state('metric');
	let applicationTimeStandard: 'lst' | 'utc' = $state('lst');
	let applicationLoading = $state(false);
	let applicationResult = $state<ApiResult | undefined>(undefined);
	let applicationLoadController: AbortController | undefined;
	let activeApplicationRequestKey = '';
	let loadedApplicationKey = '';

	let catalogView = $state<CatalogView>('parameters');
	let catalogCommunity = $state<PowerCommunity>('AG');
	let catalogTemporal = $state<PowerTemporal>('daily');
	let catalogSearch = $state('');
	let managerCatalog: Record<string, PowerParameterMetadata> = $state({});
	let selectedManagerCode = $state('');
	let managerDetail = $state<Record<string, unknown> | undefined>(undefined);
	let catalogGroups = $state<
		| Record<string, Record<string, Record<string, { name?: string; abbreviation?: string }[]>>>
		| undefined
	>(undefined);
	let resourcesAvailability = $state<
		Record<string, { last?: string; available?: number; latency?: number }> | undefined
	>(undefined);
	let resourceContentName = $state<'dashboard-sources' | 'dashboard-hourly' | 'dashboard-daily'>(
		'dashboard-sources'
	);
	let resourceContent: unknown = $state(undefined);
	let catalogLoading = $state(false);
	let catalogError = $state('');
	let loadedCatalogKey = '';

	let regionalPickHandler: ((event: maplibregl.MapMouseEvent) => void) | undefined;
	let pickingMap: maplibregl.Map | undefined;
	let currentMap: maplibregl.Map | undefined;
	let currentOverlay: PowerGridOverlay | undefined;
	let currentOverlayVisibility = true;
	let styleListener: (() => void) | undefined;

	const filteredParameters = $derived.by(() => {
		const query = parameterSearch.trim().toLowerCase();
		return Object.entries(parameterCatalog)
			.filter(([code, metadata]) => {
				if (!query) return true;
				return `${code} ${metadata.name ?? ''} ${metadata.definition ?? ''} ${metadata.units ?? ''}`
					.toLowerCase()
					.includes(query);
			})
			.sort((a, b) => (a[1].name ?? a[0]).localeCompare(b[1].name ?? b[0]));
	});
	const selectedLimit = $derived(
		spatial === 'regional'
			? POWER_LIMITS.regionalParameters
			: temporal === 'hourly'
				? POWER_LIMITS.hourlyPointParameters
				: POWER_LIMITS.otherPointParameters
	);
	const selectedLimitLabel = $derived(
		spatial === 'regional'
			? '1 parameter for regional requests'
			: temporal === 'hourly'
				? '15 parameters per hourly point request'
				: '20 parameters per point request'
	);
	const selectedImergParameters = $derived.by(() =>
		parameters.filter((code) => isPowerImergParameter(code, parameterCatalog[code]))
	);
	const effectiveTimeStandard = $derived(
		temporal === 'hourly' || temporal === 'daily'
			? temporal === 'daily' && selectedImergParameters.length > 0
				? 'utc'
				: timeStandard
			: undefined
	);
	const temporalRequest = $derived.by((): PowerTemporalRequest => {
		const timeRange =
			temporal === 'monthly'
				? { start: monthlyStart, end: monthlyEnd }
				: temporal === 'climatology'
					? { start: climatologyStart, end: climatologyEnd, customClimatology }
					: { start: dataStart, end: dataEnd };
		const parseOptional = (value: string) => (value.trim() === '' ? undefined : Number(value));
		return {
			temporal,
			spatial,
			community,
			parameters,
			latitude,
			longitude,
			bounds: { latitudeMin, latitudeMax, longitudeMin, longitudeMax },
			...timeRange,
			format: dataFormat,
			units: dataUnits,
			timeStandard: effectiveTimeStandard,
			user: apiUser || undefined,
			header: includeHeader,
			siteElevation: parseOptional(siteElevation),
			windElevation: parseOptional(windElevation),
			windSurface: windSurface || undefined
		};
	});
	function coverageBoundary(
		config: ApiConfig | undefined,
		boundary: 'start' | 'end',
		precision: 'date' | 'year'
	): string | undefined {
		const value = config?.settings?.[boundary];
		if (typeof value !== 'string' && typeof value !== 'number') return undefined;
		const text = String(value);
		if (precision === 'year') return text.match(/^\d{4}/)?.[0];
		const date = text.match(/^(\d{4})-(\d{2})-(\d{2})/)?.slice(1);
		return date ? `${date[0]}-${date[1]}-${date[2]}` : undefined;
	}

	function validateTemporalWithLiveCoverage(request: PowerTemporalRequest) {
		const validation = validatePowerTemporalRequest(request);
		if (!validation.valid) return validation;
		if (request.temporal === 'climatology' && !request.customClimatology) return validation;
		const precision =
			request.temporal === 'hourly' || request.temporal === 'daily' ? 'date' : 'year';
		return validatePowerCoverageRange(
			request.start,
			request.end,
			coverageBoundary(temporalConfig, 'start', precision),
			coverageBoundary(temporalConfig, 'end', precision),
			precision,
			`NASA POWER ${request.temporal}`
		);
	}

	function currentApplicationOptions(): PowerApplicationRequest {
		return {
			application,
			spatial: application === 'zones' ? applicationSpatial : 'point',
			latitude,
			longitude,
			bounds: { latitudeMin, latitudeMax, longitudeMin, longitudeMax },
			start: application === 'windrose' ? windroseStart : applicationStart,
			end: application === 'windrose' ? windroseEnd : applicationEnd,
			format: applicationFormat,
			units: application === 'zones' ? undefined : applicationUnits,
			timeStandard: application === 'windrose' ? applicationTimeStandard : undefined,
			user: apiUser || undefined
		};
	}

	function validateApplicationWithLiveCoverage(request: PowerApplicationRequest) {
		const validation = validatePowerApplicationRequest(request);
		if (!validation.valid) return validation;
		const precision = request.application === 'windrose' ? 'date' : 'year';
		return validatePowerCoverageRange(
			request.start,
			request.end,
			coverageBoundary(applicationConfig, 'start', precision),
			coverageBoundary(applicationConfig, 'end', precision),
			precision,
			`NASA POWER ${request.application}`
		);
	}

	const temporalValidation = $derived(validateTemporalWithLiveCoverage(temporalRequest));
	const specializedHourlyFormat = $derived(
		temporal === 'hourly' && ['sam', 'srw'].includes(dataFormat.toLowerCase())
	);
	const applicationValidation = $derived.by(() =>
		validateApplicationWithLiveCoverage(currentApplicationOptions())
	);
	const indicatorRows = $derived.by(() => {
		const data = applicationResult?.data as Record<string, unknown> | undefined;
		if (!data) return [];
		const metadata =
			data.metadata && typeof data.metadata === 'object'
				? (data.metadata as Record<string, unknown>)
				: {};
		return Object.entries(data)
			.filter(
				([code, value]) =>
					code !== 'metadata' && typeof value === 'number' && Number.isFinite(value)
			)
			.map(([code, value]) => {
				const info =
					metadata[code] && typeof metadata[code] === 'object'
						? (metadata[code] as Record<string, unknown>)
						: {};
				return {
					code,
					value: value as number,
					name: String(info.name ?? info.longname ?? info.description ?? code),
					unit: String(info.units ?? info.unit ?? '')
				};
			})
			.sort((a, b) => a.code.localeCompare(b.code));
	});
	const indicatorSummary = $derived.by(() => {
		const metadata = applicationResult?.data?.metadata;
		if (!metadata || typeof metadata !== 'object') return '';
		const info = metadata as Record<string, unknown>;
		const units =
			info.units && typeof info.units === 'object' ? (info.units as Record<string, unknown>) : {};
		const unitList = Object.entries(units).map(
			([name, unit]) => `${name.replaceAll('_', ' ')}: ${String(unit)}`
		);
		const period =
			info.start !== undefined && info.end !== undefined ? `${info.start}–${info.end}` : '';
		return [period, unitList.length ? `NASA-reported units — ${unitList.join('; ')}` : '']
			.filter(Boolean)
			.join(' · ');
	});
	const dataSeries = $derived.by(() => {
		if (!dataResult?.data) return [];
		return powerSeriesFromResponse(dataResult.data).map((series) => {
			const metadata = parameterCatalog[series.code];
			return {
				...series,
				name: series.name || metadata?.name || series.code
				// Units from the NASA response win: Manager units describe the catalog/default,
				// while the API may convert them (for example, Celsius to Fahrenheit).
			};
		});
	});
	const responseSourceIdentifiers = $derived.by(() => {
		const sources = dataResult?.data?.header?.sources;
		if (Array.isArray(sources)) return sources.map(String).filter(Boolean);
		return typeof sources === 'string' && sources.trim() ? [sources.trim()] : [];
	});
	const responseResolutionNotes = $derived(
		powerSourceResolutionNotes(dataResult?.data?.header?.sources)
	);
	const responseHasImerg = $derived(
		responseSourceIdentifiers.some((source) => /IMERG/i.test(source))
	);
	const responseHasGeosIt = $derived(
		responseSourceIdentifiers.some((source) => /GEOS.?IT/i.test(source))
	);
	const responseHasBothMeteorologySources = $derived(
		responseSourceIdentifiers.some((source) => /MERRA.?2/i.test(source)) && responseHasGeosIt
	);
	const responseHasEnergyFluxSource = $derived(
		responseSourceIdentifiers.some((source) => /SYN1DEG|SRB|FLASH.?FLUX|CERES/i.test(source))
	);
	const responseHasAllFill = $derived(
		dataSeries.length > 0 &&
			dataSeries.every((series) => series.validCount === 0 && series.annualValue === undefined)
	);
	const regionalFeatures = $derived(regionalResponse?.features ?? []);
	const regionalPeriodOptions = $derived.by(() => {
		const first = regionalFeatures[0]?.properties?.parameter?.[parameters[0]];
		if (!first || typeof first !== 'object' || Array.isArray(first)) return [];
		return Object.keys(first as Record<string, unknown>).sort();
	});
	const regionalQuality = $derived.by(() => {
		if (!regionalResponse || !regionalPeriod)
			return { sampleCount: 0, validCount: 0, missingCount: 0 };
		const fillValue = regionalResponse.header?.fill_value;
		const code = parameters[0];
		let validCount = 0;
		for (const feature of regionalFeatures) {
			const rawValues = feature.properties?.parameter?.[code];
			const value =
				rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues)
					? (rawValues as Record<string, unknown>)[regionalPeriod]
					: undefined;
			if (numericPowerValue(value, fillValue)) validCount += 1;
		}
		return {
			sampleCount: regionalFeatures.length,
			validCount,
			missingCount: regionalFeatures.length - validCount
		};
	});
	const windroseHeights = $derived.by(() => {
		const parameter = applicationResult?.data?.properties?.parameter as
			Record<string, unknown> | undefined;
		return ['WR10M', 'WR50M'].filter((height) => parameter?.[height] !== undefined);
	});
	const rose = $derived.by(() => {
		const response = applicationResult?.data;
		if (!response) return undefined;
		const parameter = response.properties?.parameter as Record<string, unknown> | undefined;
		if (!parameter) return undefined;
		const wind = parameter[windroseHeight] ?? parameter.WR10M ?? Object.values(parameter)[0];
		if (!wind || typeof wind !== 'object') return undefined;
		const directions = Object.entries(wind as Record<string, unknown>)
			.filter(([direction, value]) => direction !== 'ALL' && value && typeof value === 'object')
			.map(([direction, value]) => {
				const row = value as Record<string, unknown>;
				const classes =
					row.CLASSES && typeof row.CLASSES === 'object'
						? (row.CLASSES as Record<string, unknown>)
						: {};
				return {
					direction,
					bearing: Number(direction),
					percent: Number(row.WD_PCT ?? 0),
					average: Number(row.WD_AVG ?? 0),
					classes: Object.entries(classes)
						.filter(([, number]) => typeof number === 'number' && Number.isFinite(number))
						.sort((a, b) => classIndex(a[0]) - classIndex(b[0])) as [string, number][]
				};
			})
			.filter((item) => Number.isFinite(item.bearing) && Number.isFinite(item.percent))
			.sort((a, b) => a.bearing - b.bearing);
		const classNames = [
			...new Set(directions.flatMap((direction) => direction.classes.map(([name]) => name)))
		];
		const sourceMessages = Array.isArray(response.messages) ? response.messages : [];
		const metadata = sourceMessages.find((item) => item && typeof item === 'object') as
			Record<string, unknown> | undefined;
		const classMetadata =
			metadata?.CLASSES && typeof metadata.CLASSES === 'object'
				? (metadata.CLASSES as Record<string, unknown>)[windroseHeight]
				: undefined;
		const labels =
			classMetadata && typeof classMetadata === 'object'
				? (classMetadata as Record<string, unknown>)
				: {};
		const classLabels = classNames.map((name) => ({ name, label: String(labels[name] ?? name) }));
		return directions.length ? { directions, classNames, classLabels } : undefined;
	});
	const zonesValues = $derived.by(() => {
		const response = applicationResult?.data;
		const values = response?.properties?.parameter;
		if (!values || typeof values !== 'object') return [];
		return Object.entries(values)
			.filter(([key]) => key.endsWith('_ZONES'))
			.map(([code, value]) => ({
				code,
				value,
				name: String(response?.parameters?.[code]?.longname ?? code)
			}));
	});

	function classIndex(value: string): number {
		return Number(value.match(/(\d+)$/)?.[1] ?? 0);
	}

	function niceFormat(value: string): string {
		return value.toUpperCase().replaceAll('_', ' ');
	}

	function dateText(value: string | number | unknown): string {
		if (typeof value !== 'string') return String(value ?? '—');
		return value.replace('T00:00:00', '');
	}

	function responseMessagesForUi(messages: unknown): string[] {
		if (typeof messages === 'string') return [messages];
		if (Array.isArray(messages))
			return messages.filter((value): value is string => typeof value === 'string');
		return [];
	}

	async function fetchJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
		const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
		const text = await response.text();
		let body: unknown;
		try {
			body = text ? JSON.parse(text) : {};
		} catch {
			body = text;
		}
		if (!response.ok) {
			const message = powerResponseMessages(body).join(' ');
			throw new Error(
				`NASA POWER returned HTTP ${response.status}${message ? `: ${message}` : '.'}`
			);
		}
		if (typeof body === 'string')
			throw new Error('NASA POWER returned a non-JSON response for a JSON request.');
		return body as T;
	}

	async function loadSurfaceAliases(): Promise<void> {
		if (Object.keys(surfaces).length || surfaceAliasLoading) return;
		surfaceAliasLoading = true;
		surfaceAliasError = '';
		try {
			surfaces = await fetchJson<Record<string, Record<string, unknown>>>(
				powerApiResourceUrl('/api/system/manager/surface')
			);
		} catch (error) {
			surfaceAliasError =
				error instanceof Error ? error.message : 'Could not load POWER surface aliases.';
		} finally {
			surfaceAliasLoading = false;
		}
	}

	async function loadSurfaceDetail(alias: string): Promise<void> {
		surfaceDetailController?.abort();
		const controller = new AbortController();
		surfaceDetailController = controller;
		surfaceDetailAlias = alias;
		surfaceDetail = undefined;
		surfaceDetailError = '';
		surfaceDetailLoading = true;
		try {
			surfaceDetail = await fetchJson<Record<string, unknown>>(
				powerSurfaceDetailUrl(alias),
				controller.signal
			);
		} catch (error) {
			if (!controller.signal.aborted) {
				surfaceDetailError =
					error instanceof Error ? error.message : 'Could not load this POWER surface alias.';
			}
		} finally {
			if (!controller.signal.aborted) surfaceDetailLoading = false;
		}
	}

	function getApiDefinition(id: string): PowerApiDefinition {
		return POWER_API_DIRECTORY.find((entry) => entry.id === id) ?? POWER_API_DIRECTORY[0];
	}

	function getOperationFormatList(doc: ApiDoc | undefined, path: string): string[] {
		const parameters = doc?.paths?.[path]?.get?.parameters ?? [];
		const format = parameters.find((parameter) => parameter.name === 'format');
		let values = format?.schema?.enum;
		const schemaRef = format?.schema?.$ref;
		if (!values && schemaRef) {
			const schemaName = schemaRef.split('/').at(-1);
			values = schemaName ? doc?.components?.schemas?.[schemaName]?.enum : undefined;
		}
		return (values ?? []).filter((item): item is string => typeof item === 'string');
	}

	async function loadTemporalResources(force = false): Promise<void> {
		const key = `${temporal}|${community}|${spatial}`;
		if (!force && key === loadedDataKey && Object.keys(parameterCatalog).length) return;
		loadedDataKey = key;
		temporalConfig = undefined;
		dataLoadController?.abort();
		const controller = new AbortController();
		dataLoadController = controller;
		parameterCatalogLoading = true;
		parameterCatalogError = '';
		try {
			const definition = getApiDefinition(temporal);
			const managerUrl = powerParameterCatalogUrl(community, temporal);
			const configUrl = powerConfigurationUrl(definition);
			const specUrl = powerOpenApiUrl(definition);
			const [catalog, config, spec] = await Promise.all([
				fetchJson<Record<string, PowerParameterMetadata>>(managerUrl, controller.signal),
				fetchJson<ApiConfig>(configUrl, controller.signal),
				fetchJson<ApiDoc>(specUrl, controller.signal)
			]);
			if (controller.signal.aborted) return;
			parameterCatalog = catalog;
			temporalConfig = config;

			const liveCommunities = (config.settings?.community as string[] | undefined)?.map((value) =>
				value.toUpperCase()
			);
			if (liveCommunities?.length) {
				availableCommunities = liveCommunities;
				if (!liveCommunities.includes(community)) {
					community = liveCommunities.includes('AG') ? 'AG' : liveCommunities[0];
				}
			}
			const path = `/api/temporal/${temporal}/${spatial}`;
			let formats = getOperationFormatList(spec, path);
			if (!formats.length && temporalConfig?.settings?.formats) {
				formats = temporalConfig.settings.formats as string[];
			}
			// NASA documentation restricts these legacy formats to their own communities.
			if (temporal === 'daily' && community !== 'AG')
				formats = formats.filter((format) => format.toLowerCase() !== 'icasa');
			if (temporal === 'hourly' && community !== 'SB') {
				formats = formats.filter((format) => !['epw', 'epw_csv'].includes(format.toLowerCase()));
			}
			dataFormats = formats.length ? formats.map((format) => format.toLowerCase()) : ['json'];
			if (!dataFormats.includes(dataFormat.toLowerCase())) {
				dataFormat = dataFormats.includes('json') ? 'json' : dataFormats[0];
			}
			if (!parameters.length || parameters.some((parameter) => !catalog[parameter])) {
				parameters = catalog.T2M ? ['T2M'] : [Object.keys(catalog)[0]].filter(Boolean);
			}
			if (spatial === 'regional' && parameters.length > 1) parameters = parameters.slice(0, 1);
		} catch (error) {
			if (!controller.signal.aborted) {
				parameterCatalogError =
					error instanceof Error ? error.message : 'Could not load NASA POWER parameter metadata.';
			}
		} finally {
			if (!controller.signal.aborted) parameterCatalogLoading = false;
		}
	}

	async function loadApplicationResources(force = false): Promise<void> {
		const key = `${application}|${applicationSpatial}`;
		if (!force && key === loadedApplicationKey && applicationConfig) return;
		loadedApplicationKey = key;
		applicationConfig = undefined;
		activeApplicationRequestKey = '';
		applicationLoadController?.abort();
		const controller = new AbortController();
		applicationLoadController = controller;
		applicationLoading = true;
		try {
			const definition = getApiDefinition(application);
			const [config, spec] = await Promise.all([
				fetchJson<ApiConfig>(powerConfigurationUrl(definition), controller.signal),
				fetchJson<ApiDoc>(powerOpenApiUrl(definition), controller.signal)
			]);
			if (controller.signal.aborted) return;
			applicationConfig = config;
			const formatsFromConfig = config.settings?.formats;
			const path = `/api/application/${application}/${application === 'zones' ? applicationSpatial : 'point'}`;
			const fromSpec = getOperationFormatList(spec, path);
			let formats = Array.isArray(formatsFromConfig)
				? formatsFromConfig.filter((value): value is string => typeof value === 'string')
				: formatsFromConfig && typeof formatsFromConfig === 'object'
					? (((formatsFromConfig as Record<string, unknown>)[applicationSpatial] as
							string[] | undefined) ?? [])
					: [];
			// Configuration is the authoritative live list. In particular, the
			// Windrose HTML plot is a separate /plot resource, not a point format.
			if (!formats.length) formats = fromSpec;
			applicationFormats = formats.length
				? formats.map((format) => format.toLowerCase())
				: ['json'];
			if (!applicationFormats.includes(applicationFormat.toLowerCase())) {
				applicationFormat = applicationFormats.includes('json') ? 'json' : applicationFormats[0];
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				applicationConfig = undefined;
				applicationFormats = ['json'];
				applicationResult = {
					url: '',
					format: 'json',
					status: 'error',
					messages: [
						error instanceof Error
							? error.message
							: 'Could not load the POWER application API configuration.'
					]
				};
			}
		} finally {
			if (!controller.signal.aborted) applicationLoading = false;
		}
	}

	async function loadCurrentCatalogView(force = false): Promise<void> {
		const key = `${catalogView}|${catalogCommunity}|${catalogTemporal}|${resourceContentName}`;
		if (!force && key === loadedCatalogKey) return;
		loadedCatalogKey = key;
		catalogController?.abort();
		const controller = new AbortController();
		catalogController = controller;
		catalogLoading = true;
		catalogError = '';
		try {
			if (catalogView === 'parameters') {
				managerCatalog = await fetchJson<Record<string, PowerParameterMetadata>>(
					powerParameterCatalogUrl(catalogCommunity, catalogTemporal, true),
					controller.signal
				);
			} else if (catalogView === 'surfaces') {
				surfaces = await fetchJson<Record<string, Record<string, unknown>>>(
					powerApiResourceUrl('/api/system/manager/surface'),
					controller.signal
				);
			} else if (catalogView === 'groups') {
				const data = await fetchJson<{
					groups?: Record<
						string,
						Record<string, Record<string, { name?: string; abbreviation?: string }[]>>
					>;
				}>(powerApiResourceUrl('/api/system/manager/system/groupings'), controller.signal);
				catalogGroups = data.groups;
			} else if (catalogView === 'availability') {
				resourcesAvailability = await fetchJson<
					Record<string, { last?: string; available?: number; latency?: number }>
				>(powerApiResourceUrl('/api/system/resources/dashboard/availability'), controller.signal);
			} else if (catalogView === 'content') {
				resourceContent = await fetchJson<unknown>(
					powerApiResourceUrl(
						`/api/system/resources/content?name=${encodeURIComponent(resourceContentName)}`
					),
					controller.signal
				);
			} else if (catalogView === 'registry') {
				const definition = getApiDefinition('manager');
				await Promise.all([
					fetchJson<ApiDoc>(powerOpenApiUrl(definition), controller.signal),
					fetchJson<ApiConfig>(powerConfigurationUrl(definition), controller.signal)
				]);
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				catalogError =
					error instanceof Error ? error.message : 'NASA POWER metadata request failed.';
			}
		} finally {
			if (!controller.signal.aborted) catalogLoading = false;
		}
	}

	$effect(() => {
		const isOpen = panelIsOpen;
		const currentTab = activeTab;
		const currentTemporal = temporal;
		const currentCommunity = community;
		const currentSpatial = spatial;
		if (!isOpen || currentTab !== 'data') return;
		const key = `${currentTemporal}|${currentCommunity}|${currentSpatial}`;
		if (key !== loadedDataKey || !Object.keys(parameterCatalog).length) {
			void loadTemporalResources();
		}
	});

	$effect(() => {
		const isOpen = panelIsOpen;
		const currentTab = activeTab;
		const currentApplication = application;
		const currentSpatial = applicationSpatial;
		if (!isOpen || currentTab !== 'applications') return;
		const key = `${currentApplication}|${currentSpatial}`;
		if (key !== loadedApplicationKey) {
			void loadApplicationResources();
		}
	});

	$effect(() => {
		const isOpen = panelIsOpen;
		const currentTab = activeTab;
		const currentView = catalogView;
		const currentCommunity = catalogCommunity;
		const currentTemporal = catalogTemporal;
		const currentContent = resourceContentName;
		if (!isOpen || currentTab !== 'catalog') return;
		const key = `${currentView}|${currentCommunity}|${currentTemporal}|${currentContent}`;
		if (key !== loadedCatalogKey) void loadCurrentCatalogView();
	});

	$effect(() => {
		if (panelIsOpen) {
			const nextLatitude = $powerPanelState.latitude;
			const nextLongitude = $powerPanelState.longitude;
			if (nextLatitude !== undefined) latitude = nextLatitude;
			if (nextLongitude !== undefined) longitude = nextLongitude;
		}
	});

	$effect(() => {
		const currentKey = JSON.stringify(requestForCurrentTemporal());
		const resultKey = dataResult?.requestKey;
		if (dataLoading && activeTemporalRequestKey && currentKey !== activeTemporalRequestKey) {
			temporalRequestController?.abort();
			dataLoading = false;
			dataResult = undefined;
			regionalResponse = undefined;
			regionalPeriod = '';
			clearPowerGridOverlay();
		} else if (resultKey && resultKey !== currentKey) {
			dataResult = undefined;
			regionalResponse = undefined;
			regionalPeriod = '';
			clearPowerGridOverlay();
		}
	});

	$effect(() => {
		const currentKey = JSON.stringify(currentApplicationOptions());
		const resultKey = applicationResult?.requestKey;
		if (
			applicationLoading &&
			activeApplicationRequestKey &&
			currentKey !== activeApplicationRequestKey
		) {
			applicationLoadController?.abort();
			activeApplicationRequestKey = '';
			applicationLoading = false;
			applicationResult = undefined;
		} else if (resultKey && resultKey !== currentKey) {
			applicationResult = undefined;
		}
	});

	$effect(() => {
		const isOpen = panelIsOpen;
		if (!isOpen && pickingMap) cancelMapPick();
	});

	$effect(() => {
		syncPowerGridLayer(currentMap, currentOverlay, currentOverlayVisibility);
	});

	const unsubscribeOverlay = powerGridOverlay.subscribe((value) => {
		currentOverlay = value;
		syncPowerGridLayer(currentMap, currentOverlay, currentOverlayVisibility);
	});
	const unsubscribeOverlayVisibility = powerGridVisible.subscribe((value) => {
		currentOverlayVisibility = value;
		syncPowerGridLayer(currentMap, currentOverlay, currentOverlayVisibility);
	});
	const unsubscribeMap = map.subscribe((value) => {
		if (currentMap && styleListener) currentMap.off('styledata', styleListener);
		currentMap = value;
		if (currentMap) {
			styleListener = () =>
				syncPowerGridLayer(currentMap, currentOverlay, currentOverlayVisibility);
			currentMap.on('styledata', styleListener);
		}
		syncPowerGridLayer(currentMap, currentOverlay, currentOverlayVisibility);
	});

	function setCoordinatesFromMap(): void {
		const center = get(map)?.getCenter();
		if (!center) return;
		latitude = center.lat;
		longitude = center.lng;
		powerPanelState.update((state) => ({ ...state, latitude, longitude }));
	}

	function setBoundsFromMap(
		minimumSpan: number = POWER_LIMITS.minimumRegionalSpanDegrees,
		setTemporalRegional = true
	): void {
		const current = get(map);
		if (!current) return;
		const bounds = current.getBounds();
		const center = bounds.getCenter();
		let west = bounds.getWest();
		let east = bounds.getEast();
		let south = bounds.getSouth();
		let north = bounds.getNorth();
		if (east <= west) {
			toast.error('NASA POWER bounding boxes cannot cross the antimeridian.');
			return;
		}
		if (east - west < minimumSpan) {
			west = Math.max(-180, Math.min(180 - minimumSpan, center.lng - minimumSpan / 2));
			east = west + minimumSpan;
		}
		if (north - south < minimumSpan) {
			south = Math.max(-90, Math.min(90 - minimumSpan, center.lat - minimumSpan / 2));
			north = south + minimumSpan;
		}
		longitudeMin = west;
		longitudeMax = east;
		latitudeMin = south;
		latitudeMax = north;
		if (setTemporalRegional) {
			spatial = 'regional';
			void loadTemporalResources(true);
		}
	}

	function cancelMapPick(): void {
		if (pickingMap && regionalPickHandler) pickingMap.off('click', regionalPickHandler);
		if (pickingMap) pickingMap.getCanvas().style.cursor = '';
		pickingMap = undefined;
		regionalPickHandler = undefined;
		mapPickMessage = '';
		powerPanelState.update((state) => ({ ...state, pickingLocation: false }));
	}

	function startMapPick(): void {
		const current = get(map);
		if (!current) {
			mapPickMessage = 'Map is not ready yet.';
			return;
		}
		cancelMapPick();
		pickingMap = current;
		mapPickMessage = 'Click the map to set the POWER point location.';
		current.getCanvas().style.cursor = 'crosshair';
		regionalPickHandler = (event) => {
			latitude = event.lngLat.lat;
			longitude = event.lngLat.lng;
			powerPanelState.update((state) => ({
				...state,
				latitude,
				longitude,
				pickingLocation: false
			}));
			if (pickingMap) pickingMap.getCanvas().style.cursor = '';
			pickingMap = undefined;
			regionalPickHandler = undefined;
			mapPickMessage = `Selected ${latitude.toFixed(4)}, ${longitude.toFixed(4)}.`;
		};
		current.on('click', regionalPickHandler);
		powerPanelState.update((state) => ({ ...state, pickingLocation: true }));
	}

	function toggleParameter(code: string, checked: boolean): void {
		if (checked) {
			if (parameters.length >= selectedLimit) {
				toast.error(
					`This request supports at most ${selectedLimit} parameter${selectedLimit === 1 ? '' : 's'}.`
				);
				return;
			}
			if (temporal === 'daily' && isPowerImergParameter(code, parameterCatalog[code])) {
				timeStandard = 'utc';
			}
			parameters = [...parameters, code];
		} else {
			parameters = parameters.filter((value) => value !== code);
		}
	}

	async function changeTemporal(value: PowerTemporal): Promise<void> {
		temporal = value;
		if (value === 'hourly' && spatial === 'regional') spatial = 'point';
		dataResult = undefined;
		regionalResponse = undefined;
		await loadTemporalResources(true);
	}

	async function changeSpatial(value: 'point' | 'regional'): Promise<void> {
		spatial = value;
		if (value === 'regional' && parameters.length > 1) parameters = parameters.slice(0, 1);
		dataResult = undefined;
		regionalResponse = undefined;
		await loadTemporalResources(true);
	}

	async function changeCommunity(value: string): Promise<void> {
		community = value;
		dataResult = undefined;
		await loadTemporalResources(true);
	}

	function requestForCurrentTemporal(): PowerTemporalRequest {
		return {
			...temporalRequest,
			latitude,
			longitude,
			parameters,
			bounds: { latitudeMin, latitudeMax, longitudeMin, longitudeMax }
		};
	}

	function downloadedName(response: Response, format: string): string {
		const header = response.headers.get('content-disposition') ?? '';
		const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
		const plain = header.match(/filename\*?=(?:"([^"]+)"|([^;]+))/i);
		const serverName = encoded ?? plain?.[1] ?? plain?.[2]?.trim();
		if (serverName) {
			try {
				return decodeURIComponent(serverName.replaceAll('"', ''));
			} catch {
				return serverName.replaceAll('"', '');
			}
		}
		const extension: Record<string, string> = {
			json: 'json',
			csv: 'csv',
			ascii: 'txt',
			netcdf: 'nc',
			icasa: 'txt',
			epw: 'epw',
			epw_csv: 'csv',
			xarray: 'json',
			sam: 'csv',
			srw: 'srw',
			xlsx: 'xlsx',
			html: 'html'
		};
		return `nasa-power-${new Date().toISOString().slice(0, 10)}.${extension[format.toLowerCase()] ?? 'dat'}`;
	}

	async function downloadResponse(url: URL, format: string, signal: AbortSignal): Promise<void> {
		const response = await fetch(url, { signal, headers: { Accept: '*/*' } });
		if (!response.ok) {
			let body: unknown;
			try {
				body = await response.json();
			} catch {
				body = undefined;
			}
			const message = powerResponseMessages(body).join(' ');
			throw new Error(
				`NASA POWER returned HTTP ${response.status}${message ? `: ${message}` : '.'}`
			);
		}
		const blob = await response.blob();
		const filename = downloadedName(response, format);
		const objectUrl = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = objectUrl;
		anchor.download = filename;
		anchor.style.display = 'none';
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
	}

	async function submitTemporalRequest(): Promise<void> {
		const request = requestForCurrentTemporal();
		const requestKey = JSON.stringify(request);
		const validation = validateTemporalWithLiveCoverage(request);
		if (!validation.valid) {
			dataResult = {
				url: '',
				format: dataFormat,
				requestKey,
				status: 'error',
				messages: [validation.error ?? 'Invalid request.']
			};
			return;
		}
		temporalRequestController?.abort();
		const controller = new AbortController();
		temporalRequestController = controller;
		activeTemporalRequestKey = requestKey;
		dataLoading = true;
		dataResult = undefined;
		regionalResponse = undefined;
		regionalPeriod = '';
		try {
			const url = buildPowerTemporalUrl(request);
			if (dataFormat.toLowerCase() !== 'json') {
				await downloadResponse(url, dataFormat, controller.signal);
				dataResult = {
					url: url.toString(),
					format: dataFormat,
					requestKey,
					status: 'success',
					messages: ['File download started.']
				};
				return;
			}
			const data = await fetchJson<PowerJsonResponse>(url, controller.signal);
			const apiError = powerJsonError(data);
			if (apiError) throw new Error(apiError);
			dataResult = {
				url: url.toString(),
				format: dataFormat,
				requestKey,
				status: 'success',
				messages: responseMessagesForUi(data.messages),
				data
			};
			if (spatial === 'regional' && Array.isArray(data.features)) {
				regionalResponse = data;
				const first = data.features[0]?.properties?.parameter?.[parameters[0]];
				const keys =
					first && typeof first === 'object' ? Object.keys(first as Record<string, unknown>) : [];
				regionalPeriod = chooseDefaultRegionalPeriod(keys, temporal);
				applyRegionalOverlay(data, regionalPeriod);
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				dataResult = {
					url: '',
					format: dataFormat,
					requestKey,
					status: 'error',
					messages: [error instanceof Error ? error.message : 'NASA POWER data request failed.']
				};
			}
		} finally {
			if (!controller.signal.aborted) dataLoading = false;
		}
	}

	function chooseDefaultRegionalPeriod(keys: string[], currentTemporal: PowerTemporal): string {
		if (!keys.length) return '';
		if (currentTemporal === 'climatology' && keys.includes('ANN')) return 'ANN';
		const validMonths = keys.filter((key) => !/^\d{4}13$/.test(key));
		return validMonths.at(-1) ?? keys.at(-1) ?? '';
	}

	function applyRegionalOverlay(response: PowerJsonResponse, key: string): void {
		const rawFeatures = response.features ?? [];
		if (!key || rawFeatures.length === 0) {
			clearPowerGridOverlay();
			return;
		}
		if (rawFeatures.length > 3000) {
			clearPowerGridOverlay();
			toast.error(
				'The regional result is too large to draw as individual grid-point markers. The downloaded/returned data is still available below.'
			);
			return;
		}
		const code = parameters[0];
		const points: PowerGridPoint[] = [];
		for (const feature of rawFeatures) {
			const coordinates = feature.geometry?.coordinates;
			const data = feature.properties?.parameter?.[code];
			if (!coordinates || coordinates.length < 2 || !data || typeof data !== 'object') continue;
			const value = (data as Record<string, unknown>)[key];
			if (!numericPowerValue(value, response.header?.fill_value)) continue;
			points.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [coordinates[0], coordinates[1]] },
				properties: {
					value,
					key,
					longitude: coordinates[0],
					latitude: coordinates[1]
				}
			});
		}
		if (!points.length) {
			clearPowerGridOverlay();
			return;
		}
		const metadata = response.parameters?.[code];
		const values = points.map((point) => point.properties.value);
		powerGridOverlay.set({
			parameter: code,
			name: String(metadata?.longname ?? metadata?.name ?? code),
			unit: String(metadata?.units ?? metadata?.units_name ?? ''),
			period: key,
			min: Math.min(...values),
			max: Math.max(...values),
			features: points
		});
		powerGridVisible.set(true);
	}

	function changeApplication(value: PowerApplication): void {
		application = value;
		applicationResult = undefined;
		if (value === 'indicators') {
			applicationStart = '2001';
			applicationEnd = '2010';
		} else if (value === 'zones') {
			applicationStart = '1984';
			applicationEnd = '1985';
		} else {
			windroseStart = '2010-01-01';
			windroseEnd = '2014-12-31';
		}
		void loadApplicationResources(true);
	}

	function changeApplicationSpatial(value: PowerApplicationSpatial): void {
		applicationSpatial = value;
		applicationResult = undefined;
		void loadApplicationResources(true);
	}

	function applicationRequest(): ReturnType<typeof buildPowerApplicationUrl> {
		return buildPowerApplicationUrl(currentApplicationOptions());
	}

	async function submitApplicationRequest(): Promise<void> {
		const request = currentApplicationOptions();
		const requestKey = JSON.stringify(request);
		const validation = validateApplicationWithLiveCoverage(request);
		if (!validation.valid) {
			applicationResult = {
				url: '',
				format: applicationFormat,
				requestKey,
				status: 'error',
				messages: [validation.error ?? 'Invalid request.']
			};
			return;
		}
		applicationLoadController?.abort();
		const controller = new AbortController();
		applicationLoadController = controller;
		activeApplicationRequestKey = requestKey;
		applicationLoading = true;
		applicationResult = undefined;
		try {
			const url = applicationRequest();
			if (applicationFormat.toLowerCase() !== 'json') {
				await downloadResponse(url, applicationFormat, controller.signal);
				applicationResult = {
					url: url.toString(),
					format: applicationFormat,
					requestKey,
					status: 'success',
					messages: ['File download started.']
				};
				return;
			}
			const data = await fetchJson<PowerJsonResponse>(url, controller.signal);
			const apiError = powerJsonError(data);
			if (apiError) throw new Error(apiError);
			applicationResult = {
				url: url.toString(),
				format: applicationFormat,
				requestKey,
				status: 'success',
				messages: responseMessagesForUi(data.messages),
				data
			};
		} catch (error) {
			if (!controller.signal.aborted) {
				applicationResult = {
					url: '',
					format: applicationFormat,
					requestKey,
					status: 'error',
					messages: [
						error instanceof Error ? error.message : 'NASA POWER application request failed.'
					]
				};
			}
		} finally {
			if (!controller.signal.aborted) applicationLoading = false;
		}
	}

	function windroseHtmlUrl(): URL | undefined {
		if (applicationLoading || !applicationValidation.valid) return undefined;
		try {
			return makePowerWindrosePlotUrl(
				latitude,
				longitude,
				windroseStart,
				windroseEnd,
				windroseTheme,
				applicationUnits,
				applicationTimeStandard,
				apiUser
			);
		} catch {
			return undefined;
		}
	}

	function rosePath(
		innerRadius: number,
		outerRadius: number,
		bearing: number,
		width: number
	): string {
		const cx = 72;
		const cy = 72;
		const angle0 = (bearing - width / 2) * (Math.PI / 180);
		const angle1 = (bearing + width / 2) * (Math.PI / 180);
		const point = (radius: number, angle: number) => [
			cx + Math.sin(angle) * radius,
			cy - Math.cos(angle) * radius
		];
		const [x0i, y0i] = point(innerRadius, angle0);
		const [x0o, y0o] = point(outerRadius, angle0);
		const [x1o, y1o] = point(outerRadius, angle1);
		const [x1i, y1i] = point(innerRadius, angle1);
		return `M${x0i},${y0i} L${x0o},${y0o} A${outerRadius},${outerRadius} 0 0 1 ${x1o},${y1o} L${x1i},${y1i} A${innerRadius},${innerRadius} 0 0 0 ${x0i},${y0i} Z`;
	}

	function maxRosePercent(): number {
		return rose ? Math.max(1, ...rose.directions.map((direction) => direction.percent)) : 1;
	}

	function classColor(index: number): string {
		const colors = [
			'#313695',
			'#4575b4',
			'#74add1',
			'#abd9e9',
			'#e0f3f8',
			'#fee090',
			'#fdae61',
			'#f46d43',
			'#d73027',
			'#7f0000'
		];
		return colors[index % colors.length];
	}

	function handleRegionalPeriodChange(value: string): void {
		regionalPeriod = value;
		if (regionalResponse) applyRegionalOverlay(regionalResponse, value);
	}

	async function selectCatalogView(value: CatalogView): Promise<void> {
		catalogView = value;
		catalogError = '';
		void loadCurrentCatalogView(true);
	}

	function selectTab(value: MainTab): void {
		activeTab = value;
		if (value === 'catalog') void loadCurrentCatalogView();
		if (value === 'applications') void loadApplicationResources();
		if (value === 'data') void loadTemporalResources();
	}

	function handleAdvancedToggle(event: Event): void {
		if ((event.currentTarget as HTMLDetailsElement).open) void loadSurfaceAliases();
	}

	async function loadManagerDetail(): Promise<void> {
		if (!selectedManagerCode) return;
		catalogLoading = true;
		catalogError = '';
		try {
			managerDetail = await fetchJson<Record<string, unknown>>(
				powerParameterDetailUrl(selectedManagerCode)
			);
		} catch (error) {
			catalogError = error instanceof Error ? error.message : 'Could not load parameter profile.';
		} finally {
			catalogLoading = false;
		}
	}

	async function copyUrl(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url);
			toast.success('NASA POWER request URL copied.');
		} catch {
			toast.error('Could not copy this URL.');
		}
	}

	function displayedSettings(config: ApiConfig | undefined): string {
		const settings = config?.settings;
		if (!settings) return '';
		const start = settings.start ? dateText(settings.start) : '';
		const end = settings.end ? dateText(settings.end) : '';
		return start && end ? `${start} through ${end}` : '';
	}

	function temporalHeaderValue(data: PowerJsonResponse, field: string): string {
		const value = data.header?.[field];
		if (Array.isArray(value)) return value.map(String).join(', ');
		return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
	}

	function temporalApiLabel(data: PowerJsonResponse): string {
		const api =
			data.header?.api && typeof data.header.api === 'object'
				? (data.header.api as Record<string, unknown>)
				: {};
		return [api.name, api.version].filter((value) => typeof value === 'string').join(' · ');
	}

	function localAccessDate(): string {
		const date = new Date();
		return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
			date.getDate()
		).padStart(2, '0')}`;
	}

	function powerCitationText(data: PowerJsonResponse, requestUrl: string): string {
		const api =
			data.header?.api && typeof data.header.api === 'object'
				? (data.header.api as Record<string, unknown>)
				: {};
		const serviceName = typeof api.name === 'string' ? api.name : `POWER ${temporal} API`;
		const version = typeof api.version === 'string' ? api.version : 'version not reported';
		const accessDate = localAccessDate();
		const responsePeriod = [
			temporalHeaderValue(data, 'start'),
			temporalHeaderValue(data, 'end')
		].filter(Boolean);
		const sources = temporalHeaderValue(data, 'sources') || 'not listed in response';
		let safeUrl = requestUrl;
		let requestContext = `Request context: ${temporal} ${spatial} · ${community} · ${parameters.join(', ')}.`;
		try {
			const url = new URL(requestUrl);
			const query = url.searchParams;
			url.searchParams.delete('user');
			safeUrl = url.toString();
			const path = url.pathname.split('/').filter(Boolean);
			const requestTemporal = path[2] ?? temporal;
			const requestSpatial = path[3] ?? spatial;
			const requestParameters = query.get('parameters') ?? parameters.join(', ');
			const requestCommunity = query.get('community') ?? community;
			const requestStart = query.get('start');
			const requestEnd = query.get('end');
			const location =
				requestSpatial === 'regional'
					? `bounds lat ${query.get('latitude-min') ?? 'not reported'}° to ${query.get('latitude-max') ?? 'not reported'}°, lon ${query.get('longitude-min') ?? 'not reported'}° to ${query.get('longitude-max') ?? 'not reported'}°`
					: `point lat ${query.get('latitude') ?? 'not reported'}°, lon ${query.get('longitude') ?? 'not reported'}°`;
			const requestDetails = [
				`${requestTemporal} ${requestSpatial}`,
				`community ${requestCommunity}`,
				`parameters ${requestParameters}`,
				requestStart && requestEnd ? `requested window ${requestStart}–${requestEnd}` : '',
				location,
				query.get('format') ? `format ${query.get('format')}` : '',
				query.get('units') ? `units ${query.get('units')}` : '',
				query.get('time-standard')
					? `time standard ${query.get('time-standard')?.toUpperCase()}`
					: ''
			].filter(Boolean);
			requestContext = `Request context: ${requestDetails.join(' · ')}.`;
		} catch {
			// Keep the request-state context if a non-URL result is passed in.
		}
		return [
			'POWER reference: The data was obtained from National Aeronautics and Space Administration (NASA) Langley Research Center’s Prediction Of Worldwide Energy Resources (POWER) project funded through the NASA Earth Science Division.',
			`POWER data reference: The data was obtained from the NASA ${serviceName} (${version}) on ${accessDate}.`,
			requestContext,
			...(responsePeriod.length === 2
				? [`NASA-reported response period: ${responsePeriod[0]}–${responsePeriod[1]}.`]
				: []),
			...(temporalHeaderValue(data, 'time_standard')
				? [`NASA-reported time standard: ${temporalHeaderValue(data, 'time_standard')}.`]
				: []),
			`NASA response source identifiers (request-level): ${sources}.`,
			`Shareable NASA POWER request URL (optional user identifier removed): ${safeUrl}`
		].join('\n');
	}

	async function copyCitation(): Promise<void> {
		if (!dataResult?.data || !dataResult.url) return;
		try {
			await navigator.clipboard.writeText(powerCitationText(dataResult.data, dataResult.url));
			toast.success('NASA POWER citation and request provenance copied.');
		} catch {
			toast.error('Could not copy the NASA POWER citation.');
		}
	}

	function drawSeriesPath(
		points: PowerSeriesPoint[],
		width: number,
		height: number,
		totalSamples: number
	): string {
		if (points.length < 2) return '';
		const values = points.map((point) => point.value);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min || 1;
		const lastIndex = Math.max(totalSamples - 1, 1);
		return points
			.map((point, index) => {
				const sampleIndex = point.sampleIndex ?? index;
				const previousIndex = points[index - 1]?.sampleIndex ?? index - 1;
				const beginsSegment = index === 0 || sampleIndex - previousIndex > 1;
				const x = (sampleIndex / lastIndex) * width;
				const y = height - ((point.value - min) / span) * height;
				return `${beginsSegment ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	onDestroy(() => {
		dataLoadController?.abort();
		temporalRequestController?.abort();
		applicationLoadController?.abort();
		catalogController?.abort();
		surfaceDetailController?.abort();
		cancelMapPick();
		unsubscribeOverlay();
		unsubscribeOverlayVisibility();
		unsubscribeMap();
		unsubscribePanelState();
		if (currentMap && styleListener) currentMap.off('styledata', styleListener);
		syncPowerGridLayer(currentMap, undefined, false);
	});
</script>

{#if panelIsOpen}
	<!-- Keep the panel anchor independent of the credit offset: attribution.ts moves credits around
	     this blocker, so using that same offset here creates a runaway position feedback loop. -->
	<aside
		transition:fly={{ y: 12, duration: 180 }}
		data-credit-blocker
		aria-label="NASA POWER data explorer"
		class="fixed right-2 z-80 flex w-[min(94vw,34rem)] flex-col overflow-hidden rounded-lg border bg-glass/95 shadow-xl backdrop-blur-md"
		style:bottom="7.5rem"
		style:max-height="min(78dvh, calc(100dvh - 9rem))"
	>
		<header class="flex items-start justify-between gap-3 border-b px-3 py-2.5">
			<div class="min-w-0">
				<h2 class="flex items-center gap-2 text-sm font-semibold"><Sun size={16} /> NASA POWER</h2>
				<p class="mt-0.5 text-[0.68rem] leading-tight opacity-65">
					Hourly, daily, monthly and climatology data plus reports, wind rose, zones and live
					metadata.
				</p>
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<a
					href={NASA_POWER_DOCS}
					target="_blank"
					rel="noreferrer"
					class="rounded p-1 opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
					aria-label="NASA POWER API documentation"><BookOpen size={16} /></a
				>
				<button
					type="button"
					onclick={() =>
						powerPanelState.update((state) => ({ ...state, open: false, pickingLocation: false }))}
					class="rounded p-1 hover:bg-black/10 dark:hover:bg-white/10"
					aria-label="Close NASA POWER explorer"><X size={16} /></button
				>
			</div>
		</header>

		<nav class="flex overflow-x-auto border-b text-[0.7rem]" aria-label="NASA POWER sections">
			{#each tabItems as item (item.id)}
				<button
					type="button"
					aria-pressed={activeTab === item.id}
					onclick={() => selectTab(item.id)}
					class="shrink-0 px-3 py-2 {activeTab === item.id
						? 'border-b-2 border-sky-500 font-semibold'
						: 'opacity-65 hover:opacity-100'}">{item.label}</button
				>
			{/each}
		</nav>

		{#if $powerPanelState.pickingLocation}
			<div
				class="flex items-center justify-between gap-2 border-b bg-sky-500/10 px-3 py-2 text-xs"
				role="status"
			>
				<span class="flex items-center gap-1.5"
					><MousePointer2 size={14} /> Click the map to set the POWER point.</span
				>
				<button class="rounded px-2 py-1 underline" onclick={cancelMapPick}>Cancel</button>
			</div>
		{:else if mapPickMessage}
			<div class="border-b px-3 py-1.5 text-[0.68rem] opacity-70" role="status">
				{mapPickMessage}
			</div>
		{/if}

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if activeTab === 'data'}
				<div class="space-y-3 p-3">
					<section
						class="rounded-lg border border-sky-500/25 bg-sky-500/[0.045] px-2.5 py-2 text-[0.67rem] leading-snug"
					>
						<div class="flex items-start justify-between gap-2">
							<div>
								<h2 class="font-semibold">
									Research with grid estimates, not station observations
								</h2>
								<p class="mt-0.5 opacity-75">
									A point coordinate does not create finer source resolution. This panel will show
									NASA's response sources, returned units and valid/fill counts after each fetch.
								</p>
							</div>
							<span
								class="shrink-0 rounded-full border px-1.5 py-0.5 text-[0.58rem] font-medium opacity-70"
								>NASA POWER</span
							>
						</div>
						<details class="mt-1.5 rounded border border-sky-500/15 px-2 py-1.5">
							<summary class="cursor-pointer font-medium"
								>Method notes & responsible interpretation</summary
							>
							<ul class="mt-1 list-disc space-y-1 pl-4 opacity-75">
								<li>
									POWER values are source-grid estimates, not local station measurements. Native
									resolution is parameter/source-specific; NASA documents common grids of 1° CERES
									SYN1deg, 0.5° × 0.625° MERRA-2/GEOS-IT and 0.1° × 0.1° IMERG. The response source
									list and parameter definition determine which context applies.
								</li>
								<li>
									The live date window is service-wide, not a promise that every parameter has
									complete values. NASA's <code>fill_value</code> is excluded from charts; valid and missing
									samples are counted below. HTTP 200 alone does not mean usable data.
								</li>
								<li>
									LST applies to Hourly and Daily only: a 15° solar-time band, not civil time.
									Monthly and Climatology use UTC. NASA POWER serves IMERG products daily in UTC
									only.
								</li>
								<li>
									For climate trends, check upstream source transitions and near-real-time
									revisions. NASA recommends a 2-month NRT cutoff for meteorology and 3.5 months for
									IMERG precipitation; it discourages energy-flux trend analysis across source
									changes.
								</li>
								<li>
									There is no single accuracy number for every parameter/site/period. NASA publishes
									parameter-specific comparison methods; do not treat a grid value as guaranteed
									site accuracy.
								</li>
								<li>
									Avoid unnecessary rapid or repeated API calls: NASA documents HTTP 429 and
									possible blocking for excessive synchronous use, but no fixed per-minute quota.
									Use the separate bulk archive for large extractions.
								</li>
							</ul>
							<div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t pt-1.5">
								<a
									class="underline"
									href="https://power.larc.nasa.gov/docs/methodology/data/sources/"
									target="_blank"
									rel="noreferrer">NASA data sources & latency</a
								>
								<a
									class="underline"
									href="https://power.larc.nasa.gov/docs/faqs/data/"
									target="_blank"
									rel="noreferrer">Data, units & quality FAQ</a
								>
								<a
									class="underline"
									href="https://power.larc.nasa.gov/docs/methodology/"
									target="_blank"
									rel="noreferrer">Methodology & validation</a
								>
								<a
									class="underline"
									href="https://power.larc.nasa.gov/docs/referencing/"
									target="_blank"
									rel="noreferrer">NASA citing guide</a
								>
							</div>
						</details>
					</section>
					<div class="grid grid-cols-2 gap-2">
						<label class="block">
							<span class="text-[0.67rem] opacity-70">Temporal API</span>
							<select
								class="mt-0.5 w-full rounded border bg-transparent px-2 py-1.5 text-xs"
								value={temporal}
								onchange={(event) =>
									void changeTemporal(event.currentTarget.value as PowerTemporal)}
							>
								{#each POWER_TEMPORALS as option (option)}
									<option value={option}>{option[0].toUpperCase()}{option.slice(1)}</option>
								{/each}
							</select>
						</label>
						<label class="block">
							<span class="text-[0.67rem] opacity-70">Spatial API</span>
							<select
								class="mt-0.5 w-full rounded border bg-transparent px-2 py-1.5 text-xs"
								value={spatial}
								onchange={(event) =>
									void changeSpatial(event.currentTarget.value as 'point' | 'regional')}
							>
								<option value="point">Point</option>
								<option value="regional" disabled={temporal === 'hourly'}
									>Regional (≥2° bbox)</option
								>
							</select>
						</label>
					</div>

					<label class="block">
						<span class="text-[0.67rem] opacity-70">POWER community</span>
						<select
							class="mt-0.5 w-full rounded border bg-transparent px-2 py-1.5 text-xs"
							value={community}
							onchange={(event) => void changeCommunity(event.currentTarget.value)}
						>
							{#each availableCommunities as option (option)}
								<option value={option}
									>{option} · {communities[option as PowerCommunity] ?? option}</option
								>
							{/each}
						</select>
					</label>

					<div class="rounded border px-2 py-1.5 text-[0.66rem] leading-snug">
						<div class="flex items-center justify-between gap-2">
							<span class="font-medium">Parameters</span>
							<span class="opacity-60"
								>{parameters.length}/{selectedLimit} · {selectedLimitLabel}</span
							>
						</div>
						{#if parameters.length}
							<div class="mt-1 flex flex-wrap gap-1">
								{#each parameters as code (code)}
									<button
										type="button"
										title={parameterCatalog[code]?.definition ?? code}
										onclick={() => toggleParameter(code, false)}
										class="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[0.64rem] hover:bg-red-500/15"
										>{code} <span aria-hidden="true">×</span></button
									>
								{/each}
							</div>
						{/if}
						<label class="mt-1.5 flex items-center gap-1 rounded border px-1.5">
							<Search size={13} class="shrink-0 opacity-50" />
							<input
								class="min-w-0 flex-1 bg-transparent py-1 outline-none"
								placeholder="Search parameter code or name"
								aria-label="Search NASA POWER parameters"
								bind:value={parameterSearch}
							/>
						</label>
						{#if parameterCatalogLoading}
							<p class="py-2 opacity-60">Loading parameter metadata…</p>
						{:else if parameterCatalogError}
							<p class="py-2 text-red-700 dark:text-red-300">{parameterCatalogError}</p>
						{:else}
							<div class="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
								{#each filteredParameters.slice(0, 80) as [code, metadata] (code)}
									<label
										class="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-black/5 dark:hover:bg-white/5"
									>
										<input
											type="checkbox"
											checked={parameters.includes(code)}
											disabled={!parameters.includes(code) && parameters.length >= selectedLimit}
											onchange={(event) => toggleParameter(code, event.currentTarget.checked)}
											class="mt-0.5 accent-sky-500"
										/>
										<span class="min-w-0 flex-1">
											<span class="font-mono font-semibold">{code}</span>
											<span class="ml-1 opacity-70">{metadata.name ?? code}</span>
											{#if metadata.units}<span
													class="ml-1 opacity-50"
													title="NASA Manager catalog unit; the API result may convert this to the requested units."
													>({metadata.units})</span
												>{/if}
										</span>
									</label>
								{:else}
									<p class="px-1 py-2 opacity-55">No parameters match that search.</p>
								{/each}
							</div>
							<p class="mt-1 opacity-55">
								Showing {Math.min(filteredParameters.length, 80)} of {filteredParameters.length.toLocaleString()}
								matches. Metadata is served live by NASA POWER Manager; units here are catalog defaults,
								while result units come from the response.
							</p>
						{/if}
						{#if parameters.length && !parameterCatalogLoading}
							<details class="mt-2 rounded border px-2 py-1.5">
								<summary class="cursor-pointer font-medium"
									>Selected parameter definitions · live NASA Manager</summary
								>
								<div class="mt-1.5 space-y-2">
									{#each parameters as code (code)}
										{@const metadata = parameterCatalog[code]}
										<div class="border-t pt-1.5 first:border-0 first:pt-0">
											<p><code class="font-semibold">{code}</code> · {metadata?.name ?? code}</p>
											<p class="mt-0.5 opacity-70">
												{metadata?.definition ?? 'NASA Manager did not return a definition.'}
											</p>
											<p class="mt-0.5 opacity-55">
												Catalog type: {metadata?.type ?? 'not reported'} · catalog unit: {metadata?.units ??
													'not reported'}
												{#if metadata?.source === 'SOURCE'}
													· Manager source tag <code>SOURCE</code> is generic, not a dataset identifier.{:else if metadata?.source}
													· Manager source tag: <code>{metadata.source}</code>{/if}
											</p>
										</div>
									{/each}
								</div>
								<p class="mt-1.5 border-t pt-1.5 opacity-55">
									The Manager catalog is useful for definitions and default units, but its service
									window is not per-parameter completeness. Check the actual response source IDs,
									units and valid-value counts below.
									<a
										class="ml-1 underline"
										href="https://power.larc.nasa.gov/docs/services/api/system/manager/"
										target="_blank"
										rel="noreferrer">Manager documentation</a
									>
								</p>
							</details>
						{/if}
					</div>

					{#if selectedImergParameters.length && temporal === 'daily'}
						<div
							class="rounded border border-amber-500/35 bg-amber-500/[0.08] px-2.5 py-2 text-[0.65rem] leading-snug"
							role="note"
						>
							<strong>IMERG constraint applied: Daily · UTC only.</strong>
							<span class="block mt-0.5 opacity-80">
								NASA documents IMERG at 0.1° × 0.1° (about 10 km), daily and UTC only. LST is
								disabled for this selection. Near-real-time values may mix Late and Final runs; NASA
								recommends ending climate-trend analyses at least 3.5 months before NRT.
							</span>
							<a
								class="mt-1 inline-flex underline"
								href="https://power.larc.nasa.gov/docs/methodology/data/sources/"
								target="_blank"
								rel="noreferrer">Read NASA's IMERG source & latency notes</a
							>
						</div>
					{/if}

					{#if spatial === 'point'}
						<div class="space-y-1.5 rounded border px-2 py-1.5">
							<div class="flex items-center justify-between gap-1">
								<span class="text-[0.67rem] font-medium">Point location</span>
								<div class="flex gap-1">
									<button
										type="button"
										title="Use map centre"
										aria-label="Use map centre"
										onclick={setCoordinatesFromMap}
										class="rounded border p-1 hover:bg-black/5 dark:hover:bg-white/10"
										><MapPin size={13} /></button
									>
									<button
										type="button"
										title="Pick a point from the map"
										aria-label="Pick a point from the map"
										onclick={startMapPick}
										class="rounded border p-1 hover:bg-black/5 dark:hover:bg-white/10"
										><MousePointer2 size={13} /></button
									>
								</div>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<label class="block"
									><span class="text-[0.62rem] opacity-60">Latitude</span><input
										aria-label="POWER latitude"
										type="number"
										min="-90"
										max="90"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={latitude}
									/></label
								>
								<label class="block"
									><span class="text-[0.62rem] opacity-60">Longitude</span><input
										aria-label="POWER longitude"
										type="number"
										min="-180"
										max="180"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={longitude}
									/></label
								>
							</div>
						</div>
					{:else}
						<div class="space-y-1.5 rounded border px-2 py-1.5">
							<div class="flex items-center justify-between gap-1">
								<span class="text-[0.67rem] font-medium">Regional bounding box</span>
								<button
									type="button"
									onclick={() => setBoundsFromMap()}
									class="rounded border px-1.5 py-1 text-[0.62rem] hover:bg-black/5 dark:hover:bg-white/10"
									>Use map view</button
								>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<label
									><span class="text-[0.62rem] opacity-60">Latitude min</span><input
										aria-label="Regional latitude minimum"
										type="number"
										min="-90"
										max="90"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={latitudeMin}
									/></label
								>
								<label
									><span class="text-[0.62rem] opacity-60">Latitude max</span><input
										aria-label="Regional latitude maximum"
										type="number"
										min="-90"
										max="90"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={latitudeMax}
									/></label
								>
								<label
									><span class="text-[0.62rem] opacity-60">Longitude min</span><input
										aria-label="Regional longitude minimum"
										type="number"
										min="-180"
										max="180"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={longitudeMin}
									/></label
								>
								<label
									><span class="text-[0.62rem] opacity-60">Longitude max</span><input
										aria-label="Regional longitude maximum"
										type="number"
										min="-180"
										max="180"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={longitudeMax}
									/></label
								>
							</div>
							<p class="text-[0.62rem] leading-tight text-amber-800 dark:text-amber-200">
								POWER requires at least 2° in both directions for a regional request and accepts one
								parameter only. Large regions may take longer.
							</p>
						</div>
					{/if}

					{#if temporal === 'hourly' || temporal === 'daily'}
						<div class="grid grid-cols-2 gap-2">
							<label
								><span class="text-[0.67rem] opacity-70">Start date</span><input
									aria-label="NASA POWER start date"
									type="date"
									min={coverageBoundary(temporalConfig, 'start', 'date')}
									max={coverageBoundary(temporalConfig, 'end', 'date')}
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={dataStart}
								/></label
							>
							<label
								><span class="text-[0.67rem] opacity-70">End date</span><input
									aria-label="NASA POWER end date"
									type="date"
									min={coverageBoundary(temporalConfig, 'start', 'date')}
									max={coverageBoundary(temporalConfig, 'end', 'date')}
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={dataEnd}
								/></label
							>
						</div>
					{:else if temporal === 'monthly'}
						<div class="grid grid-cols-2 gap-2">
							<label
								><span class="text-[0.67rem] opacity-70">Start year</span><input
									aria-label="NASA POWER start year"
									type="number"
									min={coverageBoundary(temporalConfig, 'start', 'year') ?? '1981'}
									max={coverageBoundary(temporalConfig, 'end', 'year')}
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={monthlyStart}
								/></label
							>
							<label
								><span class="text-[0.67rem] opacity-70">End year</span><input
									aria-label="NASA POWER end year"
									type="number"
									min={coverageBoundary(temporalConfig, 'start', 'year') ?? '1981'}
									max={coverageBoundary(temporalConfig, 'end', 'year')}
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={monthlyEnd}
								/></label
							>
						</div>
						<p class="-mt-2 text-[0.62rem] opacity-55">
							Monthly API also returns an annual value keyed as month 13; it is not a thirteenth
							calendar month.
						</p>
					{:else}
						<label class="flex items-start gap-2 rounded border px-2 py-1.5 text-[0.68rem]">
							<input
								type="checkbox"
								class="mt-0.5 accent-sky-500"
								bind:checked={customClimatology}
							/>
							<span
								><strong>Custom climatology period</strong><span class="block opacity-60"
									>Off uses NASA's precomputed normal. Custom periods need at least two years and
									must fit live coverage.</span
								></span
							>
						</label>
						{#if customClimatology}
							<div class="grid grid-cols-2 gap-2">
								<label
									><span class="text-[0.67rem] opacity-70">Start year</span><input
										type="number"
										min={coverageBoundary(temporalConfig, 'start', 'year') ?? '1981'}
										max={coverageBoundary(temporalConfig, 'end', 'year')}
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={climatologyStart}
									/></label
								>
								<label
									><span class="text-[0.67rem] opacity-70">End year</span><input
										type="number"
										min={coverageBoundary(temporalConfig, 'start', 'year') ?? '1981'}
										max={coverageBoundary(temporalConfig, 'end', 'year')}
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={climatologyEnd}
									/></label
								>
							</div>
						{/if}
					{/if}

					<div
						class={specializedHourlyFormat ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-2'}
					>
						<label class="block"
							><span class="text-[0.67rem] opacity-70">Format</span><select
								class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1.5 text-xs"
								bind:value={dataFormat}
								>{#each dataFormats as format (format)}<option value={format.toLowerCase()}
										>{niceFormat(format)}</option
									>{/each}</select
							></label
						>
						{#if !specializedHourlyFormat}<label class="block"
								><span class="text-[0.67rem] opacity-70">Units</span><select
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1.5 text-xs"
									bind:value={dataUnits}
									><option value="metric">Metric</option><option value="imperial">Imperial</option
									></select
								></label
							>{/if}
					</div>

					{#if !specializedHourlyFormat && (temporal === 'hourly' || temporal === 'daily')}
						<label class="block"
							><span class="text-[0.67rem] opacity-70">Time standard</span><select
								class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1.5 text-xs"
								value={effectiveTimeStandard}
								onchange={(event) => (timeStandard = event.currentTarget.value as 'lst' | 'utc')}
								><option
									value="lst"
									disabled={temporal === 'daily' && selectedImergParameters.length > 0}
									>LST · Local Solar Time</option
								><option value="utc">UTC</option></select
							></label
						>
						<p class="-mt-2 text-[0.62rem] leading-tight opacity-55">
							{#if temporal === 'hourly'}NASA hourly timestamps mark the start of each hour.
							{/if}
							LST is a 15° longitude-band solar time, not civil time. Monthly and Climatology use UTC;
							Daily IMERG is UTC only.
						</p>
					{/if}
					{#if specializedHourlyFormat}
						<p class="rounded border bg-amber-500/10 px-2 py-1.5 text-[0.64rem] leading-snug">
							<strong>{dataFormat.toUpperCase()} is a specialized fixed-schema file.</strong>
							NASA's returned columns do not follow the selected parameter list. SAM returns its fixed
							CSV with LT labeling and ignores unit/time options. SRW is UTC regardless of time-standard;
							NASA changes SRW numbers for imperial units but leaves metric unit labels, so this UI omits
							`units` and keeps a correctly labeled metric file. SRW also requires a January 1 start and
							December 31 end.
						</p>
					{:else if temporal === 'daily' && dataFormat.toLowerCase() === 'icasa'}
						<p class="rounded border bg-sky-500/10 px-2 py-1.5 text-[0.64rem] leading-snug">
							NASA's ICASA export is available only for AG; POWER fills required variables in the
							file. Monthly amplitude is included only when the requested interval covers at least
							two months.
						</p>
					{/if}

					<details
						class="rounded border px-2 py-1.5 text-[0.68rem]"
						bind:open={showAdvanced}
						ontoggle={handleAdvancedToggle}
					>
						<summary class="flex cursor-pointer list-none items-center justify-between font-medium"
							>Advanced API options <ChevronDown size={14} /></summary
						>
						<div class="mt-2 space-y-2">
							{#if dataFormat.toLowerCase() === 'csv' || dataFormat.toLowerCase() === 'ascii'}
								<label class="flex items-center gap-2"
									><input type="checkbox" class="accent-sky-500" bind:checked={includeHeader} /> Include
									NASA file header</label
								>
							{/if}
							{#if spatial === 'point'}
								<label class="block"
									><span class="text-[0.65rem] opacity-65"
										>Site elevation (m), for corrected pressure</span
									><input
										type="number"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={siteElevation}
									/></label
								>
								<div class="grid grid-cols-2 gap-2">
									<label class="block"
										><span class="text-[0.65rem] opacity-65">Wind elevation (10–300 m)</span><input
											type="number"
											min="10"
											max="300"
											step="any"
											class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
											bind:value={windElevation}
										/></label
									>
									<label class="block"
										><span class="text-[0.65rem] opacity-65">Custom wind surface</span><select
											class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
											bind:value={windSurface}
											><option value="">Default surface</option
											>{#each Object.entries(surfaces) as [alias, item] (alias)}<option
													value={alias}>{alias} · {String(item.Long_Name ?? '')}</option
												>{/each}</select
										></label
									>
								</div>
								{#if surfaceAliasLoading}<p class="text-[0.61rem] opacity-55">
										Loading live POWER surface aliases…
									</p>{:else if surfaceAliasError}<p
										class="text-[0.61rem] text-amber-800 dark:text-amber-200"
									>
										{surfaceAliasError}
									</p>{/if}
								{#if windSurface && !windElevation}<p class="text-amber-800 dark:text-amber-200">
										A custom surface requires a wind-elevation value.
									</p>{/if}
							{/if}
							<label class="block">
								<span class="text-[0.65rem] opacity-65">Optional API user identifier</span>
								<input
									type="text"
									autocomplete="off"
									pattern="[A-Za-z0-9]*"
									title="Use letters and numbers only."
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={apiUser}
									placeholder="Letters and numbers only"
								/>
							</label>
							<p class="text-[0.6rem] opacity-50">
								Sent as NASA's optional <code>user</code> query parameter; use letters and numbers only.
								It is not an account name or authentication token.
							</p>
						</div>
					</details>

					{#if temporalConfig?.documentation?.version}
						<p class="text-[0.62rem] opacity-50">
							{temporalConfig.documentation.title} · {temporalConfig.documentation
								.version}{#if displayedSettings(temporalConfig)}
								· service date window (not per-parameter completeness): {displayedSettings(
									temporalConfig
								)}{/if}
						</p>
					{/if}

					{#if dataResult?.status === 'error'}
						<div
							class="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[0.7rem] text-red-800 dark:text-red-200"
							role="alert"
						>
							{dataResult.messages.join(' ')}
						</div>
					{/if}
					{#if dataResult?.status === 'success' && dataResult.messages.length}
						<div
							class="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[0.7rem]"
							role="status"
						>
							{dataResult.messages.join(' ')}
						</div>
					{/if}

					<div class="flex gap-2">
						<button
							type="button"
							disabled={dataLoading ||
								parameterCatalogLoading ||
								!Object.keys(parameterCatalog).length ||
								!temporalValidation.valid}
							onclick={() => void submitTemporalRequest()}
							class="flex flex-1 items-center justify-center gap-1.5 rounded bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
							>{#if dataLoading}<span class="animate-pulse">Requesting NASA POWER…</span
								>{:else if dataFormat.toLowerCase() === 'json'}Fetch POWER data{:else}<CloudDownload
									size={14}
								/> Download {niceFormat(dataFormat)}{/if}</button
						>
						<button
							type="button"
							title="Copy exact request URL"
							aria-label="Copy exact NASA POWER request URL"
							disabled={parameterCatalogLoading ||
								!Object.keys(parameterCatalog).length ||
								!temporalValidation.valid}
							onclick={() => {
								try {
									void copyUrl(buildPowerTemporalUrl(requestForCurrentTemporal()).toString());
								} catch (error) {
									toast.error(error instanceof Error ? error.message : 'Invalid POWER request.');
								}
							}}
							class="rounded border px-2 hover:bg-black/5 dark:hover:bg-white/10"
							><Copy size={14} /></button
						>
					</div>
					{#if !temporalValidation.valid}<p
							class="text-[0.67rem] text-amber-800 dark:text-amber-200"
						>
							{temporalValidation.error}
						</p>{/if}

					{#if dataResult?.status === 'success' && dataResult.data}
						<section
							class="space-y-2 border-t pt-2"
							aria-label="NASA POWER temporal result"
							aria-live="polite"
						>
							<div
								class="flex items-start justify-between gap-2 rounded-lg border bg-black/[0.02] px-2 py-1.5 dark:bg-white/[0.025]"
							>
								<div class="min-w-0">
									<h3 class="text-xs font-semibold">
										{temporalConfig?.documentation?.title ?? 'NASA POWER result'}
									</h3>
									<p class="text-[0.64rem] opacity-55">
										{temporalHeaderValue(dataResult.data, 'title')}
									</p>
									<p class="mt-0.5 text-[0.62rem] opacity-65">
										{temporalApiLabel(dataResult.data) || 'API version not reported'}
									</p>
								</div>
								<div class="flex shrink-0 flex-wrap justify-end gap-1">
									<button
										type="button"
										class="rounded border px-1.5 py-1 text-[0.62rem]"
										title="Copy exact NASA request URL"
										aria-label="Copy exact NASA POWER request URL"
										onclick={() => void copyUrl(dataResult?.url ?? '')}
										><Copy size={12} class="inline" /> Copy URL</button
									>
									<button
										type="button"
										class="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-1 text-[0.62rem] font-medium"
										title="Copy NASA's recommended reference and response provenance"
										aria-label="Copy NASA POWER citation"
										onclick={() => void copyCitation()}
										><Copy size={12} class="inline" /> Copy citation</button
									>
								</div>
							</div>

							<div class="space-y-1 rounded-lg border px-2 py-1.5 text-[0.64rem]">
								<div class="flex flex-wrap items-center gap-1.5">
									<strong>NASA response source IDs</strong>
									{#if responseSourceIdentifiers.length}
										{#each responseSourceIdentifiers as source (source)}<span
												class="rounded-full bg-sky-500/10 px-1.5 py-0.5 font-mono">{source}</span
											>{/each}
									{:else}<span
											class="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-900 dark:text-amber-100"
											>none reported</span
										>{/if}
								</div>
								{#if parameters.length > 1 && responseSourceIdentifiers.length}
									<p class="opacity-60">
										The <code>header.sources</code> list applies to this whole response; NASA does not
										map each source ID to an individual parameter here.
									</p>
								{/if}
								{#each responseResolutionNotes as note (note)}<p class="opacity-75">
										{note}
									</p>{/each}
								{#if selectedImergParameters.length || responseHasImerg}
									<p class="rounded bg-amber-500/[0.08] px-1.5 py-1">
										IMERG trend caution: NASA says recent daily series may mix Late and Final runs;
										end climate-trend analysis at least 3.5 months before NRT.
									</p>
								{:else if responseHasGeosIt}
									<p class="rounded bg-amber-500/[0.08] px-1.5 py-1">
										Meteorology trend caution: this response reports near-real-time GEOS-IT. NASA
										recommends ending climate-trend analysis at least 2 months before NRT.{#if responseHasBothMeteorologySources}
											This response also reports MERRA-2; verify the source transition for the
											requested period.{/if}
									</p>
								{/if}
								{#if responseHasEnergyFluxSource}
									<p class="rounded bg-amber-500/[0.08] px-1.5 py-1">
										Energy-flux series may span SRB, CERES and FLASHFlux products; NASA advises
										against climate-trend analysis across a source-data change.
									</p>
								{/if}
								<p class="border-t pt-1 opacity-60">
									No universal error bar is inferred here. NASA's accuracy evaluations are
									parameter-specific; validate against appropriate local observations when
									site-level accuracy matters.
								</p>
							</div>

							{#if spatial === 'point'}
								<div
									class="grid gap-1.5 rounded-lg border border-sky-500/20 bg-sky-500/[0.035] px-2 py-1.5 text-[0.64rem] sm:grid-cols-2"
								>
									<div>
										<p class="font-medium">Selected request point</p>
										<p class="font-mono opacity-75">lat {latitude}° · lon {longitude}°</p>
									</div>
									{#if dataResult.data.geometry?.coordinates}
										<div>
											<p class="font-medium">NASA-reported point geometry</p>
											<p class="font-mono opacity-75">
												lon {dataResult.data.geometry.coordinates[0]}° · lat {dataResult.data
													.geometry
													.coordinates[1]}°{#if dataResult.data.geometry.coordinates[2] !== undefined}<br
													/>elevation {dataResult.data.geometry.coordinates[2]} m (NASA-reported){/if}
											</p>
										</div>
									{/if}
									<p class="col-span-full opacity-70">
										The point-response geometry is not a verified grid-cell centre. POWER values
										represent source-grid estimates; complex-terrain grid elevation can differ from
										a local site.
									</p>
								</div>
							{:else}
								<div class="rounded-lg border px-2 py-1.5 text-[0.64rem]">
									<p class="font-medium">Regional request bounds · API-returned locations</p>
									<p class="font-mono opacity-75">
										lat {latitudeMin}° to {latitudeMax}° · lon {longitudeMin}° to {longitudeMax}°
									</p>
									<p class="mt-0.5 opacity-65">
										NASA GeoJSON feature coordinates are displayed as sample-point markers, not a
										continuous or interpolated raster. Spacing depends on source.
									</p>
								</div>
							{/if}

							{#if temporalHeaderValue(dataResult.data, 'time_standard')}
								<p class="text-[0.64rem] opacity-60">
									NASA time standard: <strong
										>{temporalHeaderValue(dataResult.data, 'time_standard')}</strong
									>. LST is solar time, not local civil time.
								</p>
							{/if}
							{#if responseHasAllFill}
								<div
									class="rounded border border-red-500/35 bg-red-500/[0.08] px-2 py-1.5 text-[0.67rem] text-red-900 dark:text-red-100"
									role="alert"
								>
									<strong>No valid parameter values were returned.</strong> NASA may return HTTP 200
									with only fill values or empty series. Check the selected date range, source
									availability and reported fill value ({temporalHeaderValue(
										dataResult.data,
										'fill_value'
									) || 'not provided'}).
								</div>
							{/if}
							<details class="rounded-lg border px-2 py-1.5 text-[0.64rem]">
								<summary class="cursor-pointer font-medium"
									>Citation preview & complete request context</summary
								>
								<pre
									class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{powerCitationText(
										dataResult.data,
										dataResult.url
									)}</pre>
								<a
									class="mt-1 inline-flex items-center gap-1 underline"
									href="https://power.larc.nasa.gov/docs/referencing/"
									target="_blank"
									rel="noreferrer"><ExternalLink size={11} /> NASA POWER referencing guide</a
								>
							</details>
							{#if dataSeries.length}
								{#each dataSeries as series (series.code)}
									<article class="rounded-lg border px-2.5 py-2">
										<div class="flex items-start justify-between gap-2">
											<div class="min-w-0">
												<h4 class="truncate text-[0.72rem] font-semibold">
													{series.name} <span class="font-mono opacity-55">{series.code}</span>
												</h4>
												<p class="text-[0.63rem] opacity-65">
													NASA-reported unit: <strong>{series.unit || 'not returned'}</strong>
													{#if series.annualValue !== undefined}
														· annual {series.annualValue}{series.unit ? ` ${series.unit}` : ''}{/if}
												</p>
											</div>
											<span
												class="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[0.62rem] font-medium"
											>
												{series.validCount}/{series.sampleCount} valid
											</span>
										</div>
										<div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.62rem] opacity-65">
											<span
												>{series.missingCount} fill/missing sample{series.missingCount === 1
													? ''
													: 's'}</span
											>
											{#if series.points.length}<span
													>valid keys {series.points[0].label}–{series.points[
														series.points.length - 1
													].label}</span
												>{/if}
										</div>
										{#if series.missingCount > 0}
											<p class="mt-1 text-[0.62rem] text-amber-900 dark:text-amber-100">
												NASA fill value {temporalHeaderValue(dataResult.data, 'fill_value') ||
													'not reported'} and other non-numeric values are omitted; chart segments break
												at missing keys.
											</p>
										{/if}
										{#if series.points.length > 1}
											<svg
												viewBox="0 0 280 52"
												class="mt-1 h-12 w-full"
												role="img"
												aria-label={`${series.name} time series; ${series.validCount} valid samples out of ${series.sampleCount}; missing keys create gaps`}
												><path
													d={drawSeriesPath(series.points, 280, 45, series.sampleCount)}
													fill="none"
													stroke="currentColor"
													stroke-width="1.6"
													vector-effect="non-scaling-stroke"
													class="text-sky-600 dark:text-sky-400"
												/></svg
											>
										{/if}
										{#if series.points.length === 0 && series.annualValue === undefined}
											<p
												class="mt-1 rounded bg-red-500/[0.08] px-1.5 py-1 text-[0.63rem]"
												role="note"
											>
												No valid samples in this response window. Review NASA source IDs, dates and
												fill metadata before interpreting the request as a successful dataset.
											</p>
										{:else if series.points.length === 0}
											<p class="mt-1 text-[0.62rem] opacity-70">
												NASA returned an annual aggregate, but no valid individual time keys for
												this window.
											</p>
										{/if}
										<div class="max-h-28 overflow-auto">
											<table class="w-full text-[0.62rem]">
												<thead
													><tr class="opacity-55"
														><th class="py-0.5 text-left font-normal">Time key</th><th
															class="py-0.5 text-right font-normal">NASA value</th
														></tr
													></thead
												><tbody
													>{#each series.points.slice(-8) as point (point.key)}<tr
															class="border-t border-black/5 dark:border-white/5"
															><td class="py-0.5">{point.label}</td><td
																class="py-0.5 text-right tabular-nums"
																>{point.value}{series.unit ? ` ${series.unit}` : ''}</td
															></tr
														>{/each}</tbody
												>
											</table>
										</div>
									</article>
								{/each}
							{:else if spatial === 'regional' && regionalFeatures.length}
								<div class="rounded-lg border px-2.5 py-2">
									<div class="flex items-center justify-between gap-2">
										<h4 class="text-[0.7rem] font-semibold">
											NASA returned {regionalFeatures.length.toLocaleString()} sample locations
										</h4>
										<label class="flex items-center gap-1 text-[0.62rem]">
											<input
												type="checkbox"
												class="accent-sky-500"
												bind:checked={$powerGridVisible}
											/> Show on map
										</label>
									</div>
									<p class="mt-0.5 text-[0.62rem] opacity-65">
										NASA feature coordinates are plotted as sample-point markers, not interpolated
										pixels or a continuous raster. Source and parameter determine spacing.
									</p>
									{#if regionalPeriod}
										<p class="mt-1 text-[0.63rem]">
											Map slice <code>{regionalPeriod}</code>:
											<strong>{regionalQuality.validCount}/{regionalQuality.sampleCount}</strong>
											valid locations · {regionalQuality.missingCount} fill/missing.
										</p>
										{#if regionalQuality.sampleCount > 0 && regionalQuality.validCount === 0}
											<p
												class="mt-1 rounded bg-red-500/[0.08] px-1.5 py-1 text-[0.63rem]"
												role="alert"
											>
												All returned locations are missing/fill for this slice; no values are drawn
												on the map. NASA fill value: {temporalHeaderValue(
													dataResult.data,
													'fill_value'
												) || 'not reported'}.
											</p>
										{/if}
									{/if}
									{#if regionalPeriodOptions.length}
										<label class="mt-1 flex items-center gap-1 text-[0.64rem]"
											>Map time slice <select
												class="min-w-0 flex-1 rounded border bg-transparent px-1 py-0.5"
												value={regionalPeriod}
												onchange={(event) => handleRegionalPeriodChange(event.currentTarget.value)}
												>{#each regionalPeriodOptions as key (key)}<option value={key}>{key}</option
													>{/each}</select
											></label
										>
									{/if}
									{#if $powerGridOverlay}<p class="mt-1 text-[0.62rem] opacity-60">
											{$powerGridOverlay.name} · {$powerGridOverlay.min.toFixed(
												2
											)}–{$powerGridOverlay.max.toFixed(2)}
											{$powerGridOverlay.unit}
										</p>{/if}
									{#if $powerGridOverlay}
										<div
											class="mt-1 flex items-center justify-between gap-1 text-[0.6rem] opacity-65"
											aria-label="Map value range legend"
										>
											<span>Low · {$powerGridOverlay.min.toFixed(2)} {$powerGridOverlay.unit}</span>
											<div
												class="h-2 flex-1 rounded"
												style="background:linear-gradient(90deg,#440154,#3b528b,#21918c,#5ec962,#fde725)"
											></div>
											<span>High · {$powerGridOverlay.max.toFixed(2)} {$powerGridOverlay.unit}</span
											>
										</div>
										<button
											type="button"
											class="mt-1 rounded border px-1.5 py-1 text-[0.62rem] hover:bg-black/5 dark:hover:bg-white/10"
											onclick={clearPowerGridOverlay}
											><Layers3 size={12} class="inline" /> Clear map layer</button
										>
									{/if}
								</div>
							{/if}
							{#if !dataSeries.length && spatial === 'regional' && !regionalFeatures.length}
								<p class="rounded border px-2 py-1.5 text-[0.66rem] opacity-75" role="note">
									NASA returned no regional GeoJSON features. Check dates, parameter and source
									availability; service-wide date bounds do not guarantee parameter-level
									completeness.
								</p>
							{:else if !dataSeries.length && spatial === 'point'}
								<p class="rounded border px-2 py-1.5 text-[0.66rem] opacity-75" role="note">
									NASA returned no time-series parameter object. Open the exact request URL or
									inspect the raw response to diagnose the service response.
								</p>
							{/if}
							{#if regionalFeatures.length <= 500}
								<details class="rounded border px-2 py-1 text-[0.62rem]">
									<summary class="cursor-pointer">Raw NASA POWER JSON</summary>
									<pre
										class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(
											dataResult.data,
											null,
											2
										)}</pre>
								</details>
							{:else}
								<div
									class="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-[0.62rem]"
								>
									<span
										>Large regional response ({regionalFeatures.length.toLocaleString()} sample locations);
										open the direct NASA JSON URL to inspect all features.</span
									>
									<a
										href={dataResult.url}
										target="_blank"
										rel="noreferrer"
										class="shrink-0 underline"
										>Open JSON <ExternalLink size={11} class="inline" /></a
									>
								</div>
							{/if}
						</section>
					{/if}
				</div>
			{:else if activeTab === 'applications'}
				<div class="space-y-3 p-3">
					<label class="block"
						><span class="text-[0.67rem] opacity-70">Application API</span><select
							class="mt-0.5 w-full rounded border bg-transparent px-2 py-1.5 text-xs"
							value={application}
							onchange={(event) => changeApplication(event.currentTarget.value as PowerApplication)}
							><option value="indicators">Climate Indicators · 120+ indices</option><option
								value="windrose">Wind rose · direction × speed class</option
							><option value="zones">Thermal & thermal-moisture zones</option></select
						></label
					>
					{#if application === 'zones'}
						<label class="block"
							><span class="text-[0.67rem] opacity-70">Spatial endpoint</span><select
								class="mt-0.5 w-full rounded border bg-transparent px-2 py-1.5 text-xs"
								value={applicationSpatial}
								onchange={(event) =>
									changeApplicationSpatial(event.currentTarget.value as PowerApplicationSpatial)}
								><option value="point">Point · JSON or NetCDF</option><option value="regional"
									>Regional · NetCDF</option
								><option value="global">Global · NetCDF</option></select
							></label
						>
					{/if}
					{#if application !== 'zones' || applicationSpatial === 'point'}
						<div class="space-y-1.5 rounded border px-2 py-1.5">
							<div class="flex items-center justify-between gap-1">
								<span class="text-[0.67rem] font-medium">Point location</span>
								<div class="flex gap-1">
									<button
										type="button"
										aria-label="Use map centre"
										title="Use map centre"
										onclick={setCoordinatesFromMap}
										class="rounded border p-1"><MapPin size={13} /></button
									><button
										type="button"
										aria-label="Pick a point from the map"
										title="Pick from map"
										onclick={startMapPick}
										class="rounded border p-1"><MousePointer2 size={13} /></button
									>
								</div>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<label
									><span class="text-[0.62rem] opacity-60">Latitude</span><input
										aria-label="Application latitude"
										type="number"
										min="-90"
										max="90"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={latitude}
									/></label
								><label
									><span class="text-[0.62rem] opacity-60">Longitude</span><input
										aria-label="Application longitude"
										type="number"
										min="-180"
										max="180"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={longitude}
									/></label
								>
							</div>
						</div>
					{:else if applicationSpatial === 'regional'}
						<div class="space-y-1.5 rounded border px-2 py-1.5">
							<div class="flex items-center justify-between text-[0.67rem] font-medium">
								<span>Regional box</span><button
									type="button"
									class="rounded border px-1.5 py-1 text-[0.62rem]"
									onclick={() =>
										setBoundsFromMap(POWER_LIMITS.minimumZonesRegionalSpanDegrees, false)}
									>Use ≥5° map view</button
								>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<label
									><span class="text-[0.62rem] opacity-60">Latitude min</span><input
										type="number"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={latitudeMin}
									/></label
								><label
									><span class="text-[0.62rem] opacity-60">Latitude max</span><input
										type="number"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={latitudeMax}
									/></label
								><label
									><span class="text-[0.62rem] opacity-60">Longitude min</span><input
										type="number"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={longitudeMin}
									/></label
								><label
									><span class="text-[0.62rem] opacity-60">Longitude max</span><input
										type="number"
										step="any"
										class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
										bind:value={longitudeMax}
									/></label
								>
							</div>
						</div>
					{:else}
						<p class="rounded border bg-amber-500/10 px-2 py-1.5 text-[0.66rem]">
							Global Zones returns a NetCDF archive and can be a large download. It is not fetched
							until you click Run / Download.
						</p>
					{/if}

					{#if application === 'windrose'}
						<div class="grid grid-cols-2 gap-2">
							<label
								><span class="text-[0.67rem] opacity-70">Start date</span><input
									type="date"
									min={coverageBoundary(applicationConfig, 'start', 'date')}
									max={coverageBoundary(applicationConfig, 'end', 'date')}
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={windroseStart}
								/></label
							><label
								><span class="text-[0.67rem] opacity-70">End date</span><input
									type="date"
									min={coverageBoundary(applicationConfig, 'start', 'date')}
									max={coverageBoundary(applicationConfig, 'end', 'date')}
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={windroseEnd}
								/></label
							>
						</div>
					{:else}
						<div class="grid grid-cols-2 gap-2">
							<label
								><span class="text-[0.67rem] opacity-70">Start year</span><input
									type="number"
									min={coverageBoundary(applicationConfig, 'start', 'year')}
									max={coverageBoundary(applicationConfig, 'end', 'year')}
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={applicationStart}
								/></label
							><label
								><span class="text-[0.67rem] opacity-70">End year</span><input
									type="number"
									min={coverageBoundary(applicationConfig, 'start', 'year')}
									max={coverageBoundary(applicationConfig, 'end', 'year')}
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={applicationEnd}
								/></label
							>
						</div>
					{/if}

					<div class="grid grid-cols-2 gap-2">
						<label
							><span class="text-[0.67rem] opacity-70">Format</span><select
								class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1.5 text-xs"
								bind:value={applicationFormat}
								>{#each applicationFormats as format (format)}<option value={format.toLowerCase()}
										>{niceFormat(format)}</option
									>{/each}</select
							></label
						>{#if application !== 'zones'}<label
								><span class="text-[0.67rem] opacity-70">Units</span><select
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1.5 text-xs"
									bind:value={applicationUnits}
									><option value="metric">Metric</option><option value="imperial">Imperial</option
									></select
								></label
							>{/if}
					</div>
					{#if application === 'windrose'}
						<div class="grid grid-cols-2 gap-2">
							<label class="block"
								><span class="text-[0.67rem] opacity-70">Time standard</span><select
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1.5 text-xs"
									bind:value={applicationTimeStandard}
									><option value="lst">LST · Local Solar Time</option><option value="utc"
										>UTC</option
									></select
								></label
							>
							<label class="block"
								><span class="text-[0.67rem] opacity-70">Official HTML plot theme</span><select
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1.5 text-xs"
									bind:value={windroseTheme}
									><option value="light">Light</option><option value="dark">Dark</option></select
								></label
							>
						</div>
					{/if}
					<label class="block">
						<span class="text-[0.67rem] opacity-70">Optional API user identifier</span>
						<input
							type="text"
							autocomplete="off"
							pattern="[A-Za-z0-9]*"
							title="Use letters and numbers only."
							class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
							bind:value={apiUser}
							placeholder="Letters and numbers only"
						/>
					</label>
					<p class="text-[0.6rem] opacity-50">
						Sent as NASA's optional <code>user</code> query parameter; use letters and numbers only. It
						is not an account name or authentication token.
					</p>
					{#if applicationConfig?.documentation?.version}<p class="text-[0.62rem] opacity-50">
							{applicationConfig.documentation.title} · {applicationConfig.documentation
								.version}{#if displayedSettings(applicationConfig)}
								· live coverage: {displayedSettings(applicationConfig)}{/if}
						</p>{/if}
					{#if application === 'indicators'}<p class="text-[0.62rem] leading-tight opacity-60">
							Climate Indicators is a single-point report with 120+ values. NASA requires at least
							five years; custom date windows may take longer.
						</p>{:else if application === 'zones'}<p
							class="text-[0.62rem] leading-tight opacity-60"
						>
							Zones require at least two years; Regional also requires a 5° span in both latitude
							and longitude and is NetCDF-only. Moisture subtypes may be numeric codes (NASA
							example: 3A=31, 3B=32); the API response is shown without guessing a label.
						</p>{:else}<p class="text-[0.62rem] leading-tight opacity-60">
							Windrose is a daily MERRA-2 summary. The live JSON supplies 16 direction sectors,
							separate 10 m/50 m roses and speed-bin labels; the chart reads the bins/labels from
							NASA's response.
						</p>{/if}

					{#if !applicationValidation.valid}<p
							class="text-[0.67rem] text-amber-800 dark:text-amber-200"
							role="status"
						>
							{applicationValidation.error}
						</p>{/if}

					{#if applicationResult?.status === 'error'}<div
							class="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[0.7rem] text-red-800 dark:text-red-200"
							role="alert"
						>
							{applicationResult.messages.join(' ')}
						</div>{/if}
					{#if applicationResult?.status === 'success' && applicationResult.messages.length}<div
							class="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[0.7rem]"
							role="status"
						>
							{applicationResult.messages.join(' ')}
						</div>{/if}

					<div class="flex gap-2">
						<button
							type="button"
							disabled={applicationLoading || !applicationValidation.valid}
							onclick={() => void submitApplicationRequest()}
							class="flex flex-1 items-center justify-center gap-1.5 rounded bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
							>{#if applicationLoading}<span class="animate-pulse">Waiting for POWER…</span
								>{:else if applicationFormat.toLowerCase() === 'json'}Run {application ===
								'windrose'
									? 'wind rose'
									: application === 'zones'
										? 'zone'
										: 'indicator'} API{:else}<CloudDownload size={14} /> Download {niceFormat(
									applicationFormat
								)}{/if}</button
						><button
							type="button"
							aria-label="Copy NASA POWER application URL"
							title="Copy request URL"
							disabled={applicationLoading || !applicationValidation.valid}
							onclick={() => {
								try {
									void copyUrl(applicationRequest().toString());
								} catch (error) {
									toast.error(
										error instanceof Error ? error.message : 'Invalid application request.'
									);
								}
							}}
							class="rounded border px-2"><Copy size={14} /></button
						>
					</div>
					{#if application === 'windrose' && windroseHtmlUrl()}<a
							href={windroseHtmlUrl()?.toString()}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 text-[0.66rem] underline"
							><ExternalLink size={12} /> Open NASA's official interactive HTML plot</a
						>{/if}

					{#if applicationResult?.data && applicationResult.status === 'success'}
						<section class="space-y-2 border-t pt-2" aria-label="NASA POWER application result">
							{#if application === 'indicators'}
								<div class="flex items-center justify-between gap-2">
									<h3 class="text-xs font-semibold">Climate indicator values</h3>
									<span class="text-[0.62rem] opacity-55"
										>{indicatorRows.length} metrics returned</span
									>
								</div>
								{#if indicatorSummary}<p class="text-[0.62rem] leading-snug opacity-60">
										{indicatorSummary}
									</p>{/if}
								<label class="flex items-center gap-1 rounded border px-1.5"
									><Search size={13} class="opacity-50" /><input
										class="min-w-0 flex-1 bg-transparent py-1 text-[0.67rem] outline-none"
										placeholder="Filter indicator code or name"
										bind:value={catalogSearch}
										aria-label="Filter climate indicators"
									/></label
								>
								<div class="max-h-64 overflow-auto rounded border">
									<table class="w-full text-[0.63rem]">
										<thead class="sticky top-0 bg-background"
											><tr class="border-b"
												><th class="p-1.5 text-left">Indicator</th><th class="p-1.5 text-right"
													>Value</th
												></tr
											></thead
										><tbody
											>{#each indicatorRows
												.filter((item) => `${item.code} ${item.name}`
														.toLowerCase()
														.includes(catalogSearch.toLowerCase()))
												.slice(0, 150) as row (row.code)}<tr
													class="border-b border-black/5 dark:border-white/5"
													><td class="p-1.5"
														><span class="font-mono font-semibold">{row.code}</span><span
															class="ml-1 opacity-65">{row.name}</span
														></td
													><td class="p-1.5 text-right tabular-nums"
														>{row.value}{row.unit ? ` ${row.unit}` : ''}</td
													></tr
												>{/each}</tbody
										>
									</table>
								</div>
							{:else if application === 'windrose' && rose}
								<div class="flex items-center justify-between gap-2">
									<div>
										<h3 class="text-xs font-semibold">
											Wind rose · {windroseHeight === 'WR10M' ? '10 m' : '50 m'}
										</h3>
										<p class="text-[0.62rem] opacity-55">
											{rose.directions.length} sectors · classes show speed ranges from NASA metadata
										</p>
									</div>
									<label class="text-[0.62rem] opacity-70"
										>Height <select
											class="rounded border bg-transparent px-1 py-0.5"
											bind:value={windroseHeight}
											>{#each windroseHeights as height (height)}<option value={height}
													>{height === 'WR10M' ? '10 m' : '50 m'}</option
												>{/each}</select
										></label
									>
								</div>
								<div class="grid grid-cols-[9rem_1fr] items-center gap-2 rounded border p-2">
									<svg
										viewBox="0 0 144 144"
										class="w-full"
										role="img"
										aria-label="NASA POWER wind rose by direction and speed class"
									>
										{#each [0.25, 0.5, 0.75, 1] as fraction (fraction)}<circle
												cx="72"
												cy="72"
												r={48 * fraction}
												fill="none"
												stroke="currentColor"
												stroke-opacity="0.14"
											/>{/each}
										{#each ['N', 'E', 'S', 'W'] as direction, index (direction)}{@const bearing =
												index * 90}<text
												x={72 + Math.sin((bearing * Math.PI) / 180) * 58}
												y={75 - Math.cos((bearing * Math.PI) / 180) * 58}
												text-anchor="middle"
												class="fill-current text-[7px] opacity-60">{direction}</text
											>{/each}
										{#each rose.directions as direction (direction.direction)}
											{@const total = direction.classes.reduce((sum, [, value]) => sum + value, 0)}
											{@const expected = (direction.percent / maxRosePercent()) * 48}
											{@const factor = total > 0 ? expected / total : 0}
											{@const sectorWidth = 22.5}
											{#each direction.classes as [name, value], index (name)}
												{@const inner = direction.classes
													.slice(0, index)
													.reduce((sum, [, amount]) => sum + amount * factor, 0)}
												{@const outer = inner + value * factor}
												{#if outer > inner}<path
														d={rosePath(inner, outer, direction.bearing, sectorWidth)}
														fill={classColor(classIndex(name) - 1)}
														opacity="0.92"
														><title
															>{direction.direction}° · WD_PCT {direction.percent.toFixed(2)}% ·
															WD_AVG {direction.average.toFixed(2)} API units · {name}: {value.toFixed(
																2
															)}%</title
														></path
													>{/if}
											{/each}
										{/each}
									</svg>
									<div class="max-h-36 space-y-1 overflow-y-auto text-[0.62rem]">
										<p class="opacity-60">
											NASA wind-speed bins · {windroseHeight === 'WR10M' ? '10 m' : '50 m'}
										</p>
										{#each rose.classLabels as classLabel, index (classLabel.name)}<div
												class="flex items-center gap-1.5"
											>
												<span
													class="h-2.5 w-2.5 shrink-0 rounded-sm"
													style={`background:${classColor(index)}`}
												></span><span>{classLabel.label}</span>
											</div>{/each}
										<p class="pt-1 opacity-55">
											Outer ring = {maxRosePercent().toFixed(2)}% WD_PCT; inner rings are quarter
											steps. Hover a wedge for WD_PCT, WD_AVG and its class value.
										</p>
									</div>
								</div>
							{:else if application === 'zones' && zonesValues.length}
								<div class="rounded border px-2 py-1.5">
									<h3 class="text-xs font-semibold">NASA zone codes</h3>
									<div class="mt-1 space-y-1">
										{#each zonesValues as zone (zone.code)}<div
												class="flex justify-between gap-2 border-t border-black/5 py-1 text-[0.68rem] dark:border-white/5"
											>
												<span>{zone.name} · <code>{zone.code}</code></span><strong
													>{String(zone.value)}</strong
												>
											</div>{/each}
									</div>
									<p class="mt-1 text-[0.62rem] opacity-55">
										These are numeric POWER zone codes, not labels inferred by the app. NASA's
										response message describes moisture subtype encoding.
									</p>
								</div>
							{/if}
							<details class="rounded border px-2 py-1 text-[0.62rem]">
								<summary class="cursor-pointer">Raw NASA application JSON</summary>
								<pre
									class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(
										applicationResult.data,
										null,
										2
									)}</pre>
							</details>
						</section>
					{/if}
				</div>
			{:else if activeTab === 'catalog'}
				<div class="space-y-3 p-3">
					<div class="flex flex-wrap gap-1" role="tablist" aria-label="POWER system APIs">
						{#each [{ id: 'parameters', label: 'Parameters' }, { id: 'surfaces', label: 'Surfaces' }, { id: 'groups', label: 'Groups' }, { id: 'availability', label: 'Availability' }, { id: 'content', label: 'Resources' }, { id: 'registry', label: 'API list' }] as item (item.id)}<button
								type="button"
								role="tab"
								aria-selected={catalogView === item.id}
								class="rounded border px-2 py-1 text-[0.63rem] {catalogView === item.id
									? 'bg-sky-500/15 font-semibold'
									: 'opacity-65'}"
								onclick={() => void selectCatalogView(item.id as CatalogView)}>{item.label}</button
							>{/each}
					</div>
					{#if catalogLoading}<p class="animate-pulse text-[0.7rem] opacity-60">
							Loading the selected NASA POWER system endpoint…
						</p>{/if}
					{#if catalogError}<div
							class="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[0.68rem] text-red-800 dark:text-red-200"
							role="alert"
						>
							{catalogError}
						</div>{/if}
					{#if catalogView === 'parameters'}
						<div class="grid grid-cols-2 gap-2">
							<label
								><span class="text-[0.65rem] opacity-70">Community</span><select
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={catalogCommunity}
									onchange={() => {
										loadedCatalogKey = '';
										void loadCurrentCatalogView(true);
									}}
									>{#each POWER_COMMUNITIES as option (option)}<option value={option}
											>{option} · {communities[option]}</option
										>{/each}</select
								></label
							><label
								><span class="text-[0.65rem] opacity-70">Temporal</span><select
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={catalogTemporal}
									onchange={() => {
										loadedCatalogKey = '';
										void loadCurrentCatalogView(true);
									}}
									>{#each POWER_TEMPORALS as option (option)}<option value={option}>{option}</option
										>{/each}</select
								></label
							>
						</div>
						<label class="flex items-center gap-1 rounded border px-1.5"
							><Search size={13} class="opacity-50" /><input
								class="min-w-0 flex-1 bg-transparent py-1 text-[0.67rem] outline-none"
								placeholder="Find a POWER parameter"
								bind:value={catalogSearch}
							/></label
						>
						<div class="max-h-56 overflow-y-auto rounded border">
							{#each Object.entries(managerCatalog)
								.filter( ([code, metadata]) => `${code} ${metadata.name ?? ''} ${metadata.definition ?? ''}`
											.toLowerCase()
											.includes(catalogSearch.toLowerCase()) )
								.slice(0, 100) as [code, metadata] (code)}<button
									type="button"
									class="flex w-full items-start justify-between gap-2 border-b border-black/5 px-2 py-1.5 text-left hover:bg-black/5 dark:border-white/5 dark:hover:bg-white/5"
									onclick={() => {
										selectedManagerCode = code;
										void loadManagerDetail();
									}}
									><span class="min-w-0"
										><code class="font-semibold">{code}</code><span
											class="ml-1 text-[0.65rem] opacity-70">{metadata.name ?? ''}</span
										><span class="block truncate text-[0.61rem] opacity-50"
											>{metadata.definition ?? ''}</span
										></span
									><span class="shrink-0 text-[0.61rem] opacity-60">{metadata.units ?? ''}</span
									></button
								>{/each}
						</div>
						{#if managerDetail}<details open class="rounded border px-2 py-1.5 text-[0.65rem]">
								<summary class="cursor-pointer font-semibold"
									>{selectedManagerCode} · full parameter profile</summary
								>
								<pre
									class="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(
										managerDetail,
										null,
										2
									)}</pre>
							</details>{/if}
						<p class="text-[0.62rem] opacity-55">
							NASA Manager returns available codes and basic name, definition, unit and source
							metadata for each community/temporal pair. Use the details endpoint for all
							temporal/community attributes.
						</p>
					{:else if catalogView === 'surfaces'}
						<p class="text-[0.65rem] opacity-60">
							Live custom-surface aliases and monthly roughness values from POWER Manager. Each
							alias can also be requested from the separate <code>/surface/:alias</code> detail endpoint.
							Use an exact alias with a point request; custom wind surface also needs wind elevation (10–300
							m).
						</p>
						<div class="max-h-64 overflow-auto rounded border">
							{#each Object.entries(surfaces).sort( (a, b) => a[0].localeCompare(b[0]) ) as [alias, item] (alias)}<details
									class="border-b border-black/5 px-2 py-1.5 text-[0.65rem] dark:border-white/5"
								>
									<summary class="cursor-pointer"
										><code class="font-semibold">{alias}</code><span class="ml-1 opacity-65"
											>{String(item.Long_Name ?? '')}</span
										></summary
									>
									<pre class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(
											item.Roughness ?? item,
											null,
											2
										)}</pre>
									<button
										type="button"
										class="mt-1 rounded border px-2 py-1 text-[0.61rem] hover:bg-black/5 dark:hover:bg-white/5"
										onclick={() => void loadSurfaceDetail(alias)}
										>Request Manager detail for this alias</button
									>
									{#if surfaceDetailAlias === alias && surfaceDetailLoading}<p
											class="mt-1 animate-pulse text-[0.61rem] opacity-60"
										>
											Loading <code>/api/system/manager/surface/{alias}</code>…
										</p>{/if}
									{#if surfaceDetailAlias === alias && surfaceDetailError}<p
											class="mt-1 text-[0.61rem] text-red-700 dark:text-red-300"
											role="alert"
										>
											{surfaceDetailError}
										</p>{/if}
									{#if surfaceDetailAlias === alias && surfaceDetail}<details
											class="mt-1 rounded border px-1.5 py-1"
										>
											<summary class="cursor-pointer">Single-alias endpoint response</summary>
											<pre class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(
													surfaceDetail,
													null,
													2
												)}</pre>
										</details>{/if}
								</details>{/each}
						</div>
					{:else if catalogView === 'groups'}
						<p class="text-[0.65rem] opacity-60">
							POWER's live Data Access Viewer groupings by community, time resolution and variable
							family.
						</p>
						{#if catalogGroups}{#each Object.entries(catalogGroups) as [groupCommunity, temporals] (groupCommunity)}<details
									class="rounded border px-2 py-1.5 text-[0.65rem]"
								>
									<summary class="cursor-pointer font-semibold">{groupCommunity}</summary
									>{#each Object.entries(temporals) as [timeName, groups] (timeName)}<details
											class="ml-2 mt-1 border-l pl-2"
										>
											<summary class="cursor-pointer">{timeName}</summary
											>{#each Object.entries(groups) as [groupName, entries] (groupName)}<details
													class="ml-2 mt-1"
												>
													<summary class="cursor-pointer opacity-75"
														>{groupName} ({entries.length})</summary
													>
													<ul class="ml-3 list-disc py-1">
														{#each entries as entry (String(entry.abbreviation))}<li>
																<code>{String(entry.abbreviation)}</code> · {String(entry.name)}
															</li>{/each}
													</ul>
												</details>{/each}
										</details>{/each}
								</details>{/each}{/if}
					{:else if catalogView === 'availability'}
						<p class="text-[0.65rem] opacity-60">
							POWER's live source-availability service. Dates/latencies vary by upstream data
							source; they are not a promise that every parameter has values through that day.
						</p>
						{#if resourcesAvailability}<div class="overflow-auto rounded border">
								<table class="w-full text-[0.62rem]">
									<thead
										><tr class="border-b"
											><th class="p-1.5 text-left">Source</th><th class="p-1.5 text-left">Latest</th
											><th class="p-1.5 text-right">Available</th><th class="p-1.5 text-right"
												>Latency</th
											></tr
										></thead
									><tbody
										>{#each Object.entries(resourcesAvailability) as [source, value] (source)}<tr
												class="border-b border-black/5 dark:border-white/5"
												><td class="p-1.5 font-mono">{source}</td><td class="p-1.5"
													>{value.last ?? '—'}</td
												><td class="p-1.5 text-right tabular-nums"
													>{value.available?.toLocaleString() ?? '—'}</td
												><td class="p-1.5 text-right tabular-nums">{value.latency ?? '—'}</td></tr
											>{/each}</tbody
									>
								</table>
							</div>{/if}
					{:else if catalogView === 'content'}
						<div class="flex items-end gap-2">
							<label class="flex-1"
								><span class="text-[0.65rem] opacity-70">POWER Resources content page</span><select
									class="mt-0.5 w-full rounded border bg-transparent px-1.5 py-1 text-xs"
									bind:value={resourceContentName}
									onchange={() => {
										loadedCatalogKey = '';
										void loadCurrentCatalogView(true);
									}}
									><option value="dashboard-sources">dashboard-sources</option><option
										value="dashboard-hourly">dashboard-hourly</option
									><option value="dashboard-daily">dashboard-daily</option></select
								></label
							><button
								type="button"
								class="rounded border px-2 py-1.5 text-[0.64rem]"
								onclick={() => void loadCurrentCatalogView(true)}>Request</button
							>
						</div>
						{#if resourceContent}<pre
								class="max-h-56 overflow-auto rounded border p-2 text-[0.61rem] whitespace-pre-wrap">{JSON.stringify(
									resourceContent,
									null,
									2
								)}</pre>{/if}
						<p class="text-[0.62rem] opacity-55">
							The live Resources OpenAPI lists <code>/content</code> and
							<code>/dashboard/availability</code>. NASA's guide also shows older examples for
							<code>/metrics/tabular</code>, <code>/dashboard?name=…</code> and
							<code>/dashboard/plots</code>; on 3 Oct 2026 those examples were absent from the live
							OpenAPI and direct probes returned HTTP 404, so they are not presented as working
							controls here.
						</p>
						<p class="text-[0.62rem] opacity-55">
							The content endpoint returned HTTP 500 during the same check. Its error response
							lacked browser CORS permission, so a browser may show a generic fetch/CORS error
							rather than the NASA error body; source availability is a separate endpoint.
						</p>
					{:else}
						<p class="text-[0.65rem] opacity-60">
							Live POWER API specs and configuration endpoints, grouped by NASA's Temporal,
							Application and System API families.
						</p>
						<div class="space-y-1">
							{#each POWER_API_DIRECTORY as definition (definition.id)}<div
									class="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
								>
									<div class="min-w-0">
										<span class="text-[0.58rem] uppercase tracking-wide opacity-50"
											>{definition.group}</span
										>
										<p class="text-[0.68rem] font-semibold">{definition.label}</p>
									</div>
									<div class="flex shrink-0 gap-1">
										<a
											class="rounded border p-1 opacity-75 hover:opacity-100"
											href={definition.docsUrl}
											target="_blank"
											rel="noreferrer"
											title="NASA documentation"
											aria-label={`NASA docs: ${definition.label}`}><BookOpen size={13} /></a
										><a
											class="rounded border p-1 opacity-75 hover:opacity-100"
											href={powerApiResourceUrl(definition.openApiPath).toString()}
											target="_blank"
											rel="noreferrer"
											title="Open live OpenAPI JSON"
											aria-label={`Open ${definition.label} OpenAPI JSON`}
											><ExternalLink size={13} /></a
										><a
											class="rounded border p-1 opacity-75 hover:opacity-100"
											href={`${NASA_POWER_API}${definition.configurationPath.replace('/api', '')}`}
											target="_blank"
											rel="noreferrer"
											title="Open live configuration"
											aria-label={`Open ${definition.label} configuration`}
											><CircleHelp size={13} /></a
										>
									</div>
								</div>{/each}
						</div>
					{/if}
				</div>
			{:else}
				<div class="space-y-3 p-3">
					<div class="rounded border bg-sky-500/10 px-2.5 py-2 text-[0.67rem] leading-snug">
						<strong>Beyond the point/time-series REST APIs</strong>
						<p class="mt-0.5 opacity-75">
							NASA also distributes POWER through ArcGIS image/feature services and cloud-optimized
							AWS archives. These are separate services and may have independent availability or
							access patterns.
						</p>
					</div>
					<h3 class="text-xs font-semibold">NASA POWER ArcGIS services</h3>
					<div class="space-y-1">
						{#each POWER_ARCGIS_SERVICES as service (service.name)}<div
								class="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
							>
								<div class="min-w-0">
									<p class="text-[0.68rem] font-medium">{service.name}</p>
									<p class="text-[0.6rem] opacity-55">{service.kind}</p>
								</div>
								<div class="flex shrink-0 gap-1">
									<a
										href={service.serviceUrl}
										target="_blank"
										rel="noreferrer"
										class="rounded border p-1"
										title="Open ArcGIS REST service"
										aria-label={`Open ${service.name} REST service`}><ExternalLink size={13} /></a
									><a
										href={service.itemUrl}
										target="_blank"
										rel="noreferrer"
										class="rounded border p-1"
										title="NASA EGIS item"
										aria-label={`Open ${service.name} NASA item`}><Layers3 size={13} /></a
									>
								</div>
							</div>{/each}
					</div>
					<p class="text-[0.62rem] leading-tight text-amber-800 dark:text-amber-200">
						NASA's docs list the services above. Their direct EGIS REST URLs returned HTTP 404
						during this research run; the map app therefore does not silently add an unverified
						ArcGIS overlay. Try the official item link and service documentation for current status.
					</p>
					<h3 class="pt-1 text-xs font-semibold">Bulk / cloud-optimized archives</h3>
					<div class="space-y-1">
						{#each POWER_AWS_DATASETS as dataset (dataset.name)}<a
								href={dataset.url}
								target="_blank"
								rel="noreferrer"
								class="block rounded border px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
								><div class="flex items-center justify-between gap-2">
									<span class="text-[0.68rem] font-semibold">{dataset.name}</span><span
										class="shrink-0 rounded bg-black/5 px-1 py-0.5 text-[0.58rem] dark:bg-white/10"
										>{dataset.format}</span
									>
								</div>
								<p class="mt-0.5 text-[0.61rem] opacity-65">{dataset.role}</p>
								<span class="mt-1 inline-flex items-center gap-1 text-[0.61rem] underline"
									><ExternalLink size={11} /> Open bucket index</span
								></a
							>{/each}
					</div>
					<a
						href={POWER_AWS_REGISTRY}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1 text-[0.66rem] underline"
						><ExternalLink size={12} /> POWER on AWS Registry of Open Data</a
					>
					<p class="text-[0.62rem] leading-tight opacity-55">
						NASA recommends ARD/Zarr for direct online access. Raw bulk archives may not include
						community-specific conversions/units; the REST APIs do those transformations for you.
					</p>
				</div>
			{/if}
		</div>

		<footer
			class="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[0.61rem] opacity-55"
		>
			<span>NASA POWER · Prediction Of Worldwide Energy Resources</span>
			<a
				href={NASA_POWER_DOCS}
				target="_blank"
				rel="noreferrer"
				class="inline-flex shrink-0 items-center gap-1 underline">Docs <ExternalLink size={11} /></a
			>
		</footer>
	</aside>
{/if}
