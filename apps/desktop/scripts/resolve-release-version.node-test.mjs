import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveReleaseVersion } from './resolve-release-version.mjs';

const base = {
	packageVersion: '0.1.2',
	eventName: 'push',
	refName: 'main',
	refType: 'branch',
	headSha: 'abc123',
};
const directories = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe('resolveReleaseVersion', () => {
	it('releases a new desktop version pushed to main', () => {
		assert.deepEqual(resolveReleaseVersion({ ...base, previousVersion: '0.1.1' }), {
			shouldRelease: true,
			tag: 'v0.1.2',
			target: 'abc123',
			version: '0.1.2',
		});
	});

	it('skips package edits that do not change the version', () => {
		assert.equal(resolveReleaseVersion({ ...base, previousVersion: '0.1.2' }).shouldRelease, false);
	});

	it('requires manual and pushed tags to match the source version', () => {
		assert.throws(
			() =>
				resolveReleaseVersion({
					...base,
					eventName: 'workflow_dispatch',
					inputTag: 'v0.1.1',
				}),
			/does not match desktop package version/,
		);
		assert.deepEqual(
			resolveReleaseVersion({
				...base,
				refName: 'v0.1.2',
				refType: 'tag',
			}),
			{
				shouldRelease: true,
				tag: 'v0.1.2',
				target: 'abc123',
				version: '0.1.2',
			},
		);
	});

	it('can target the historical commit that contains a backfilled version', () => {
		assert.deepEqual(
			resolveReleaseVersion({
				...base,
				packageVersion: '0.1.1',
				eventName: 'workflow_dispatch',
				inputTag: 'v0.1.1',
				inputTarget: 'version-commit',
			}),
			{
				shouldRelease: true,
				tag: 'v0.1.1',
				target: 'version-commit',
				version: '0.1.1',
			},
		);
	});

	it('requires a v-prefixed tag', () => {
		assert.throws(
			() =>
				resolveReleaseVersion({
					...base,
					eventName: 'workflow_dispatch',
					inputTag: '0.1.2',
				}),
			/must start with 'v'/,
		);
	});

	it('normalizes a historical revision and reads package and lock versions from it', () => {
		const directory = mkdtempSync(join(tmpdir(), 'otelux-release-resolver-'));
		directories.push(directory);
		const script = join(dirname(fileURLToPath(import.meta.url)), 'resolve-release-version.mjs');
		mkdirSync(join(directory, 'apps', 'desktop'), { recursive: true });
		mkdirSync(join(directory, 'apps', 'cli'), { recursive: true });
		execFileSync('git', ['init'], { cwd: directory });
		execFileSync('git', ['config', 'user.name', 'OTelux Test'], { cwd: directory });
		execFileSync('git', ['config', 'user.email', 'test@otelux.invalid'], { cwd: directory });
		writeVersionFiles(directory, '0.1.1');
		execFileSync('git', ['add', '.'], { cwd: directory });
		execFileSync('git', ['commit', '-m', 'version 0.1.1'], { cwd: directory });
		const historicalSha = execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: directory,
			encoding: 'utf8',
		}).trim();
		writeVersionFiles(directory, '0.1.2');
		execFileSync('git', ['add', '.'], { cwd: directory });
		execFileSync('git', ['commit', '-m', 'version 0.1.2'], { cwd: directory });

		const subprocessEnvironment = Object.fromEntries(
			Object.entries(process.env).filter(([name]) => name !== 'GITHUB_OUTPUT'),
		);
		const result = spawnSync(process.execPath, [script], {
			cwd: directory,
			encoding: 'utf8',
			env: {
				...subprocessEnvironment,
				EVENT_NAME: 'workflow_dispatch',
				HEAD_SHA: 'HEAD',
				INPUT_TAG: 'v0.1.1',
				INPUT_TARGET: `${historicalSha.slice(0, 12)}^{commit}`,
				REF_NAME: 'main',
				REF_TYPE: 'branch',
			},
		});

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /tag=v0\.1\.1/);
		assert.match(result.stdout, new RegExp(`target=${historicalSha}`));
		assert.match(result.stdout, /version=0\.1\.1/);
	});

	it('rejects a release whose bundled CLI version drifts', () => {
		const directory = mkdtempSync(join(tmpdir(), 'otelux-release-cli-version-'));
		directories.push(directory);
		const script = join(dirname(fileURLToPath(import.meta.url)), 'resolve-release-version.mjs');
		mkdirSync(join(directory, 'apps', 'desktop'), { recursive: true });
		mkdirSync(join(directory, 'apps', 'cli'), { recursive: true });
		execFileSync('git', ['init'], { cwd: directory });
		execFileSync('git', ['config', 'user.name', 'OTelux Test'], { cwd: directory });
		execFileSync('git', ['config', 'user.email', 'test@otelux.invalid'], { cwd: directory });
		writeVersionFiles(directory, '0.1.2', '0.1.1');
		execFileSync('git', ['add', '.'], { cwd: directory });
		execFileSync('git', ['commit', '-m', 'mismatched versions'], { cwd: directory });
		const result = spawnSync(process.execPath, [script], {
			cwd: directory,
			encoding: 'utf8',
			env: {
				...process.env,
				EVENT_NAME: 'workflow_dispatch',
				HEAD_SHA: 'HEAD',
				INPUT_TAG: 'v0.1.2',
				REF_NAME: 'main',
				REF_TYPE: 'branch',
			},
		});
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /must match CLI package 0\.1\.1/);
	});
});

function writeVersionFiles(directory, version, cliVersion = version) {
	writeFileSync(
		join(directory, 'apps', 'desktop', 'package.json'),
		JSON.stringify({ name: '@otelux/desktop', version }),
	);
	writeFileSync(
		join(directory, 'apps', 'cli', 'package.json'),
		JSON.stringify({ name: '@otelux/cli', version: cliVersion }),
	);
	writeFileSync(
		join(directory, 'package-lock.json'),
		JSON.stringify({
			packages: {
				'apps/desktop': { version },
				'apps/cli': { version: cliVersion },
			},
		}),
	);
}
