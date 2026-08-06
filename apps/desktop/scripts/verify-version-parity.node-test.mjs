import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { verifyVersionParity } from './verify-version-parity.mjs';

const directories = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('verifyVersionParity', () => {
	it('accepts one shared package and lockfile version', () => {
		const directory = fixture('0.1.2', '0.1.2', '0.1.2', '0.1.2');
		assert.equal(verifyVersionParity(directory), '0.1.2');
	});

	it('rejects any CLI or lockfile drift', () => {
		const directory = fixture('0.1.2', '0.1.2', '0.1.1', '0.1.1');
		assert.throws(() => verifyVersionParity(directory), /cli=0\.1\.1/);
	});
});

function fixture(desktop, desktopLock, cli, cliLock) {
	const directory = mkdtempSync(join(tmpdir(), 'otelux-version-parity-'));
	directories.push(directory);
	mkdirSync(join(directory, 'apps', 'desktop'), { recursive: true });
	mkdirSync(join(directory, 'apps', 'cli'), { recursive: true });
	writeFileSync(
		join(directory, 'apps', 'desktop', 'package.json'),
		JSON.stringify({ version: desktop }),
	);
	writeFileSync(join(directory, 'apps', 'cli', 'package.json'), JSON.stringify({ version: cli }));
	writeFileSync(
		join(directory, 'package-lock.json'),
		JSON.stringify({
			packages: {
				'apps/desktop': { version: desktopLock },
				'apps/cli': { version: cliLock },
			},
		}),
	);
	return directory;
}
