import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	dts: true,
	sourcemap: true,
	clean: true,
	target: 'node22',
	platform: 'node',
	banner: { js: '#!/usr/bin/env node' },
});
