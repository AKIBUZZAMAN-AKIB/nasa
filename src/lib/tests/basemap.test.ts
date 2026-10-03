import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	BASEMAP_PROVIDERS,
	MAPLIBRE_CREDIT,
	OutageDetector,
	ProviderCooldown,
	type StyleJson,
	addHiddenAnchor,
	attributionOptionsFor,
	candidateProviders,
	checkMaptoolkitTileJson,
	fetchJson,
	isMaptoolkitUrl,
	maptoolkitStyleUrl,
	nextProvider,
	parseProviderOrder,
	prepareMaptoolkitStyle,
	primaryVectorSource,
	resolveMaptoolkitLanguage,
	waterClipLayerId
} from '$lib/basemap';
import {
	BEFORE_LAYER_RASTER,
	BEFORE_LAYER_VECTOR,
	BEFORE_LAYER_VECTOR_WATER_CLIP
} from '$lib/constants';

/**
 * A small style with the same shape the Maptoolkit layering relies on, using
 * generic names: ground fills and relief first, then borders, roads and
 * buildings, then labels.
 */
const layer = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
	id,
	type,
	...extra
});

const fixture = (): StyleJson => ({
	version: 8,
	sources: {
		tk: { type: 'vector', url: 'https://tiles.maptoolkit.org/mtk.json' },
		dem: { type: 'raster-dem', url: 'https://tiles.maptoolkit.org/terrainrgb.json' }
	},
	layers: [
		layer('bg', 'background'),
		layer('ocean', 'fill', { source: 'tk', 'source-layer': 'water' }),
		layer('forest', 'fill', { source: 'tk', 'source-layer': 'landuse' }),
		layer('shade', 'hillshade', { source: 'dem' }),
		layer('river', 'line', { source: 'tk', 'source-layer': 'water' }),
		layer('lake', 'fill', { source: 'tk', 'source-layer': 'water' }),
		layer('border', 'line', { source: 'tk', 'source-layer': 'admin' }),
		layer('road', 'line', { source: 'tk', 'source-layer': 'road' }),
		layer('building', 'fill', { source: 'tk', 'source-layer': 'building' }),
		layer('place', 'symbol', { source: 'tk', 'source-layer': 'place_label' }),
		layer('poi', 'symbol', { source: 'tk', 'source-layer': 'poi_label' })
	]
});

const ids = (style: StyleJson) => style.layers.map((l) => l.id);

describe('parseProviderOrder', () => {
	it('defaults to Maptoolkit, then the Open-Meteo style, then OpenFreeMap', () => {
		expect(parseProviderOrder(undefined)).toEqual(['maptoolkit', 'open-meteo', 'openfreemap']);
		expect(parseProviderOrder('')).toEqual(['maptoolkit', 'open-meteo', 'openfreemap']);
		expect(parseProviderOrder('nonsense, ,')).toEqual(['maptoolkit', 'open-meteo', 'openfreemap']);
	});

	it('returns a copy, not the shared constant', () => {
		const order = parseProviderOrder(undefined);
		order.pop();
		expect(BASEMAP_PROVIDERS).toHaveLength(3);
	});

	it('lets a shorter list switch providers off', () => {
		expect(parseProviderOrder('open-meteo,openfreemap')).toEqual(['open-meteo', 'openfreemap']);
	});

	it('trims, lowercases, drops unknown names and duplicates', () => {
		expect(parseProviderOrder(' OpenFreeMap , maptoolkit, maptoolkit, bogus ')).toEqual([
			'openfreemap',
			'maptoolkit'
		]);
	});
});

describe('nextProvider', () => {
	const order = parseProviderOrder(undefined);

	it('walks down the fallback chain', () => {
		expect(nextProvider(order, 'maptoolkit')).toBe('open-meteo');
		expect(nextProvider(order, 'open-meteo')).toBe('openfreemap');
	});

	it('has nothing after the last provider or for a provider that is not in the order', () => {
		expect(nextProvider(order, 'openfreemap')).toBeUndefined();
		expect(nextProvider(['open-meteo'], 'maptoolkit')).toBeUndefined();
	});
});

