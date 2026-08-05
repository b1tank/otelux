import { defineConfig } from 'tsup';

export default defineConfig([
	{
		entry: ['src/index.ts'],
		format: ['esm'],
		dts: true,
		sourcemap: true,
		clean: true,
		target: 'node22',
		platform: 'node',
	},
	{
		entry: ['src/daemon.ts'],
		format: ['esm'],
		dts: true,
		sourcemap: true,
		clean: false,
		target: 'node22',
		platform: 'node',
	},
]);
