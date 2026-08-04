#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * Install, smoke, and uninstall the native package produced on this runner.
 * Preview CI uses unsigned artifacts; signing/trust UI remains a release gate.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = process.env.OTELUX_SMOKE_DESKTOP_DIR ?? join(here, '..');
const releaseDir = join(desktopDir, 'release');
const smokeScript = join(here, 'smoke.mjs');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'otelux-install-smoke-'));

function run(command, arguments_, options = {}) {
	console.log(`> ${command} ${arguments_.join(' ')}`);
	const result = spawnSync(command, arguments_, {
		stdio: 'inherit',
		timeout: 180_000,
		...options,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`${basename(command)} exited with status ${result.status}`);
	}
}

function releaseArtifact(predicate, description) {
	const match = readdirSync(releaseDir).filter(predicate).sort().at(-1);
	if (!match) {
		throw new Error(`${description} not found in ${releaseDir}`);
	}
	return join(releaseDir, match);
}

function findEntry(root, predicate) {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (predicate(path, entry)) {
			return path;
		}
		if (entry.isDirectory() && !entry.name.endsWith('.app')) {
			const nested = findEntry(path, predicate);
			if (nested) {
				return nested;
			}
		}
	}
	return undefined;
}

function runPackagedSmoke(binary) {
	if (!existsSync(binary)) {
		throw new Error(`installed application binary not found: ${binary}`);
	}
	const environment = {
		...process.env,
		OTELUX_SMOKE_BINARY: binary,
		OTELUX_SMOKE_DESKTOP_DIR: desktopDir,
	};
	if (process.platform === 'linux') {
		run('xvfb-run', ['-a', process.execPath, smokeScript], { env: environment });
	} else {
		run(process.execPath, [smokeScript], { env: environment });
	}
}

function smokeLinuxPackage() {
	const packagePath = releaseArtifact((name) => name.endsWith('.deb'), 'Debian package');
	try {
		run('sudo', ['apt-get', 'install', '-y', packagePath]);
		runPackagedSmoke('/usr/bin/otelux');
	} finally {
		run('sudo', ['apt-get', 'remove', '-y', 'otelux']);
	}
	if (existsSync('/usr/bin/otelux')) {
		throw new Error('Debian uninstall left /usr/bin/otelux behind');
	}
}

function smokeMacPackage() {
	const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
	const diskImage = releaseArtifact(
		(name) => name.endsWith(`-mac-${architecture}.dmg`),
		`macOS ${architecture} disk image`,
	);
	const mountPoint = join(temporaryRoot, 'dmg');
	const installedApp = join(temporaryRoot, 'Applications', 'otelux.app');
	mkdirSync(mountPoint, { recursive: true });
	mkdirSync(dirname(installedApp), { recursive: true });
	let attached = false;
	try {
		run('hdiutil', ['attach', diskImage, '-nobrowse', '-readonly', '-mountpoint', mountPoint]);
		attached = true;
		const sourceApp = findEntry(
			mountPoint,
			(path, entry) => entry.isDirectory() && path.toLowerCase().endsWith('.app'),
		);
		if (!sourceApp) {
			throw new Error('macOS disk image did not contain an application bundle');
		}
		run('ditto', [sourceApp, installedApp]);
		if (attached) {
			run('hdiutil', ['detach', mountPoint]);
			attached = false;
		}
		runPackagedSmoke(join(installedApp, 'Contents', 'MacOS', 'otelux'));
	} finally {
		if (attached) {
			run('hdiutil', ['detach', mountPoint, '-force']);
		}
		rmSync(installedApp, { recursive: true, force: true });
	}
	if (existsSync(installedApp)) {
		throw new Error('macOS uninstall cleanup left the application bundle behind');
	}
}

function smokeWindowsPackage() {
	const installer = releaseArtifact((name) => name.endsWith('.exe'), 'Windows installer');
	const installDirectory = join(temporaryRoot, 'OTelux');
	try {
		run(installer, ['/S', `/D=${installDirectory}`]);
		const binary = findEntry(
			installDirectory,
			(path, entry) => entry.isFile() && basename(path).toLowerCase() === 'otelux.exe',
		);
		if (!binary) {
			throw new Error('Windows installer did not install otelux.exe');
		}
		runPackagedSmoke(binary);
		const uninstaller = findEntry(
			installDirectory,
			(path, entry) =>
				entry.isFile() &&
				basename(path).toLowerCase().startsWith('uninstall') &&
				path.toLowerCase().endsWith('.exe'),
		);
		if (!uninstaller) {
			throw new Error('Windows installer did not provide an uninstaller');
		}
		run(uninstaller, ['/S']);
	} finally {
		rmSync(installDirectory, { recursive: true, force: true });
	}
	if (existsSync(installDirectory)) {
		throw new Error('Windows uninstall cleanup left the installation directory behind');
	}
}

try {
	if (process.platform === 'linux') {
		smokeLinuxPackage();
	} else if (process.platform === 'darwin') {
		smokeMacPackage();
	} else if (process.platform === 'win32') {
		smokeWindowsPackage();
	} else {
		throw new Error(`unsupported installer smoke platform: ${process.platform}`);
	}
	console.log('INSTALL SMOKE PASS');
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}