describe('Maptoolkit style URL', () => {
	it('uses the language variants, English by default', () => {
		expect(maptoolkitStyleUrl(false)).toBe('https://styles.maptoolkit.org/light-en.json');
		expect(maptoolkitStyleUrl(true)).toBe('https://styles.maptoolkit.org/dark-en.json');
		expect(maptoolkitStyleUrl(true, 'de')).toBe('https://styles.maptoolkit.org/dark-de.json');
	});

	it('accepts only languages Maptoolkit offers', () => {
		expect(resolveMaptoolkitLanguage('DE')).toBe('de');
		expect(resolveMaptoolkitLanguage(' ja ')).toBe('ja');
		// There is no `light-bn.json` label variant (Bengali is only the local
		// name): an unknown value must not produce a 404 URL
		expect(resolveMaptoolkitLanguage('bn')).toBe('en');
		expect(resolveMaptoolkitLanguage(undefined)).toBe('en');
		expect(resolveMaptoolkitLanguage('')).toBe('en');
	});

	it('offers Maptoolkit\'s own default, local names, as "local": the plain style', () => {
		expect(resolveMaptoolkitLanguage('local')).toBe('local');
		expect(resolveMaptoolkitLanguage(' LOCAL ')).toBe('local');
		// There is no `light-local.json`, so no suffix at all
		expect(maptoolkitStyleUrl(false, 'local')).toBe('https://styles.maptoolkit.org/light.json');
		expect(maptoolkitStyleUrl(true, 'local')).toBe('https://styles.maptoolkit.org/dark.json');
		expect(maptoolkitStyleUrl(false, resolveMaptoolkitLanguage('local'))).not.toContain('local');
	});
});

describe('isMaptoolkitUrl', () => {
	it('accepts https URLs on maptoolkit.org, with tile and font placeholders', () => {
		expect(isMaptoolkitUrl('https://tiles.maptoolkit.org/mtk.json')).toBe(true);
		expect(isMaptoolkitUrl('https://tiles.maptoolkit.org/v1/mtk/{z}/{x}/{y}.mvt')).toBe(true);
		expect(isMaptoolkitUrl('https://fonts.maptoolkit.org/{fontstack}/{range}.pbf')).toBe(true);
		expect(isMaptoolkitUrl('https://maptoolkit.org/x')).toBe(true);
	});

	it('rejects look-alike hosts, plain http and non-URLs', () => {
		expect(isMaptoolkitUrl('https://maptoolkit.org.evil.example/x')).toBe(false);
		expect(isMaptoolkitUrl('https://evilmaptoolkit.org/x')).toBe(false);
		expect(isMaptoolkitUrl('http://tiles.maptoolkit.org/mtk.json')).toBe(false);
		expect(isMaptoolkitUrl('not a url')).toBe(false);
		expect(isMaptoolkitUrl(undefined)).toBe(false);
	});
});

describe('addHiddenAnchor', () => {
	it('inserts a hidden background layer before the given layer', () => {
		const style = fixture();
		addHiddenAnchor(style, 'anchor', 'border');
		expect(ids(style).indexOf('anchor')).toBe(ids(style).indexOf('border') - 1);
		const anchor = style.layers.find((l) => l.id === 'anchor');
		expect(anchor?.type).toBe('background');
		expect(anchor?.layout).toEqual({ visibility: 'none' });
	});

	it('appends when the layer is missing and never duplicates an id', () => {
		const style = fixture();
		addHiddenAnchor(style, 'anchor', 'nope');
		expect(ids(style).at(-1)).toBe('anchor');
		addHiddenAnchor(style, 'anchor', 'border');
		expect(ids(style).filter((id) => id === 'anchor')).toHaveLength(1);
	});
});

describe('waterClipLayerId', () => {
	it('names the first clip layer after the anchor the weather layers use', () => {
		expect(waterClipLayerId(0)).toBe(BEFORE_LAYER_VECTOR_WATER_CLIP);
		expect(waterClipLayerId(1)).toBe(`${BEFORE_LAYER_VECTOR_WATER_CLIP}-2`);
		expect(waterClipLayerId(3)).toBe(`${BEFORE_LAYER_VECTOR_WATER_CLIP}-4`);
	});
});

