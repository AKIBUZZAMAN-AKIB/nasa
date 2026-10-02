import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultHtmlPath = resolve(projectRoot, '../open-meteo-maps-onefile.html');
const htmlPath = resolve(process.cwd(), process.argv[2] ?? defaultHtmlPath);
const port = Number(process.env.PORT ?? process.argv[3] ?? 8000);
const host = process.env.HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
	throw new Error(`Invalid port: ${port}`);
}
if (!existsSync(htmlPath)) {
	throw new Error(
		`Standalone HTML not found: ${htmlPath}\n` +
			'Usage: npm run serve:onefile -- <path-to-html> [port]'
	);
}

const html = readFileSync(htmlPath);
const compressedHtml = gzipSync(html, { level: 6 });
const htmlName = basename(htmlPath);
const htmlSize = statSync(htmlPath).size;

const headers = {
	'Cache-Control': 'no-cache',
	'Content-Type': 'text/html; charset=utf-8',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'cross-origin',
	Vary: 'Accept-Encoding'
};

const acceptsGzip = (value = '') =>
	value.split(',').some((encoding) => {
		const [name, ...parameters] = encoding.trim().toLowerCase().split(';');
		const quality = parameters.find((parameter) => parameter.trim().startsWith('q='));
		return name === 'gzip' && (quality === undefined || Number(quality.trim().slice(2)) > 0);
	});

const server = createServer((request, response) => {
	const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.writeHead(405, { Allow: 'GET, HEAD' }).end();
		return;
	}
	if (pathname !== '/' && pathname !== `/${htmlName}`) {
		response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
		return;
	}

	const useGzip = acceptsGzip(request.headers['accept-encoding']);
	const body = useGzip ? compressedHtml : html;
	response.writeHead(200, {
		...headers,
		'Content-Length': body.byteLength,
		...(useGzip ? { 'Content-Encoding': 'gzip' } : {})
	});
	if (request.method === 'HEAD') {
		response.end();
	} else {
		response.end(body);
	}
});

server.listen(port, host, () => {
	const hostForUrl = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
	console.log(`Serving ${htmlName} (${(htmlSize / 1024 / 1024).toFixed(2)} MiB)`);
	console.log(`URL: http://${hostForUrl}:${port}/`);
	console.log(
		`Gzip transfer: ${(compressedHtml.byteLength / 1024 / 1024).toFixed(2)} MiB; COOP/COEP enabled for shared-memory workers.`
	);
});
