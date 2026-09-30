import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

/**
 * Hosts allowed to reach the dev/preview server besides localhost. Vite
 * rejects unknown `Host` headers to protect against DNS rebinding, which
 * breaks any setup where the server runs behind a proxy (a sandbox preview,
 * a tunnel, a LAN name). Set VITE_ALLOWED_HOSTS to a comma-separated list of
 * hosts — a leading dot matches subdomains, "*" allows any host.
 */
const allowedHosts = (value: string | undefined): true | string[] | undefined => {
	const hosts = value
		?.split(',')
		.map((host) => host.trim())
		.filter(Boolean);
	if (!hosts?.length) return undefined;
	return hosts.includes('*') ? true : hosts;
};

const addHeaders = (res: ServerResponse) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET');
	res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
	res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
};

const viteServerConfig = (): Plugin => ({
	name: 'add-headers',
	configureServer: (server: ViteDevServer) => {
		server.middlewares.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
			addHeaders(res);
			next();
		});
	},
	configurePreviewServer: (server: PreviewServer) => {
		server.middlewares.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
			addHeaders(res);
			next();
		});
	}
});

export default ({ mode }: { mode: string }) => {
	process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

	return defineConfig({
		plugins: [tailwindcss(), sveltekit(), viteServerConfig()],
		optimizeDeps: {
			exclude: [
				'@openmeteo/file-reader',
				'@openmeteo/file-format-wasm',
				'@openmeteo/weather-map-layer'
			]
		},
		server: {
			allowedHosts: allowedHosts(process.env.VITE_ALLOWED_HOSTS),
			fs: {
				// Allow serving files from one level up to the project root
				allow: ['..']
			}
		},
		build: {
			chunkSizeWarningLimit: 1500,
			rollupOptions: {
				output: {
					// Keep all of @openmeteo/weather-map-layer in a single chunk to avoid a
					// rolldown scope-hoisting bug that drops a module-level constant (see the
					// seamless "vr is not defined" crash). Match "weather-map-layer" so it also
					// covers the symlink-resolved real path used during local `npm link` dev,
					// not just the installed "@openmeteo/weather-map-layer" node_modules path.
					manualChunks: (id: string) =>
						id.includes('weather-map-layer') ? 'weather-map-layer' : undefined
				}
			}
		}
	});
};
