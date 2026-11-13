/**
 * Regions the explorer can analyse. Bangladesh is the default because the
 * team (DIVERGENT) works from Rajshahi; the Himalaya, Bay of Bengal and
 * Arctic regions exist so that every Earth system has somewhere meaningful to
 * look (snow, sea surface, sea ice).
 */

/** 'any' is a custom point, which may fall on land or water. */
export type Domain = 'land' | 'ocean' | 'arctic' | 'any';

export interface Region {
	id: string;
	name: string;
	group: 'Bangladesh' | 'Himalaya' | 'Bay of Bengal' | 'Polar' | 'Custom';
	domain: Domain;
	/** [west, south, east, north] in degrees. */
	bbox: [number, number, number, number];
	/** Optional outline used to pick grid cells (lon, lat pairs). */
	polygon?: [number, number][];
	center: [number, number];
	/** Ids of the bundled sample sites that represent this region (their mean is used). */
	sampleSites: string[];
	description: string;
}

/** Natural Earth 1:50m outline of Bangladesh (mainland), simplified to 0.03 degrees. */
export const BANGLADESH_OUTLINE: [number, number][] = [
	[89.05, 22.09],
	[89.05, 22.27],
	[88.92, 22.63],
	[88.85, 23.04],
	[88.93, 23.19],
	[88.72, 23.25],
	[88.74, 23.44],
	[88.57, 23.67],
	[88.7, 24.0],
	[88.72, 24.27],
	[88.4, 24.39],
	[88.29, 24.48],
	[88.15, 24.49],
	[88.02, 24.63],
	[88.15, 24.91],
	[88.31, 24.88],
	[88.46, 25.19],
	[88.82, 25.18],
	[88.95, 25.26],
	[88.82, 25.37],
	[88.77, 25.49],
	[88.5, 25.54],
	[88.36, 25.7],
	[88.08, 25.89],
	[88.15, 26.09],
	[88.44, 26.37],
	[88.44, 26.44],
	[88.35, 26.5],
	[88.42, 26.57],
	[88.62, 26.43],
	[88.68, 26.29],
	[88.83, 26.25],
	[88.97, 26.25],
	[88.92, 26.38],
	[89.02, 26.41],
	[89.19, 26.11],
	[89.37, 26.01],
	[89.55, 26.01],
	[89.59, 26.19],
	[89.67, 26.21],
	[89.82, 25.94],
	[89.8, 25.38],
	[89.83, 25.29],
	[90.44, 25.16],
	[92.05, 25.17],
	[92.37, 25.02],
	[92.49, 24.9],
	[92.44, 24.85],
	[92.23, 24.88],
	[92.1, 24.41],
	[91.95, 24.36],
	[91.88, 24.2],
	[91.73, 24.21],
	[91.53, 24.09],
	[91.37, 24.09],
	[91.23, 23.92],
	[91.16, 23.66],
	[91.32, 23.1],
	[91.37, 23.07],
	[91.37, 23.2],
	[91.44, 23.2],
	[91.51, 23.03],
	[91.62, 22.98],
	[91.75, 23.05],
	[91.75, 23.29],
	[91.94, 23.5],
	[91.93, 23.69],
	[92.15, 23.72],
	[92.25, 23.68],
	[92.33, 23.32],
	[92.36, 22.93],
	[92.49, 22.69],
	[92.63, 21.31],
	[92.57, 21.26],
	[92.33, 21.44],
	[92.21, 21.36],
	[92.19, 21.2],
	[92.32, 20.79],
	[92.06, 21.17],
	[92.01, 21.68],
	[91.82, 22.23],
	[91.86, 22.35],
	[91.8, 22.3],
	[91.53, 22.71],
	[91.48, 22.88],
	[91.22, 22.64],
	[90.95, 22.6],
	[90.66, 23.03],
	[90.6, 23.59],
	[90.56, 23.42],
	[90.27, 23.46],
	[90.39, 23.37],
	[90.52, 23.35],
	[90.59, 23.27],
	[90.6, 23.13],
	[90.47, 23.05],
	[90.55, 22.9],
	[90.46, 22.88],
	[90.44, 22.75],
	[90.62, 22.36],
	[90.59, 22.26],
	[90.36, 22.05],
	[90.23, 21.83],
	[90.16, 21.82],
	[90.07, 21.89],
	[90.09, 22.02],
	[90.21, 22.16],
	[89.95, 22.02],
	[89.92, 22.12],
	[89.89, 22.31],
	[89.99, 22.47],
	[89.88, 22.39],
	[89.81, 21.98],
	[89.57, 21.77],
	[89.48, 22.28],
	[89.5, 21.91],
	[89.35, 21.72],
	[89.23, 21.72],
	[89.09, 21.87],
	[89.05, 22.09]
];

