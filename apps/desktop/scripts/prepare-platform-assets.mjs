#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/** Generate a platform SBOM and checksum manifest beside native packages. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, '..');
const repoRoot = join(desktopDir, '..', '..');
const releaseDir = join(desktopDir, 'release');

export function nativePackageNames(names, platform, version) {
	const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const expression =
		platform === 'linux'
			? new RegExp(`^OTelux-${escapedVersion}-((amd64|arm64)\\.deb|(x86_64|arm64)\\.AppImage)$`)
			: platform === 'darwin'
				? new RegExp(`^OTelux-${escapedVersion}-mac-(x64|arm64)\\.(dmg|zip)$`)
				: platform === 'win32'
					? new RegExp(`^OTelux-${escapedVersion}-windows-(x64|arm64)\\.(exe|zip)$`)
					: undefined;
	if (!expression) {
		throw new Error(`unsupported package platform: ${platform}`);
	}
	return names.filter((name) => expression.test(name)).sort();
}

export function sha256(path) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function npmCommand(arguments_) {
	const npmCli = process.env.npm_execpath;
	const command = npmCli ? process.execPath : 'npm';
	const args = npmCli ? [npmCli, ...arguments_] : arguments_;
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		...(process.platform === 'win32' && !npmCli ? { shell: true } : {}),
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`npm ${arguments_.join(' ')} failed: ${result.stderr}`);
	}
	return result.stdout;
}

export function preparePlatformAssets(label) {
	if (!/^[a-z0-9-]+$/.test(label)) {
		throw new Error(`invalid platform label: ${label}`);
	}
	const packageJson = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'));
	const packageNames = nativePackageNames(
		readdirSync(releaseDir),
		process.platform,
		packageJson.version,
	);
	if (packageNames.length === 0) {
		throw new Error(`no native packages for ${packageJson.version} found in ${releaseDir}`);
	}
	const sbomName = `otelux-${packageJson.version}-${label}-sbom.cdx.json`;
	const sbom = npmCommand([
		'sbom',
		'--sbom-format',
		'cyclonedx',
		'--omit=dev',
		'-w',
		'@otelux/desktop',
	]);
	JSON.parse(sbom);
	writeFileSync(join(releaseDir, sbomName), sbom);

	const checksumName = `SHA256SUMS-${label}`;
	const checkedNames = [...packageNames, sbomName];
	const checksums = checkedNames
		.map((name) => `${sha256(join(releaseDir, name))}  ${name}`)
		.join('\n');
	writeFileSync(join(releaseDir, checksumName), `${checksums}\n`);
	return { packageNames, sbomName, checksumName };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const label = process.argv[2];
	if (!label) {
		throw new Error('usage: prepare-platform-assets.mjs <platform-label>');
	}
	const result = preparePlatformAssets(label);
	console.log(
		`Prepared ${result.packageNames.length} packages, ${result.sbomName}, and ${result.checksumName}`,
	);
}