describe('prepareMaptoolkitStyle', () => {
	it('puts the raster anchor under the first border and the vector anchor under the first label', () => {
		const { style, vectorSource } = prepareMaptoolkitStyle(fixture(), { clipWater: false });
		expect(vectorSource).toBe('tk');
		expect(ids(style)).toEqual([
			'bg',
			'ocean',
			'forest',
			'shade',
			'river',
			'lake',
			BEFORE_LAYER_RASTER,
			'border',
			'road',
			'building',
			BEFORE_LAYER_VECTOR,
			'place',
			'poi'
		]);
	});

	it('keeps every water, land and relief layer below the raster anchor', () => {
		const { style } = prepareMaptoolkitStyle(fixture(), { clipWater: false });
		const anchor = ids(style).indexOf(BEFORE_LAYER_RASTER);
		for (const id of ['bg', 'ocean', 'forest', 'shade', 'lake']) {
			expect(ids(style).indexOf(id)).toBeLessThan(anchor);
		}
	});

	it('inserts hidden, transparent background anchors', () => {
		const { style } = prepareMaptoolkitStyle(fixture(), { clipWater: false });
		for (const id of [BEFORE_LAYER_RASTER, BEFORE_LAYER_VECTOR]) {
			const anchor = style.layers.find((l) => l.id === id);
			expect(anchor?.type).toBe('background');
			expect(anchor?.layout).toEqual({ visibility: 'none' });
		}
	});

	it('lists the source layers the style reads from the vector source', () => {
		const { sourceLayers } = prepareMaptoolkitStyle(fixture(), { clipWater: false });
		expect([...sourceLayers].sort()).toEqual(
			['admin', 'building', 'landuse', 'place_label', 'poi_label', 'road', 'water'].sort()
		);
	});

	it('does not modify the style it was given', () => {
		const input = fixture();
		prepareMaptoolkitStyle(input, { clipWater: true });
		expect(input.layers).toHaveLength(11);
		expect(ids(input)).not.toContain(BEFORE_LAYER_RASTER);
	});

	it('adds copies of the water fills above the vector anchor for Clip Water', () => {
		const { style } = prepareMaptoolkitStyle(fixture(), { clipWater: true });
		const order = ids(style);
		const vectorAnchor = order.indexOf(BEFORE_LAYER_VECTOR);
		// One copy per water fill (the river line is not a fill), right below the labels
		expect(order.slice(vectorAnchor, vectorAnchor + 4)).toEqual([
			BEFORE_LAYER_VECTOR,
			'water-clip',
			'water-clip-2',
			'place'
		]);
		const [first, second] = [
			style.layers.find((l) => l.id === 'water-clip'),
			style.layers.find((l) => l.id === 'water-clip-2')
		];
		for (const copy of [first, second]) {
			expect(copy?.type).toBe('fill');
			expect(copy?.source).toBe('tk');
			expect(copy?.['source-layer']).toBe('water');
		}
	});

	it('copies the water layers instead of sharing them with the original', () => {
		const input = fixture();
		input.layers[1].paint = { 'fill-color': '#abc' };
		const { style } = prepareMaptoolkitStyle(input, { clipWater: true });
		const original = style.layers.find((l) => l.id === 'ocean');
		const copy = style.layers.find((l) => l.id === 'water-clip');
		expect(copy?.paint).toEqual({ 'fill-color': '#abc' });
		expect(copy?.paint).not.toBe(original?.paint);
	});

	it('still provides the Clip Water anchor when the style has no water fill', () => {
		const input = fixture();
		input.layers = input.layers.filter(
			(l) => !(l.type === 'fill' && l['source-layer'] === 'water')
		);
		const { style } = prepareMaptoolkitStyle(input, { clipWater: true });
		const order = ids(style);
		expect(order.indexOf('water-clip')).toBe(order.indexOf(BEFORE_LAYER_VECTOR) + 1);
		expect(style.layers.find((l) => l.id === 'water-clip')?.type).toBe('background');
	});

	it.each([
		['null', null],
		['a string', 'style'],
		['an older style version', { ...fixture(), version: 7 }],
		['a style without layers', { ...fixture(), layers: undefined }],
		['a style without sources', { ...fixture(), sources: undefined }]
	])('rejects %s', (_name, input) => {
		expect(() => prepareMaptoolkitStyle(input, { clipWater: false })).toThrow(/valid version 8/);
	});

	it('rejects a style with no administrative boundary to anchor under', () => {
		const input = fixture();
		input.layers = input.layers.filter((l) => l['source-layer'] !== 'admin');
		expect(() => prepareMaptoolkitStyle(input, { clipWater: false })).toThrow(/boundary/);
	});

	it('rejects a style that does not read from the official Maptoolkit tiles', () => {
		const other = fixture();
		other.sources.tk = { type: 'vector', url: 'https://tiles.example.org/planet.json' };
		expect(() => prepareMaptoolkitStyle(other, { clipWater: false })).toThrow(
			/official Maptoolkit/
		);

		const inline = fixture();
		inline.sources.tk = { type: 'vector', tiles: ['https://tiles.example.org/{z}/{x}/{y}.pbf'] };
		expect(() => prepareMaptoolkitStyle(inline, { clipWater: false })).toThrow(
			/official Maptoolkit/
		);
	});

	it('rejects a style with no label layer above the borders', () => {
		const input = fixture();
		input.layers = input.layers.filter((l) => l.type !== 'symbol');
		expect(() => prepareMaptoolkitStyle(input, { clipWater: false })).toThrow(/label/);
	});

	it('rejects a layering where a water fill would hide the weather raster', () => {
		const input = fixture();
		const lake = input.layers.splice(5, 1)[0];
		input.layers.splice(8, 0, lake); // now after the border
		expect(() => prepareMaptoolkitStyle(input, { clipWater: false })).toThrow(
			/"lake" would be drawn above the weather raster/
		);
	});

	it('rejects relief drawn above the borders', () => {
		const input = fixture();
		const shade = input.layers.splice(3, 1)[0];
		input.layers.splice(7, 0, shade);
		expect(() => prepareMaptoolkitStyle(input, { clipWater: false })).toThrow(/"shade"/);
	});

	it('rejects a style that already uses a reserved anchor id', () => {
		const input = fixture();
		input.layers.push(layer(BEFORE_LAYER_RASTER, 'line', { source: 'tk', 'source-layer': 'road' }));
		expect(() => prepareMaptoolkitStyle(input, { clipWater: false })).toThrow(/reserved layer id/);
	});
});

