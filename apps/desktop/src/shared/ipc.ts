import type {
	ChangeEvent,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListLogsQuery,
	ListLogsResult,
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
};

/** Inclusive bounds for a valid TCP port. */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

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
	| { kind: 'getSettings' }
	| { kind: 'updateSettings'; patch: PartialSettings }
	| { kind: 'getReceiverStatus' }
	| { kind: 'getMcpStatus' };

export type InvokeResultFor<M extends InvokeMessage> = M extends { kind: 'listTraces' }
	? ListTracesResult
	: M extends { kind: 'getTrace' }
		? Trace
		: M extends { kind: 'getSpanDetails' }
			? SpanDetails
			: M extends { kind: 'listLogs' }
				? ListLogsResult
				: M extends { kind: 'getSettings' }
					? Settings
					: M extends { kind: 'updateSettings' }
						? UpdateSettingsResult
						: M extends { kind: 'getReceiverStatus' }
							? ReceiverStatus
							: M extends { kind: 'getMcpStatus' }
								? McpStatus
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
