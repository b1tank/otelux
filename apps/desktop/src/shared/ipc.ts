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
 * Single IPC request channel name. All DataSource calls go through one
 * tagged-union channel so we never have to register/remove handlers as
 * the protocol grows.
 */
export const OTELUX_INVOKE_CHANNEL = 'otelux:invoke';

/**
 * Push channel for {@link ChangeEvent}s. The main process broadcasts to
 * every renderer when the engine notifies subscribers.
 */
export const OTELUX_EVENT_CHANNEL = 'otelux:event';

/**
 * Discriminated union of every DataSource call. Add a new kind here and
 * the main-side dispatcher will fail to compile until it handles it,
 * which is how we keep the renderer/main contract honest.
 */
export type InvokeMessage =
	| { kind: 'listTraces'; query: ListTracesQuery }
	| { kind: 'getTrace'; query: GetTraceQuery }
	| { kind: 'getSpanDetails'; query: GetSpanDetailsQuery };

export type InvokeResultFor<M extends InvokeMessage> = M extends { kind: 'listTraces' }
	? ListTracesResult
	: M extends { kind: 'getTrace' }
		? Trace
		: M extends { kind: 'getSpanDetails' }
			? SpanDetails
			: never;

export type OteluxEvent = ChangeEvent;
