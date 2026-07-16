import type {
	ChangeEvent,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListLogsQuery,
	ListLogsResult,
	ListMetricsQuery,
	ListMetricsResult,
	ListTracesQuery,
	ListTracesResult,
	SpanDetails,
} from '@otelux/protocol';
import type { Trace } from '@otelux/types';

/**
 * Single IPC request channel name. All renderer→main calls go through one
 * tagged-union channel so we never have to register/remove handlers as
 * the protocol grows.
 */
export const OTELUX_INVOKE_CHANNEL = 'otelux:invoke';

/**
 * Push channel for main→renderer events. The main process broadcasts on
 * this channel when the engine, settings, or receiver status change.
 */
export const OTELUX_EVENT_CHANNEL = 'otelux:event';

/**
 * User-controllable application settings. Versioned so we can migrate
 * shape changes without losing data. The defaults live in
 * {@link DEFAULT_SETTINGS}.
 */
export interface Settings {
	readonly version: 1;
	readonly otlp: {
		readonly port: number;
	};
	readonly mcp: {
		readonly enabled: boolean;
		readonly port: number;
	};
	/**
	 * Durable-storage retention. Telemetry is pruned when EITHER bound is
	 * exceeded (age OR size), evaluated against wall-clock arrival time so a
	 * client with a skewed event clock cannot pin data in the store forever.
	 * `0` disables that individual bound (the other still applies).
	 */
	readonly retention: {
		/** Drop telemetry older than this many hours. `0` = no age limit. */
		readonly maxAgeHours: number;
		/** Prune oldest telemetry once the DB exceeds this size. `0` = no size limit. */
		readonly maxSizeMb: number;
	};
	/**
	 * Durable-storage location. `dbPath` is the absolute path of the SQLite
	 * database file; an empty string means "use the default" (`otelux.db` in the
	 * platform user-data directory). A change takes effect on the next launch —
	 * the running database is not moved or reopened mid-session.
	 */
	readonly storage: {
		/** Absolute DB file path, or `''` for the default location. */
		readonly dbPath: string;
	};
}

/**
 * Patch shape accepted by `updateSettings`. Every leaf is optional so
 * callers can update one field without resending the whole object.
 */
export interface PartialSettings {
	readonly otlp?: {
		readonly port?: number;
	};
	readonly mcp?: {
		readonly enabled?: boolean;
		readonly port?: number;
	};
	readonly retention?: {
		readonly maxAgeHours?: number;
		readonly maxSizeMb?: number;
	};
	readonly storage?: {
		readonly dbPath?: string;
	};
}

// Default OTLP/HTTP port. We deliberately use 4319 (one above the
// industry-standard 4318) so OTelux does not collide with a locally
// running OTel Collector or another OTLP receiver bound on 4318.
// Users can change this in Settings; the empty-state hint and copy
// URL always reflect the actual bound port.
//
// MCP defaults: enabled on, port 4320 (one above the OTLP default so
// the two never fight). Disabling the toggle stops the HTTP listener
// immediately without touching anything else — desktop traces still
// flow through OTLP into the same engine.
export const DEFAULT_SETTINGS: Settings = {
	version: 1,
	otlp: { port: 4319 },
	mcp: { enabled: true, port: 4320 },
	// 3 days keeps a useful debugging window without letting a chatty local
	// exporter fill the disk; 512 MiB is the hard ceiling that wins if the
	// window is busier than expected. Both are user-adjustable in Settings.
	retention: { maxAgeHours: 72, maxSizeMb: 512 },
	// Empty = default location (`otelux.db` under the user-data directory). The
	// resolved absolute path is surfaced to the UI via `getStoragePath`.
	storage: { dbPath: '' },
};

/** Inclusive bounds for a valid TCP port. */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

// Retention bounds. Upper limits keep a fat-fingered value from being
// effectively "unlimited": ~5 years of hours, and 1 TiB of disk. `0` is the
// sentinel for "no limit" on either axis and is validated separately.
export const MAX_RETENTION_AGE_HOURS = 43_800;
export const MAX_RETENTION_SIZE_MB = 1_048_576;

/**
 * Resolved storage location, reported by `getStoragePath`. `activePath` is the
 * database the running app actually has open; `defaultPath` is where it would
 * live with no custom path configured. When the persisted custom path differs
 * from `activePath`, a restart is pending for it to take effect.
 */
