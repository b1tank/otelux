import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(__dirname, 'src/main/index.ts') },
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
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
			rollupOptions: {
				input: { index: resolve(__dirname, 'src/renderer/index.html') },
			},
		},
	},
});
