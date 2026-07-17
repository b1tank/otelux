#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const preloadPath = join(desktopDirectory, 'out', 'preload', 'index.js');
const source = readFileSync(preloadPath, 'utf8');

// Electron's sandboxed preload runtime exposes only a small require allowlist.
// Third-party packages must be bundled or removed from this boundary.
const sandboxModules = new Set(['electron', 'events', 'timers', 'url']);
const requiredModules = [...source.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)].map(
	(match) => match[2],
);
const unsupportedModules = requiredModules.filter(
	(moduleName) => moduleName !== undefined && !sandboxModules.has(moduleName),
);

if (unsupportedModules.length > 0) {
	throw new Error(
		`Sandboxed preload contains unsupported require() calls: ${[...new Set(unsupportedModules)].join(', ')}`,
	);
}
if (!source.includes('.exposeInMainWorld("otelux"')) {
	throw new Error('Sandboxed preload does not expose the OTelux context bridge');
}

console.log(`Verified sandboxed preload (${requiredModules.join(', ')})`);
