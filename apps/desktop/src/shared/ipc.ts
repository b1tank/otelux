import type {
	ChangeEvent,
	GetSpanDetailsQuery,
	GetTraceQuery,
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
}

/**
 * Patch shape accepted by `updateSettings`. Every leaf is optional so
 * callers can update one field without resending the whole object.
 */
export interface PartialSettings {
	readonly otlp?: {
		readonly port?: number;
	};
}

export const DEFAULT_SETTINGS: Settings = {
	version: 1,
	otlp: { port: 4318 },
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
 * Result of an `updateSettings` call. Bind failures (port in use, etc.)
 * come back as `{ ok: false, error }` rather than thrown across IPC, so
 * the renderer can render the message inline in the settings modal.
 */
export type UpdateSettingsResult =
	| { readonly ok: true; readonly settings: Settings; readonly status: ReceiverStatus }
	| { readonly ok: false; readonly error: string };

/**
 * Discriminated union of every renderer→main call. Add a new kind here
 * and the main-side dispatcher will fail to compile until it handles it.
 */
export type InvokeMessage =
	| { kind: 'listTraces'; query: ListTracesQuery }
	| { kind: 'getTrace'; query: GetTraceQuery }
	| { kind: 'getSpanDetails'; query: GetSpanDetailsQuery }
	| { kind: 'getSettings' }
	| { kind: 'updateSettings'; patch: PartialSettings }
	| { kind: 'getReceiverStatus' };

export type InvokeResultFor<M extends InvokeMessage> = M extends { kind: 'listTraces' }
	? ListTracesResult
	: M extends { kind: 'getTrace' }
		? Trace
		: M extends { kind: 'getSpanDetails' }
			? SpanDetails
			: M extends { kind: 'getSettings' }
				? Settings
				: M extends { kind: 'updateSettings' }
					? UpdateSettingsResult
					: M extends { kind: 'getReceiverStatus' }
						? ReceiverStatus
						: never;

/**
 * Discriminated union of every main→renderer push. The existing engine
 * {@link ChangeEvent} (`kind: 'tracesChanged'`) is included verbatim so
 * the workbench's subscribe path keeps working.
 */
export type OteluxEvent =
	| ChangeEvent
	| { readonly kind: 'settings-changed'; readonly settings: Settings }
	| { readonly kind: 'receiver-status-changed'; readonly status: ReceiverStatus };
