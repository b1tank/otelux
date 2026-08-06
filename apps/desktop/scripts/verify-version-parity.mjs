#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyVersionParity(repositoryRoot) {
	const desktop = JSON.parse(
		readFileSync(join(repositoryRoot, 'apps/desktop/package.json'), 'utf8'),
	);
	const cli = JSON.parse(readFileSync(join(repositoryRoot, 'apps/cli/package.json'), 'utf8'));
	const lock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8'));
	const versions = {
		desktop: desktop.version,
		desktopLock: lock.packages?.['apps/desktop']?.version,
		cli: cli.version,
		cliLock: lock.packages?.['apps/cli']?.version,
	};
	if (Object.values(versions).some((version) => version !== versions.desktop)) {
		throw new Error(
			`Release version mismatch: ${Object.entries(versions)
				.map(([name, version]) => `${name}=${String(version)}`)
				.join(', ')}`,
		);
	}
	return versions.desktop;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
	console.log(`Verified Desktop/CLI release version ${verifyVersionParity(root)}`);
}
