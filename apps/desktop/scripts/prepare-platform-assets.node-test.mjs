#!/usr/bin/env node
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nativePackageNames } from './prepare-platform-assets.mjs';

const names = [
	'OTelux-0.1.8-amd64.deb',
	'OTelux-0.1.9-amd64.deb',
	'OTelux-0.1.9-x86_64.AppImage',
	'OTelux-0.1.9-mac-arm64.dmg',
	'OTelux-0.1.9-mac-arm64.zip',
	'OTelux-0.1.9-mac-x64.dmg',
	'OTelux-0.1.9-mac-x64.zip',
	'OTelux-0.1.9-windows-x64.exe',
	'OTelux-0.1.9-windows-x64.__uninstaller.exe',
	'OTelux-0.1.9-windows-x64.zip',
	'latest-linux.yml',
];

describe('nativePackageNames', () => {
	it('selects only Debian packages on Linux', () => {
		assert.deepEqual(nativePackageNames(names, 'linux', '0.1.9'), [
			'OTelux-0.1.9-amd64.deb',
			'OTelux-0.1.9-x86_64.AppImage',
		]);
	});

	it('selects both architectures and formats on macOS', () => {
		assert.deepEqual(nativePackageNames(names, 'darwin', '0.1.9'), [
			'OTelux-0.1.9-mac-arm64.dmg',
			'OTelux-0.1.9-mac-arm64.zip',
			'OTelux-0.1.9-mac-x64.dmg',
			'OTelux-0.1.9-mac-x64.zip',
		]);
	});

	it('excludes electron-builder temporary uninstallers on Windows', () => {
		assert.deepEqual(nativePackageNames(names, 'win32', '0.1.9'), [
			'OTelux-0.1.9-windows-x64.exe',
			'OTelux-0.1.9-windows-x64.zip',
		]);
	});

	it('rejects unsupported platforms', () => {
		assert.throws(() => nativePackageNames(names, 'aix', '0.1.9'), /unsupported package platform/);
	});
});