describe('checkMaptoolkitTileJson', () => {
	const tileJson = () => ({
		tiles: ['https://tiles.maptoolkit.org/v1/mtk/{z}/{x}/{y}.mvt'],
		vector_layers: [{ id: 'admin' }, { id: 'water' }, { id: 'road' }],
		attribution:
			"<a href='https://www.maptoolkit.com/copyright/'>&copy; Maptoolkit</a> <a href='https://www.openstreetmap.org/copyright'>&copy; Openstreetmap</a>"
	});

	it('returns the credit text of a usable TileJSON', () => {
		expect(checkMaptoolkitTileJson(tileJson(), ['admin', 'water'])).toBe(tileJson().attribution);
	});

	it('rejects tiles that are not served by Maptoolkit', () => {
		expect(() =>
			checkMaptoolkitTileJson({ ...tileJson(), tiles: ['https://example.org/{z}/{x}/{y}.mvt'] }, [])
		).toThrow(/Maptoolkit tiles/);
		expect(() => checkMaptoolkitTileJson({ ...tileJson(), tiles: [] }, [])).toThrow(
			/Maptoolkit tiles/
		);
		expect(() => checkMaptoolkitTileJson(null, [])).toThrow(/Maptoolkit tiles/);
	});

	it('rejects tiles that lack a source layer the style reads', () => {
		expect(() => checkMaptoolkitTileJson(tileJson(), ['admin', 'building', 'poi_label'])).toThrow(
			/building, poi_label/
		);
	});

	it('rejects a TileJSON that does not carry the required copyright text', () => {
		expect(() => checkMaptoolkitTileJson({ ...tileJson(), attribution: '' }, [])).toThrow(
			/attribution/
		);
		expect(() =>
			checkMaptoolkitTileJson({ ...tileJson(), attribution: '&copy; Maptoolkit' }, [])
		).toThrow(/attribution/);
		const withoutAttribution: Record<string, unknown> = tileJson();
		delete withoutAttribution.attribution;
		expect(() => checkMaptoolkitTileJson(withoutAttribution, [])).toThrow(/attribution/);
	});
});