const DIVISION_SITES = [
	'rajshahi',
	'dhaka',
	'chattogram',
	'khulna',
	'sylhet',
	'rangpur',
	'barishal',
	'mymensingh'
];

function division(
	id: string,
	name: string,
	bbox: [number, number, number, number],
	center: [number, number]
): Region {
	return {
		id,
		name: `${name} Division`,
		group: 'Bangladesh',
		domain: 'land',
		bbox,
		center,
		sampleSites: [id],
		description: `Approximate bounding box of ${name} Division, Bangladesh.`
	};
}

export const REGIONS: Region[] = [
	{
		id: 'bangladesh',
		name: 'Bangladesh (whole country)',
		group: 'Bangladesh',
		domain: 'land',
		bbox: [88.0, 20.7, 92.7, 26.6],
		polygon: BANGLADESH_OUTLINE,
		center: [90.3, 23.7],
		sampleSites: DIVISION_SITES,
		description:
			'Grid cells inside the national border. Point samples: mean of the eight division sites.'
	},
	division('rajshahi', 'Rajshahi', [88.0, 23.8, 89.8, 25.3], [88.6, 24.37]),
	division('dhaka', 'Dhaka', [89.4, 23.0, 91.0, 24.6], [90.41, 23.81]),
	division('chattogram', 'Chattogram', [90.5, 20.7, 92.7, 24.3], [91.8, 22.36]),
	division('khulna', 'Khulna', [88.5, 21.6, 89.9, 24.2], [89.55, 22.82]),
	division('sylhet', 'Sylhet', [90.9, 23.9, 92.5, 25.2], [91.87, 24.9]),
	division('rangpur', 'Rangpur', [88.1, 25.0, 89.9, 26.6], [89.25, 25.75]),
	division('barishal', 'Barishal', [89.8, 21.8, 91.0, 23.1], [90.35, 22.7]),
	division('mymensingh', 'Mymensingh', [89.6, 24.3, 91.3, 25.4], [90.4, 24.75]),
	{
		id: 'sundarbans',
		name: 'Sundarbans mangrove forest',
		group: 'Bangladesh',
		domain: 'land',
		bbox: [88.9, 21.6, 89.9, 22.4],
		center: [89.2, 21.95],
		sampleSites: ['sundarbans'],
		description: 'Bangladesh part of the Sundarbans, the largest mangrove forest on Earth.'
	},
	{
		id: 'kangchenjunga',
		name: 'Eastern Himalaya (Sikkim, Kangchenjunga)',
		group: 'Himalaya',
		domain: 'land',
		bbox: [87.8, 27.0, 89.0, 28.2],
		center: [88.3, 27.7],
		sampleSites: [],
		description: 'Snow and glacier headwaters of the Teesta, which flows into Rangpur Division.'
	},
	{
		id: 'everest',
		name: 'Central Himalaya (Everest, Khumbu)',
		group: 'Himalaya',
		domain: 'land',
		bbox: [86.4, 27.5, 87.4, 28.4],
		center: [86.9, 27.95],
		sampleSites: [],
		description: 'High-mountain snow region in the Koshi basin, part of the Ganges system.'
	},
	{
		id: 'bay-north',
		name: 'Northern Bay of Bengal',
		group: 'Bay of Bengal',
		domain: 'ocean',
		bbox: [87.0, 16.5, 92.0, 20.5],
		center: [89.5, 18.5],
		sampleSites: ['bay-north'],
		description: 'Open water south of the Bangladesh coast, where cyclones gather heat.'
	},
	{
		id: 'bay-central',
		name: 'Central Bay of Bengal',
		group: 'Bay of Bengal',
		domain: 'ocean',
		bbox: [85.0, 12.0, 91.0, 17.0],
		center: [88.0, 15.0],
		sampleSites: ['bay-central'],
		description: 'Open ocean in the middle of the Bay of Bengal.'
	},
	{
		id: 'arctic',
		name: 'Arctic Ocean (northern hemisphere sea ice)',
		group: 'Polar',
		domain: 'arctic',
		bbox: [-180, 60, 180, 90],
		center: [0, 80],
		sampleSites: ['arctic'],
		description: 'Total Arctic sea-ice extent from the NSIDC Sea Ice Index.'
	}
];

