#!/usr/bin/env node
import { constants, accessSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const required = [
	join(desktopDir, 'build', 'icon.png'),
	join(desktopDir, 'build', 'icon@1024.png'),
	join(desktopDir, 'build', 'icons', '32x32.png'),
	join(desktopDir, 'build', 'tray-template.png'),
	join(desktopDir, 'build', 'THIRD-PARTY-NOTICES.txt'),
	join(desktopDir, 'build', 'oteluxctl'),
];

for (const path of required) {
	if (!existsSync(path) || statSync(path).size === 0) {
		throw new Error(`missing or empty packaging input: ${path}`);
	}
}
accessSync(join(desktopDir, 'build', 'oteluxctl'), constants.X_OK);

for (const path of [
	join(desktopDir, 'build', 'oteluxctl'),
	join(desktopDir, '..', '..', 'scripts', 'build-icons.sh'),
]) {
	if (readFileSync(path).includes('\r\n')) {
		throw new Error(`packaging script must use LF line endings: ${path}`);
	}
}

console.log('Packaging inputs verified');