describe('attributionOptionsFor', () => {
	const credit = '<a href="https://www.maptoolkit.com/copyright/">© Maptoolkit</a>';

	it('never collapses the Maptoolkit attribution, and says so explicitly', () => {
		// An options object without `compact` still collapses below 640 px
		const options = attributionOptionsFor('maptoolkit', credit);
		expect(options.compact).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(options, 'compact')).toBe(true);
	});

	it('shows the Maptoolkit credit text from the first frame, next to the MapLibre credit', () => {
		expect(attributionOptionsFor('maptoolkit', credit).customAttribution).toEqual([
			MAPLIBRE_CREDIT,
			credit
		]);
		expect(attributionOptionsFor('maptoolkit').customAttribution).toEqual([MAPLIBRE_CREDIT]);
	});

	it('keeps MapLibre defaults for the other providers', () => {
		for (const provider of ['open-meteo', 'openfreemap'] as const) {
			expect(attributionOptionsFor(provider, credit)).toEqual({
				compact: true,
				customAttribution: MAPLIBRE_CREDIT
			});
		}
	});
});

describe('ProviderCooldown / candidateProviders', () => {
	const order = parseProviderOrder(undefined);

	it('skips a failed provider until its cool-down is over', () => {
		let now = 1_000;
		const cooldown = new ProviderCooldown(60_000, () => now);
		expect(candidateProviders(order, cooldown)).toEqual(order);

		cooldown.markFailed('maptoolkit');
		expect(cooldown.isCoolingDown('maptoolkit')).toBe(true);
		expect(candidateProviders(order, cooldown)).toEqual(['open-meteo', 'openfreemap']);

		now += 59_999;
		expect(cooldown.isCoolingDown('maptoolkit')).toBe(true);
		now += 1;
		expect(cooldown.isCoolingDown('maptoolkit')).toBe(false);
		expect(candidateProviders(order, cooldown)).toEqual(order);
	});

	it('tries everything again when every provider is cooling down', () => {
		const cooldown = new ProviderCooldown(60_000, () => 0);
		for (const provider of order) cooldown.markFailed(provider);
		expect(candidateProviders(order, cooldown)).toEqual(order);
	});

	it('only affects the provider that failed', () => {
		const cooldown = new ProviderCooldown(60_000, () => 0);
		cooldown.markFailed('open-meteo');
		expect(cooldown.isCoolingDown('maptoolkit')).toBe(false);
		expect(candidateProviders(order, cooldown)).toEqual(['maptoolkit', 'openfreemap']);
	});
});

describe('primaryVectorSource', () => {
	const style = (
		sources: StyleJson['sources'],
		layers: { id: string; source?: string }[]
	): StyleJson => ({
		version: 8,
		sources,
		layers: layers.map((layer) => ({ ...layer, type: 'fill' }))
	});

	it('picks the source most layers read from, not the small secondary one', () => {
		// Maptoolkit: the basemap tiles plus a small water-depth vector source listed first
		const result = primaryVectorSource(
			style({ depth: { type: 'vector' }, base: { type: 'vector' }, dem: { type: 'raster-dem' } }, [
				{ id: 'd1', source: 'depth' },
				{ id: 'b1', source: 'base' },
				{ id: 'b2', source: 'base' },
				{ id: 'b3', source: 'base' }
			])
		);
		expect(result).toBe('base');
	});

	it('ignores sources that are not vector sources, however many layers use them', () => {
		const result = primaryVectorSource(
			style({ dem: { type: 'raster-dem' }, base: { type: 'vector' } }, [
				{ id: 'h1', source: 'dem' },
				{ id: 'h2', source: 'dem' },
				{ id: 'b1', source: 'base' }
			])
		);
		expect(result).toBe('base');
	});

	it('returns the only vector source, even if no layer reads from it yet', () => {
		expect(primaryVectorSource(style({ only: { type: 'vector' } }, []))).toBe('only');
	});

	it('breaks a tie in favour of the source that comes first', () => {
		const result = primaryVectorSource(
			style({ a: { type: 'vector' }, b: { type: 'vector' } }, [
				{ id: 'l1', source: 'b' },
				{ id: 'l2', source: 'a' }
			])
		);
		expect(result).toBe('a');
	});

	it('returns undefined when there is no vector source', () => {
		expect(primaryVectorSource(style({ dem: { type: 'raster-dem' } }, []))).toBeUndefined();
		expect(primaryVectorSource(style({}, []))).toBeUndefined();
	});

	it('picks the main source of a Maptoolkit-shaped style that also has a water-depth source', () => {
		const input = fixture();
		input.sources.depth = { type: 'vector', url: 'https://tiles.maptoolkit.org/bathymetry.json' };
		input.layers.unshift(
			layer('depth-fill', 'fill', { source: 'depth', 'source-layer': 'bathymetry' })
		);
		const prepared = prepareMaptoolkitStyle(input, { clipWater: false });
		expect(prepared.vectorSource).toBe('tk');
		expect(primaryVectorSource(prepared.style)).toBe('tk');
	});
});

