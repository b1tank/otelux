#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const desktop = new URL('..', import.meta.url).pathname;
const version = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version;
const debArchitecture = process.arch === 'arm64' ? 'arm64' : 'amd64';
const appImageArchitecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
const release = join(desktop, 'release');
const smoke = join(desktop, 'scripts', 'daemon-smoke.mjs');
const temporary = mkdtempSync(join(tmpdir(), 'otelux-daemon-artifacts-'));

function runSmoke(binary, daemon, cli) {
	execFileSync(process.execPath, [smoke], {
		stdio: 'inherit',
		env: {
			...process.env,
			OTELUX_DAEMON_SMOKE_BINARY: binary,
			OTELUX_DAEMON_SMOKE_SCRIPT: daemon,
			OTELUX_DAEMON_SMOKE_CLI: cli,
		},
	});
}

try {
	const debRoot = join(temporary, 'deb');
	execFileSync('dpkg-deb', [
		'-x',
		join(release, `OTelux-${version}-${debArchitecture}.deb`),
		debRoot,
	]);
	const debApp = join(debRoot, 'opt', 'OTelux');
	runSmoke(
		join(debApp, 'otelux'),
		join(
			debApp,
			'resources',
			'app.asar',
			'node_modules',
			'@otelux',
			'local-runtime',
			'dist',
			'daemon.js',
		),
		join(debApp, 'resources', 'bin', 'oteluxctl'),
	);

	execFileSync(
		join(release, `OTelux-${version}-${appImageArchitecture}.AppImage`),
		['--appimage-extract'],
		{ cwd: temporary, stdio: 'ignore' },
	);
	const extracted = join(temporary, 'squashfs-root');
	runSmoke(
		join(extracted, 'otelux'),
		join(
			extracted,
			'resources',
			'app.asar',
			'node_modules',
			'@otelux',
			'local-runtime',
			'dist',
			'daemon.js',
		),
		join(extracted, 'resources', 'bin', 'oteluxctl'),
	);
	console.log('DAEMON ARTIFACT SMOKE PASS');
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
