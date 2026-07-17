import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export interface ResolveOteluxDataDirectoryOptions {
	readonly platform?: NodeJS.Platform;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly homeDirectory?: string;
}

/** Resolve the product-level data home shared by Desktop, CLI, MCP, and plugins. */
export function resolveOteluxDataDirectory(
	options: ResolveOteluxDataDirectoryOptions = {},
): string {
	const platform = options.platform ?? process.platform;
	const environment = options.environment ?? process.env;
	const homeDirectory = options.homeDirectory ?? homedir();
	const path = platform === 'win32' ? win32 : posix;
	const override = environment.OTELUX_DATA_DIR?.trim();

	if (override) {
		if (!path.isAbsolute(override)) {
			throw new Error(`OTELUX_DATA_DIR must be an absolute path; got ${override}`);
		}
		return path.normalize(override);
	}

	if (platform === 'darwin') {
		return path.join(homeDirectory, 'Library', 'Application Support', 'OTelux');
	}
	if (platform === 'win32') {
		const localAppData = environment.LOCALAPPDATA?.trim();
		const base =
			localAppData && path.isAbsolute(localAppData)
				? localAppData
				: path.join(homeDirectory, 'AppData', 'Local');
		return path.join(base, 'OTelux');
	}

	const xdgDataHome = environment.XDG_DATA_HOME?.trim();
	const base =
		xdgDataHome && path.isAbsolute(xdgDataHome)
			? xdgDataHome
			: path.join(homeDirectory, '.local', 'share');
	return path.join(base, 'otelux');
}
