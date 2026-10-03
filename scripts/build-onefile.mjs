import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = resolve(projectRoot, 'build');
const temporaryEntry = resolve(projectRoot, '.svelte-kit/onefile-entry.mjs');
const defaultOutput = resolve(projectRoot, '../open-meteo-maps-onefile.html');
const outputPath = resolve(process.cwd(), process.argv[2] ?? defaultOutput);

const run = (command, args, label) => {
	const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
};

const walk = (directory) =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});

const findRequired = (files, predicate, label) => {
	const matches = files.filter(predicate);
	if (matches.length !== 1) {
		throw new Error(`Expected one ${label}, found ${matches.length}.`);
	}
	return matches[0];
};

const capture = (expression, text, label) => {
	const match = text.match(expression);
	if (!match) throw new Error(`Could not find ${label} in the prerendered HTML.`);
	return match[1];
};

const parseInlineValue = (name, bootstrap) =>
	capture(new RegExp(`\\b${name}:\\s*(\\[[\\s\\S]*?\\]|null|undefined)`), bootstrap, name);

const replaceExactlyOnce = (source, before, after, label) => {
	const first = source.indexOf(before);
	if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
		throw new Error(`Could not uniquely inline the ${label}.`);
	}
	return source.slice(0, first) + after + source.slice(first + before.length);
};

// Vite's preload helper reads SvelteKit's manifest and injects links to its
// emitted node/chunk/CSS files when a route is imported. In the standalone
// build, Rolldown has already bundled every JS module and the CSS is inlined
// into the document, so those manifest URLs are stale and must not be fetched.
const removeStandalonePreloadAssets = (code) => {
	const manifestPattern =
		/const (?<name>[A-Za-z_$][\w$]*)=\((?<arg>[A-Za-z_$][\w$]*),(?<memo>[A-Za-z_$][\w$]*)=\k<name>,(?<cache>[A-Za-z_$][\w$]*)=\k<memo>\.f\|\|=\[[\s\S]*?\]\)=>\k<arg>\.map\(\k<arg>=>\k<cache>\[\k<arg>\]\);/g;
	const manifests = [...code.matchAll(manifestPattern)].filter(
		(match) => match[0].includes('../nodes/') && match[0].includes('.css')
	);
	if (manifests.length !== 1) {
		throw new Error(
			`Expected one SvelteKit standalone preload manifest, found ${manifests.length}.`
		);
	}
	const manifest = manifests[0];
	const replacement = `const ${manifest.groups.name}=()=>[];`;
	return (
		code.slice(0, manifest.index) + replacement + code.slice(manifest.index + manifest[0].length)
	);
};

const attr = (tag, name) =>
	tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? undefined;