export interface StoragePathInfo {
	readonly activePath: string;
	readonly defaultPath: string;
}

/** Counts of the synthetic telemetry ingested by `loadSampleData`. */
export interface LoadSampleDataResult {
	readonly traces: number;
	readonly logs: number;
	readonly metrics: number;
}

/**
 * Reified receiver lifecycle state. Errors are values rather than
 * exceptions so the renderer can light up a status dot and surface the
 * underlying OS message (e.g. "EADDRINUSE: 127.0.0.1:4318").
 */
export type ReceiverStatus =
	| { readonly kind: 'starting' }
	| { readonly kind: 'running'; readonly port: number; readonly host: string }
	| {
			readonly kind: 'error';
			readonly port: number;
			readonly host: string;
			readonly message: string;
	  };

/**
 * Reified MCP server lifecycle state. Mirrors {@link ReceiverStatus}
 * one-for-one so the renderer can render both with the same status-dot
 * primitive. `disabled` is the steady state when the user has turned
 * the MCP toggle off in Settings; we still report a status so the UI
 * can say "off" explicitly rather than going blank.
 */
export type McpStatus =
	| { readonly kind: 'starting' }
	| { readonly kind: 'running'; readonly port: number; readonly host: string }
	| { readonly kind: 'disabled' }
	| {
			readonly kind: 'error';
			readonly port: number;
			readonly host: string;
			readonly message: string;
	  };

/**
 * Result of an `updateSettings` call. Bind failures (port in use, etc.)
 * come back as `{ ok: false, error }` rather than thrown across IPC, so
 * the renderer can render the message inline in the settings modal.
 */
export type UpdateSettingsResult =
	| {
			readonly ok: true;
			readonly settings: Settings;
			readonly status: ReceiverStatus;
			readonly mcpStatus: McpStatus;
	  }
	| { readonly ok: false; readonly error: string };

/**
 * Discriminated union of every renderer→main call. Add a new kind here
 * and the main-side dispatcher will fail to compile until it handles it.
 */
export type InvokeMessage =
	| { kind: 'listTraces'; query: ListTracesQuery }
	| { kind: 'getTrace'; query: GetTraceQuery }
	| { kind: 'getSpanDetails'; query: GetSpanDetailsQuery }
	| { kind: 'listLogs'; query: ListLogsQuery }
	| { kind: 'listMetrics'; query: ListMetricsQuery }
	| { kind: 'getSettings' }
	| { kind: 'updateSettings'; patch: PartialSettings }
	| { kind: 'getReceiverStatus' }
	| { kind: 'getMcpStatus' }
	| { kind: 'getStoragePath' }
	| { kind: 'loadSampleData' }
	| { kind: 'clearData' };

export type InvokeResultFor<M extends InvokeMessage> = M extends { kind: 'listTraces' }
	? ListTracesResult
	: M extends { kind: 'getTrace' }
		? Trace
		: M extends { kind: 'getSpanDetails' }
			? SpanDetails
			: M extends { kind: 'listLogs' }
				? ListLogsResult
				: M extends { kind: 'listMetrics' }
					? ListMetricsResult
					: M extends { kind: 'getSettings' }
						? Settings
						: M extends { kind: 'updateSettings' }
							? UpdateSettingsResult
							: M extends { kind: 'getReceiverStatus' }
								? ReceiverStatus
								: M extends { kind: 'getMcpStatus' }
									? McpStatus
									: M extends { kind: 'getStoragePath' }
										? StoragePathInfo
										: M extends { kind: 'loadSampleData' }
											? LoadSampleDataResult
											: M extends { kind: 'clearData' }
												? undefined
												: never;

/**
 * Discriminated union of every main→renderer push. The existing engine
 * {@link ChangeEvent} (`kind: 'tracesChanged'`) is included verbatim so
 * the workbench's subscribe path keeps working.
 */
export type OteluxEvent =
	| ChangeEvent
	| { readonly kind: 'settings-changed'; readonly settings: Settings }
	| { readonly kind: 'receiver-status-changed'; readonly status: ReceiverStatus }
	| { readonly kind: 'mcp-status-changed'; readonly status: McpStatus };
