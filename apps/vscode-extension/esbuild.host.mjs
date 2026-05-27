/**
 * esbuild config for the extension host bundle.
 *
 * VS Code loads `main` as a Node.js CommonJS module in the extension
 * host process. `vscode` is provided by the runtime and must remain
 * external. Everything else is bundled into a single file so the
 * `.vsix` ships without `node_modules`.
 */

import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
	entryPoints: ['src/host/extension.ts'],
	outfile: 'out/host/extension.cjs',
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'cjs',
	external: ['vscode'],
	sourcemap: true,
	logLevel: 'info',
};

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
} else {
	await esbuild.build(options);
}
