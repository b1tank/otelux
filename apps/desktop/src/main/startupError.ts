export type DesktopStartupErrorCode =
	| 'incompatible-version'
	| 'authentication'
	| 'invalid-state'
	| 'timeout'
	| 'unavailable'
	| 'missing-resource'
	| 'bundle-path'
	| 'storage'
	| 'listener-bind'
	| 'renderer';

const knownCodes = new Set<DesktopStartupErrorCode>([
	'incompatible-version',
	'authentication',
	'invalid-state',
	'timeout',
	'unavailable',
	'missing-resource',
	'bundle-path',
	'storage',
	'listener-bind',
	'renderer',
]);

function errorText(error: unknown): string {
	const value = error as { message?: unknown; code?: unknown };
	return `${typeof value.message === 'string' ? value.message : ''} ${typeof value.code === 'string' ? value.code : ''}`.toLowerCase();
}

/** Convert arbitrary startup failures into a small, safe diagnostic vocabulary. */
export function classifyDesktopStartupError(error: unknown): DesktopStartupErrorCode {
	const value = error as { code?: unknown };
	if (typeof value.code === 'string' && knownCodes.has(value.code as DesktopStartupErrorCode)) {
		return value.code as DesktopStartupErrorCode;
	}
	const text = errorText(error);
	if (/eaddrinuse|eacces|address already in use|bind/.test(text)) return 'listener-bind';
	if (/sqlite|database|migration|storage|permission denied/.test(text)) return 'storage';
	if (/preload|renderer|render process|did-fail-load/.test(text)) return 'renderer';
	if (/icon|resource|asar|bundle|path/.test(text)) return 'bundle-path';
	return 'unavailable';
}

export function desktopStartupErrorMessage(error: unknown): string {
	const value = error as { message?: unknown };
	switch (classifyDesktopStartupError(error)) {
		case 'missing-resource':
			return 'A required app resource is missing. Rebuild the app package, including generated icons, then reopen OTelux.';
		case 'bundle-path':
			return 'The OTelux app bundle is incomplete. Reinstall the application from a complete package.';
		case 'storage':
			return 'OTelux could not open its local data store. Check data-directory permissions or choose another storage location.';
		case 'listener-bind':
			return 'OTelux could not bind a local listener. Check for a port conflict in Settings, then reopen Desktop.';
		case 'renderer':
			return 'The OTelux workbench could not load. Reinstall the application from a complete package, then reopen it.';
		case 'incompatible-version':
			return typeof value.message === 'string'
				? `${value.message}. Stop the existing prerelease runtime, then reopen Desktop.`
				: 'A different OTelux runtime version is already running.';
		case 'authentication':
			return 'The runtime control credential is unavailable or was rejected. Check owner-only data-directory permissions.';
		case 'invalid-state':
			return 'Runtime ownership state is malformed or changed while connecting. The existing owner was left untouched.';
		case 'timeout':
		case 'unavailable':
			return 'The local runtime did not become available. Check port conflicts and runtime logs, then reopen Desktop.';
	}
}