const inlineCssAndFavicon = (html) => {
	let result = html.replace(/<link\b[^>]*>/gi, (tag) => {
		if (attr(tag, 'rel')?.toLowerCase() !== 'stylesheet') return tag;
		const href = attr(tag, 'href');
		if (!href) throw new Error('Found a stylesheet link without an href.');
		const cssPath = resolve(buildDirectory, decodeURIComponent(href).replace(/^\.\//, ''));
		if (!existsSync(cssPath)) throw new Error(`Stylesheet asset is missing: ${cssPath}`);
		const css = readFileSync(cssPath, 'utf8').replace(/<\/style/gi, '<\\/style');
		return `<style data-inlined="${basename(cssPath)}">${css}</style>`;
	});

	const faviconPath = resolve(buildDirectory, 'favicon.ico');
	if (!existsSync(faviconPath)) throw new Error('The build did not emit favicon.ico.');
	const favicon = readFileSync(faviconPath).toString('base64');
	result = result.replace(
		/<link\b[^>]*\brel=["']icon["'][^>]*>/i,
		`<link rel="icon" href="data:image/x-icon;base64,${favicon}" />`
	);
	result = result.replace(/<link\b(?=[^>]*\brel=["']modulepreload["'])[^>]*>\s*/gi, '');
	return result;
};

const inlineAssets = (files) => {
	const fileReaderWorker = findRequired(
		files,
		(path) => /\/assets\/worker\.[^/]+\.js$/.test(path),
		'Open-Meteo tile worker'
	);
	const maplibreWorker = findRequired(
		files,
		(path) => /\/workers\/maplibre-gl-worker-[^/]+\.js$/.test(path),
		'MapLibre worker'
	);
	const wasm = findRequired(
		files,
		(path) => /\/assets\/om_file_format\.web\.[^/]+\.wasm$/.test(path),
		'OM-file WebAssembly binary'
	);

	// Opened from disk, the page loads both workers as classic scripts (see the
	// asset loader below), so neither may use ES module syntax.
	for (const workerPath of [fileReaderWorker, maplibreWorker]) {
		const source = readFileSync(workerPath, 'utf8');
		if (/^\s*(?:import|export)\s*[\w{*]/m.test(source)) {
			throw new Error(
				`${basename(workerPath)} uses ES module syntax; it must stay a classic script so ` +
					'the standalone HTML can run from file://.'
			);
		}
	}

	return {
		fileReaderWorker,
		maplibreWorker,
		wasm,
		fileReaderWorkerBase64: readFileSync(fileReaderWorker).toString('base64'),
		maplibreWorkerBase64: readFileSync(maplibreWorker).toString('base64'),
		wasmBase64: readFileSync(wasm).toString('base64')
	};
};

const buildOneFile = async () => {
	// The shared icon assets are kept out of git and fetched before the static build.
	run(process.execPath, ['scripts/assets.mjs', 'pull', 'shared'], 'Shared asset download');
	process.env.OPEN_METEO_MAPS_ONEFILE = '1';
	run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], 'Production build');

	const htmlPath = resolve(buildDirectory, 'index.html');
	if (!existsSync(htmlPath)) throw new Error(`Static entry page not found: ${htmlPath}`);
	const sourceHtml = readFileSync(htmlPath, 'utf8');
	const bootstrapMatch = [...sourceHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(
		(match) => match[2].includes('kit.start') && match[2].includes('/entry/start.')
	);
	if (!bootstrapMatch) throw new Error('Could not find SvelteKit’s static hydration bootstrap.');

	const bootstrap = bootstrapMatch[2];
	const specifiers = [...bootstrap.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map(
		(match) => match[1]
	);
	const startSpecifier = specifiers.find((specifier) =>
		/\/entry\/start\.[^/]+\.js$/.test(specifier)
	);
	const appSpecifier = specifiers.find((specifier) => /\/entry\/app\.[^/]+\.js$/.test(specifier));
	if (!startSpecifier || !appSpecifier)
		throw new Error('Could not resolve the generated SvelteKit client entry modules.');

	const kitGlobal = capture(/(__sveltekit_[A-Za-z0-9_]+)\s*=/, bootstrap, 'SvelteKit page global');
	const nodeIds = parseInlineValue('node_ids', bootstrap);
	const data = parseInlineValue('data', bootstrap);
	const form = parseInlineValue('form', bootstrap);
	const error = parseInlineValue('error', bootstrap);
	const buildFiles = walk(buildDirectory);
	const assets = inlineAssets(buildFiles);

	const relativeModulePath = (specifier) => {
		const absolutePath = resolve(buildDirectory, specifier.replace(/^\.\//, ''));
		if (!existsSync(absolutePath)) throw new Error(`Client entry is missing: ${absolutePath}`);
		let path = relative(dirname(temporaryEntry), absolutePath).replaceAll('\\', '/');
		if (!path.startsWith('.')) path = `./${path}`;
		return path;
	};

	const wrapper = `
import { start as __start } from ${JSON.stringify(relativeModulePath(startSpecifier))};
import * as __app from ${JSON.stringify(relativeModulePath(appSpecifier))};

globalThis[${JSON.stringify(kitGlobal)}] = {
	base: new URL('.', location).pathname.slice(0, -1)
};

__start(__app, document.getElementById('onefile-app-root'), {
	node_ids: ${nodeIds},
	data: ${data},
	form: ${form},
	error: ${error}
});
`;
	writeFileSync(temporaryEntry, wrapper);

	const bundle = await rolldown({ input: temporaryEntry, platform: 'browser' });
	let moduleCode;
	try {
		const generated = await bundle.generate({ format: 'es', codeSplitting: false, minify: true });
		if (generated.output.length !== 1 || generated.output[0].type !== 'chunk') {
			throw new Error(`Expected one JavaScript bundle, got ${generated.output.length} outputs.`);
		}
		moduleCode = generated.output[0].code;
	} finally {
		await bundle.close();
	}
	moduleCode = removeStandalonePreloadAssets(moduleCode);

	const fileReaderName = basename(assets.fileReaderWorker);
	const maplibreName = basename(assets.maplibreWorker);
	const wasmName = basename(assets.wasm);
	moduleCode = replaceExactlyOnce(
		moduleCode,
		`new URL(new URL(\`../assets/${fileReaderName}\`,import.meta.url).href,\`\`+import.meta.url).href`,
		'globalThis.__OM_FILE_READER_WORKER_URL__',
		'Open-Meteo worker'
	);
	moduleCode = replaceExactlyOnce(
		moduleCode,
		`new URL(\`../workers/${maplibreName}\`,import.meta.url).href`,
		'globalThis.__OM_MAPLIBRE_WORKER_URL__',
		'MapLibre worker'
	);
	moduleCode = replaceExactlyOnce(
		moduleCode,
		`new URL(new URL(new URL(\`../assets/${wasmName}\`,import.meta.url).href,\`\`+import.meta.url).href,\`\`+import.meta.url).href`,
		'globalThis.__OM_WASM_URL__',
		'OM-file WASM'
	);

	if (/\bimport\s*\(/.test(moduleCode) || /^\s*import\s+(?!meta)/m.test(moduleCode)) {
		throw new Error('The generated standalone JavaScript still contains external module imports.');
	}

	// Served over http(s), workers and the WASM binary are loaded from blob: URLs.
	// Opened from disk (file://) that fails in Chromium, which reports
	// location.origin as "file://" but the origin of a blob: URL as "null": MapLibre
	// and the Open-Meteo worker pool then treat the blob as cross-origin, wrap it in
	// a second blob, and a worker on a file page cannot fetch that inner blob.
	// data: URLs work there. MapLibre also loads any URL that does not end in
	// ".cjs" as a module worker, which a file page cannot create at all; the
	// worker is a classic script (checked above), so the "#.cjs" suffix selects the
	// classic path. Both are used only when the two origins really disagree
	// (`disk`), so browsers where they match keep the blob: URLs.
	const assetLoader = `(()=>{const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const disk=location.protocol==="file:"&&(()=>{const u=URL.createObjectURL(new Blob([]));try{return new URL(u).origin!==location.origin}finally{URL.revokeObjectURL(u)}})();const url=(s,type)=>disk?"data:"+type+";base64,"+s:URL.createObjectURL(new Blob([bytes(s)],{type}));globalThis.__OM_FILE_READER_WORKER_URL__=url("${assets.fileReaderWorkerBase64}","text/javascript");globalThis.__OM_MAPLIBRE_WORKER_URL__=url("${assets.maplibreWorkerBase64}","text/javascript")+(disk?"#.cjs":"");let wasmUrl;Object.defineProperty(globalThis,"__OM_WASM_URL__",{configurable:true,get(){return wasmUrl||(wasmUrl=url("${assets.wasmBase64}","application/wasm"))}})})();`;
	const safeModuleCode = moduleCode.replace(/<\/script/gi, '\\x3C/script');
	if (/<\/script/i.test(safeModuleCode)) {
		throw new Error('The standalone JavaScript still contains an unescaped script-closing tag.');
	}
	let html = inlineCssAndFavicon(sourceHtml);
	html = html.replace(
		'<div style="display: contents">',
		'<div id="onefile-app-root" style="display: contents">'
	);
	if (!html.includes('id="onefile-app-root"'))
		throw new Error('Could not identify the app hydration root.');

	const moduleTag = `<script>${assetLoader}</script><script type="module">${safeModuleCode}</script>`;
	html = replaceExactlyOnce(html, bootstrapMatch[0], moduleTag, 'SvelteKit bootstrap');

	writeFileSync(outputPath, html);
	const compressedBytes = gzipSync(Buffer.from(html), { level: 6 }).byteLength;
	const rawMiB = Buffer.byteLength(html) / 1024 / 1024;
	const gzipMiB = compressedBytes / 1024 / 1024;
	console.log(`Standalone HTML written: ${outputPath}`);
	console.log(`File size: ${rawMiB.toFixed(2)} MiB; gzip transfer: ${gzipMiB.toFixed(2)} MiB.`);
	console.log(
		'All CSS, JavaScript, favicon, workers, and WASM are embedded; app data still loads from the network.'
	);
};

try {
	await buildOneFile();
} finally {
	if (existsSync(temporaryEntry)) {
		// This generated build helper is intentionally not part of the app or repository output.
		await import('node:fs/promises').then(({ unlink }) => unlink(temporaryEntry));
	}
}
