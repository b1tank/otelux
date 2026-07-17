import { promises as fs } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import {
	DEFAULT_SETTINGS,
	MAX_PORT,
	MAX_RETENTION_AGE_HOURS,
	MAX_RETENTION_SIZE_MB,
	MIN_PORT,
	type PartialSettings,
	type Settings,
} from '@otelux/protocol';

export class SettingsStore {
	private current: Settings;
	private readonly listeners = new Set<(settings: Settings) => void>();

	private constructor(
		private readonly file: string,
		initial: Settings,
	) {
		this.current = initial;
	}

	static async open(file: string): Promise<SettingsStore> {
		const settings = await loadOrDefault(file);
		return new SettingsStore(file, settings);
	}

	get(): Settings {
		return this.current;
	}

	async update(patch: PartialSettings): Promise<Settings> {
		const next = this.preview(patch);
		await this.commit(next);
		return next;
	}

	preview(patch: PartialSettings): Settings {
		const next = merge(this.current, patch);
		validate(next);
		return next;
	}

	async commit(next: Settings): Promise<Settings> {
		validate(next);
		await persist(this.file, next);
		this.current = next;
		for (const listener of this.listeners) {
			listener(next);
		}
		return next;
	}

	onChange(listener: (settings: Settings) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}

async function loadOrDefault(file: string): Promise<Settings> {
	try {
		const raw = await fs.readFile(file, 'utf8');
		return coerce(JSON.parse(raw) as unknown);
	} catch {
		return DEFAULT_SETTINGS;
	}
}

async function persist(file: string, settings: Settings): Promise<void> {
	await fs.mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
	await fs.rename(tmp, file);
}

function merge(base: Settings, patch: PartialSettings): Settings {
	return {
		version: 1,
		otlp: { port: patch.otlp?.port ?? base.otlp.port },
		mcp: {
			enabled: patch.mcp?.enabled ?? base.mcp.enabled,
			port: patch.mcp?.port ?? base.mcp.port,
		},
		retention: {
			maxAgeHours: patch.retention?.maxAgeHours ?? base.retention.maxAgeHours,
			maxSizeMb: patch.retention?.maxSizeMb ?? base.retention.maxSizeMb,
		},
		storage: { dbPath: patch.storage?.dbPath ?? base.storage.dbPath },
	};
}

function coerce(value: unknown): Settings {
	if (typeof value !== 'object' || value === null) {
		return DEFAULT_SETTINGS;
	}
	const candidate = value as {
		version?: unknown;
		otlp?: { port?: unknown };
		mcp?: { enabled?: unknown; port?: unknown };
		retention?: { maxAgeHours?: unknown; maxSizeMb?: unknown };
		storage?: { dbPath?: unknown };
	};
	if (candidate.version !== 1) {
		return DEFAULT_SETTINGS;
	}
	const settings: Settings = {
		version: 1,
		otlp: {
			port:
				typeof candidate.otlp?.port === 'number' ? candidate.otlp.port : DEFAULT_SETTINGS.otlp.port,
		},
		mcp: {
			enabled:
				typeof candidate.mcp?.enabled === 'boolean'
					? candidate.mcp.enabled
					: DEFAULT_SETTINGS.mcp.enabled,
			port: typeof candidate.mcp?.port === 'number' ? candidate.mcp.port : DEFAULT_SETTINGS.mcp.port,
		},
		retention: {
			maxAgeHours:
				typeof candidate.retention?.maxAgeHours === 'number'
					? candidate.retention.maxAgeHours
					: DEFAULT_SETTINGS.retention.maxAgeHours,
			maxSizeMb:
				typeof candidate.retention?.maxSizeMb === 'number'
					? candidate.retention.maxSizeMb
					: DEFAULT_SETTINGS.retention.maxSizeMb,
		},
		storage: {
			dbPath:
				typeof candidate.storage?.dbPath === 'string'
					? candidate.storage.dbPath
					: DEFAULT_SETTINGS.storage.dbPath,
		},
	};
	try {
		validate(settings);
		return settings;
	} catch {
		return DEFAULT_SETTINGS;
	}
}

function validate(settings: Settings): void {
	const { port } = settings.otlp;
	if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
		throw new Error(`OTLP port must be an integer in [${MIN_PORT}, ${MAX_PORT}]; got ${port}`);
	}
	const { port: mcpPort } = settings.mcp;
	if (!Number.isInteger(mcpPort) || mcpPort < MIN_PORT || mcpPort > MAX_PORT) {
		throw new Error(`MCP port must be an integer in [${MIN_PORT}, ${MAX_PORT}]; got ${mcpPort}`);
	}
	if (settings.mcp.enabled && mcpPort === port) {
		throw new Error('MCP port must differ from OTLP port.');
	}
	const { maxAgeHours, maxSizeMb } = settings.retention;
	if (!Number.isInteger(maxAgeHours) || maxAgeHours < 0 || maxAgeHours > MAX_RETENTION_AGE_HOURS) {
		throw new Error(
			`Retention age must be an integer in [0, ${MAX_RETENTION_AGE_HOURS}] hours (0 = unlimited); got ${maxAgeHours}`,
		);
	}
	if (!Number.isInteger(maxSizeMb) || maxSizeMb < 0 || maxSizeMb > MAX_RETENTION_SIZE_MB) {
		throw new Error(
			`Retention size must be an integer in [0, ${MAX_RETENTION_SIZE_MB}] MB (0 = unlimited); got ${maxSizeMb}`,
		);
	}
	const { dbPath } = settings.storage;
	if (dbPath !== '' && !isAbsolute(dbPath)) {
		throw new Error(`Database path must be an absolute path or empty; got ${dbPath}`);
	}
	if (dbPath !== '' && /[\\/]$/.test(dbPath)) {
		throw new Error(`Database path must be a file, not a directory; got ${dbPath}`);
	}
}