describe('OutageDetector', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const fail = (detector: OutageDetector, times: number) => {
		for (let i = 0; i < times; i++) detector.failure();
	};

	it('reports an outage once failures have gone on, with no success, for the grace period', () => {
		const onOutage = vi.fn();
		const detector = new OutageDetector(onOutage, 5, 4000);
		fail(detector, 5);
		vi.advanceTimersByTime(3999);
		expect(onOutage).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onOutage).toHaveBeenCalledTimes(1);
	});

	it('does not trip below the failure threshold', () => {
		const onOutage = vi.fn();
		const detector = new OutageDetector(onOutage, 5, 4000);
		fail(detector, 4);
		vi.advanceTimersByTime(60_000);
		expect(onOutage).not.toHaveBeenCalled();
	});

	it('is not fooled by a burst of failures followed by tiles that do load', () => {
		// Failed requests answer at once, good ones a moment later
		const onOutage = vi.fn();
		const detector = new OutageDetector(onOutage, 5, 4000);
		fail(detector, 11);
		vi.advanceTimersByTime(300);
		detector.success();
		vi.advanceTimersByTime(60_000);
		expect(onOutage).not.toHaveBeenCalled();
	});

	it('starts counting again after a success', () => {
		const onOutage = vi.fn();
		const detector = new OutageDetector(onOutage, 5, 4000);
		fail(detector, 4);
		detector.success();
		fail(detector, 4);
		vi.advanceTimersByTime(60_000);
		expect(onOutage).not.toHaveBeenCalled();
		fail(detector, 1);
		vi.advanceTimersByTime(4000);
		expect(onOutage).toHaveBeenCalledTimes(1);
	});

	it('reports at most once', () => {
		const onOutage = vi.fn();
		const detector = new OutageDetector(onOutage, 2, 1000);
		fail(detector, 2);
		vi.advanceTimersByTime(1000);
		fail(detector, 10);
		vi.advanceTimersByTime(60_000);
		expect(onOutage).toHaveBeenCalledTimes(1);
	});

	it('stops for good when disposed', () => {
		const onOutage = vi.fn();
		const detector = new OutageDetector(onOutage, 2, 1000);
		fail(detector, 2);
		detector.dispose();
		vi.advanceTimersByTime(60_000);
		fail(detector, 10);
		vi.advanceTimersByTime(60_000);
		expect(onOutage).not.toHaveBeenCalled();
	});
});

describe('fetchJson', () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.useRealTimers();
	});

	it('returns the parsed JSON body', async () => {
		globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
		await expect(fetchJson('https://example.test/a.json')).resolves.toEqual({ ok: true });
	});

	it('rejects on an HTTP error', async () => {
		globalThis.fetch = vi.fn(async () => new Response('nope', { status: 503 }));
		await expect(fetchJson('https://example.test/a.json')).rejects.toThrow(/HTTP 503/);
	});

	it('rejects when the body is not JSON, e.g. a captive portal page', async () => {
		globalThis.fetch = vi.fn(async () => new Response('<html></html>'));
		await expect(fetchJson('https://example.test/a.json')).rejects.toThrow();
	});

	it('gives up when the server does not answer in time', async () => {
		vi.useFakeTimers();
		globalThis.fetch = vi.fn(
			(_url: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					);
				})
		);
		const result = fetchJson('https://example.test/slow.json', 6000);
		const assertion = expect(result).rejects.toThrow(/did not answer within 6000 ms/);
		await vi.advanceTimersByTimeAsync(6000);
		await assertion;
	});
});
