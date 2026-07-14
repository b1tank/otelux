import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe.skipIf(process.platform !== 'linux')('local desktop entry', () => {
	it('quotes an absolute checkout path without interpreting field codes', () => {
		const temporaryDirectory = mkdtempSync(join(tmpdir(), 'otelux-desktop-entry-'));
		temporaryDirectories.push(temporaryDirectory);

		const checkoutName = 'otelux test %f back\\slash dollar$ tick` quote"';
		const checkout = join(temporaryDirectory, checkoutName);
		const dataHome = join(temporaryDirectory, 'data');
		const home = join(temporaryDirectory, 'home');
		mkdirSync(join(checkout, 'apps/desktop/build'), { recursive: true });
		mkdirSync(home, { recursive: true });

		const launcher = join(checkout, 'otelux.sh');
		copyFileSync(join(REPO_ROOT, 'otelux.sh'), launcher);
		chmodSync(launcher, 0o755);
		writeFileSync(join(checkout, 'apps/desktop/build/icon.png'), 'synthetic icon');

		const result = spawnSync(launcher, ['--install-desktop-only'], {
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: home,
				XDG_DATA_HOME: dataHome,
			},
		});
		expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });

		const desktopFile = readFileSync(join(dataHome, 'applications/otelux-local.desktop'), 'utf8');
		const backslash = '\\';
		const encodedCheckoutName = `otelux test %%f back${backslash.repeat(4)}slash dollar${backslash}$ tick${backslash}\` quote${backslash}"`;
		expect(desktopFile.split('\n').find((line) => line.startsWith('Exec='))).toBe(
			`Exec="${temporaryDirectory}/${encodedCheckoutName}/otelux.sh" --no-build`,
		);
		expect(desktopFile).toContain('Categories=Development;');
	});
});
