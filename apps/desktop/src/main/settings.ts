import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import {
	DEFAULT_SETTINGS,
	MAX_PORT,
	MIN_PORT,
	type PartialSettings,
	type Settings,
} from '../shared/ipc.js';

/**
 * File-backed user settings. Writes are atomic (`*.tmp` + `rename`) so a
 * crash or power loss never leaves the file half-written. Reads tolerate
 * a missing or corrupt file by falling back to {@link DEFAULT_SETTINGS}
 * — losing settings to bad JSON would be more frustrating than silently
 * restoring the defaults.
 */
export class SettingsStore {
	private current: Settings;
	private readonly listeners = new Set<(settings: Settings) => void>();

	private constructor(
		private readonly file: string,
		initial: Settings,
	) {
		this.current = initial;
	}

	/**
	 * Open the store. The file does not need to exist; if it does and is
	 * unreadable or invalid, defaults are used and the next `update` will
	 * overwrite it with a valid document.
	 */
	static async open(file: string): Promise<SettingsStore> {
		const settings = await loadOrDefault(file);
		return new SettingsStore(file, settings);
	}

	get(): Settings {
		return this.current;
	}

	/**
	 * Merge a partial patch into the current settings, validate, persist,
	 * and notify listeners. Throws if validation fails — callers should
	 * convert that into a typed result on the IPC boundary.
	 */
	async update(patch: PartialSettings): Promise<Settings> {
		const next = this.preview(patch);
		await this.commit(next);
		return next;
	}

	/**
	 * Compute the would-be settings after applying `patch` without
	 * persisting or notifying listeners. Throws on invalid input.
	 *
	 * Used by callers that need to validate a setting against a side
	 * effect (binding a port, opening a file) before committing — so a
	 * failure leaves both the in-memory state and `settings.json`
	 * untouched.
	 */
	preview(patch: PartialSettings): Settings {
		const next = merge(this.current, patch);
		validate(next);
		return next;
	}

	/**
	 * Persist a pre-validated settings object, swap it in as current,
	 * and notify listeners. Pair with {@link preview} for two-phase
	 * updates that must succeed externally before being recorded.
	 */
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
		const parsed = JSON.parse(raw) as unknown;
		return coerce(parsed);
	} catch {
		// Missing file, parse error, or schema mismatch — all collapse to
		// the same recovery: use defaults, let the next write fix the file.
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
		otlp: {
			port: patch.otlp?.port ?? base.otlp.port,
		},
		mcp: {
			enabled: patch.mcp?.enabled ?? base.mcp.enabled,
			port: patch.mcp?.port ?? base.mcp.port,
		},
	};
}

function coerce(value: unknown): Settings {
	if (typeof value !== 'object' || value === null) {
		return DEFAULT_SETTINGS;
	}
	const v = value as {
		version?: unknown;
		otlp?: { port?: unknown };
		mcp?: { enabled?: unknown; port?: unknown };
	};
	if (v.version !== 1) {
		return DEFAULT_SETTINGS;
	}
	const otlpPort = typeof v.otlp?.port === 'number' ? v.otlp.port : DEFAULT_SETTINGS.otlp.port;
	const mcpEnabled =
		typeof v.mcp?.enabled === 'boolean' ? v.mcp.enabled : DEFAULT_SETTINGS.mcp.enabled;
	const mcpPort = typeof v.mcp?.port === 'number' ? v.mcp.port : DEFAULT_SETTINGS.mcp.port;
	const candidate: Settings = {
		version: 1,
		otlp: { port: otlpPort },
		mcp: { enabled: mcpEnabled, port: mcpPort },
	};
	try {
		validate(candidate);
		return candidate;
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
		// Two HTTP listeners on the same port would race; refuse early so
		// the user sees a clear validation error instead of a cryptic
		// EADDRINUSE at runtime.
		throw new Error('MCP port must differ from OTLP port.');
	}
}
