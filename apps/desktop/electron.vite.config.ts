import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Single source of truth for the application version: this package's
// `version` field, which electron-builder also uses for the artifact name
// and `app.getVersion()`. Injected into the preload so the value exposed
// to the renderer can never drift from the packaged version.
const appVersion = (
	JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
).version;

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		define: {
			__OTELUX_APP_VERSION__: JSON.stringify(appVersion),
		},
		build: {
			// Emit sourcemaps so VS Code's Node debugger can map breakpoints in
			// `out/main/index.js` back to `src/main/index.ts`.
			sourcemap: true,
			rollupOptions: {
				input: { index: resolve(__dirname, 'src/main/index.ts') },
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		define: {
			__OTELUX_APP_VERSION__: JSON.stringify(appVersion),
		},
		build: {
			sourcemap: true,
			rollupOptions: {
				input: { index: resolve(__dirname, 'src/preload/index.ts') },
				// Sandboxed preloads do not support ESM; Electron loads them
				// through an internal webpack-style runtime that uses `require`.
				// Force CommonJS so `contextBridge` and friends resolve at load
				// time. `entryFileNames` keeps the extension as `.js` to match
				// the `preload:` path in `main/index.ts`.
				output: {
					format: 'cjs',
					entryFileNames: '[name].js',
				},
			},
		},
	},
	renderer: {
		root: resolve(__dirname, 'src/renderer'),
		plugins: [react()],
		build: {
			sourcemap: true,
			rollupOptions: {
				input: { index: resolve(__dirname, 'src/renderer/index.html') },
			},
		},
	},
});
