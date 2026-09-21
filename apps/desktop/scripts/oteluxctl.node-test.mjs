import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../build/oteluxctl', import.meta.url));
const temporary = [];

function fixture(kind) {
	const root = mkdtempSync(join(tmpdir(), `oteluxctl-${kind}-`));
	temporary.push(root);
	const contents = join(root, 'Contents');
	const resources = kind === 'mac' ? join(contents, 'Resources') : join(root, 'resources');
	const bin = join(resources, 'bin');
	mkdirSync(join(resources, 'app.asar', 'node_modules', '@otelux', 'cli', 'dist'), {
		recursive: true,
	});
	mkdirSync(bin, { recursive: true });
	const electron = kind === 'mac' ? join(contents, 'MacOS', 'otelux') : join(root, 'otelux');
	mkdirSync(dirname(electron), { recursive: true });
	const marker = join(root, 'args');
	writeFileSync(electron, `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\n`);
	chmodSync(electron, 0o755);
	const wrapper = join(bin, 'oteluxctl');
	copyFileSync(source, wrapper);
	chmodSync(wrapper, 0o755);
	return {
		root,
		wrapper,
		marker,
		cli: join(resources, 'app.asar/node_modules/@otelux/cli/dist/index.js'),
	};
}

test.afterEach(() => {
	for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('bundled CLI resolves the macOS Contents/MacOS layout', () => {
	const fixture_ = fixture('mac');
	execFileSync(fixture_.wrapper, ['status', '--json']);
	assert.deepEqual(readFileSync(fixture_.marker, 'utf8').trim().split('\n'), [
		fixture_.cli,
		'status',
		'--json',
	]);
});

test('bundled CLI retains the Linux application-root layout', () => {
	const fixture_ = fixture('linux');
	execFileSync(fixture_.wrapper, ['status']);
	assert.deepEqual(readFileSync(fixture_.marker, 'utf8').trim().split('\n'), [
		fixture_.cli,
		'status',
	]);
});
