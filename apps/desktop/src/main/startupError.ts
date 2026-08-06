export function desktopStartupErrorMessage(error: unknown): string {
	const value = error as { code?: unknown; message?: unknown };
	switch (value.code) {
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
		default:
			return 'Desktop could not connect to the local runtime. No existing runtime was stopped or replaced.';
	}
}
