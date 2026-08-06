import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsup';

const version = (
	JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
		version: string;
	}
).version;

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	dts: true,
	sourcemap: true,
	clean: true,
	target: 'node22',
	platform: 'node',
	banner: { js: '#!/usr/bin/env node' },
	define: { __OTELUX_CLI_VERSION__: JSON.stringify(version) },
});
