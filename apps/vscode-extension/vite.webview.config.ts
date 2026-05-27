import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite config for the webview bundle.
 *
 * The webview is a stripped-down React app loaded by the extension
 * host into a VS Code Webview. It talks to the host via the
 * postMessage bridge in `@otelux/adapter-vscode`.
 *
 * Output goes to `out/webview/` so the host can pin
 * `Webview.html` at a stable file path.
 */
export default defineConfig({
	root: 'src/webview',
	plugins: [react()],
	build: {
		outDir: '../../out/webview',
		emptyOutDir: true,
		sourcemap: true,
		rollupOptions: {
			input: 'src/webview/index.html',
		},
	},
});