export const DEFAULT_REGION_ID = 'bangladesh';

export function regionById(id: string): Region | undefined {
	if (id.startsWith('point:')) return customRegion(id);
	return REGIONS.find((r) => r.id === id);
}

/** A 0.5 x 0.5 degree box around a tapped point, encoded in the id as point:lat,lon. */
export function customRegion(id: string): Region | undefined {
	const match = /^point:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(id);
	if (!match) return undefined;
	const lat = Number(match[1]);
	const lon = Number(match[2]);
	if (!(Math.abs(lat) <= 89) || !(Math.abs(lon) <= 180)) return undefined;
	return {
		id,
		name: `Point ${formatLat(lat)}, ${formatLon(lon)}`,
		group: 'Custom',
		domain: 'any',
		bbox: [lon - 0.25, lat - 0.25, lon + 0.25, lat + 0.25],
		center: [lon, lat],
		sampleSites: [],
		description: 'The model grid cell nearest to the point you picked.'
	};
}

export function pointRegionId(lat: number, lon: number): string {
	return `point:${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export function formatLat(lat: number): string {
	return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLon(lon: number): string {
	return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(lon: number, lat: number, polygon: [number, number][]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const [xi, yi] = polygon[i];
		const [xj, yj] = polygon[j];
		if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

export function inRegion(region: Region, lon: number, lat: number): boolean {
	if (region.polygon) return pointInPolygon(lon, lat, region.polygon);
	const [w, s, e, n] = region.bbox;
	return lon >= w && lon <= e && lat >= s && lat <= n;
}

/** POWER's regional endpoint needs at least 2 degrees in each direction (and at most 10). */
export function requestBox(region: Region): [number, number, number, number] {
	let [w, s, e, n] = region.bbox;
	const padLon = Math.max(0, 2 - (e - w)) / 2;
	const padLat = Math.max(0, 2 - (n - s)) / 2;
	w -= padLon;
	e += padLon;
	s -= padLat;
	n += padLat;
	return [round2(w), round2(s), round2(e), round2(n)];
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

/** Compass words for where a point sits inside a box, e.g. 'north-west'. */
export function compassPart(region: Region, lon: number, lat: number): string {
	const [w, s, e, n] = region.bbox;
	const fx = (lon - w) / (e - w);
	const fy = (lat - s) / (n - s);
	const ns = fy > 0.62 ? 'north' : fy < 0.38 ? 'south' : '';
	const ew = fx > 0.62 ? 'east' : fx < 0.38 ? 'west' : '';
	if (!ns && !ew) return 'centre';
	return [ns, ew].filter(Boolean).join('-');
}
