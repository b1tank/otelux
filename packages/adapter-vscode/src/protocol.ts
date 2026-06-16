/**
 * Wire protocol between the VS Code extension host and the webview that
 * mounts `<OTeluxWorkbench>`.
 *
 * Tagged-union JSON-RPC. The webview sends a {@link BridgeRequest} with
 * a fresh numeric `id`; the host replies with a {@link BridgeResponse}
 * carrying the same `id` (either a `result` or an `error` string).
 * Engine subscription pushes flow the other way as {@link BridgeEvent}s
 * that have no `id` and are not paired with a request.
 *
 * The shape mirrors `DataSource` so adding a method is a single new
 * variant on the request union — the host-side switch will fail to
 * compile until it handles it.
 */

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

export type BridgeRequest =
	| { id: number; kind: 'listTraces'; query: ListTracesQuery }
	| { id: number; kind: 'getTrace'; query: GetTraceQuery }
	| { id: number; kind: 'getSpanDetails'; query: GetSpanDetailsQuery }
	| { id: number; kind: 'listLogs'; query: ListLogsQuery }
	| { id: number; kind: 'listMetrics'; query: ListMetricsQuery };

export type BridgeResponse =
	| {
			id: number;
			kind: 'result';
			payload: ListTracesResult | Trace | SpanDetails | ListLogsResult | ListMetricsResult;
	  }
	| { id: number; kind: 'error'; message: string };

export type BridgeEvent = { kind: 'event'; event: ChangeEvent };

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeEvent;

/**
 * Discriminator used by both sides to know whether an incoming envelope
 * belongs to OTelux at all — VS Code webviews can receive messages from
 * other contributors (e.g. notebook controllers, theme updaters) on the
 * same channel.
 */
export const BRIDGE_ENVELOPE_TAG = '@otelux/adapter-vscode';

export interface BridgeEnvelope {
	readonly [BRIDGE_ENVELOPE_TAG]: true;
	readonly message: BridgeMessage;
}

export function wrap(message: BridgeMessage): BridgeEnvelope {
	return { [BRIDGE_ENVELOPE_TAG]: true, message };
}

export function unwrap(value: unknown): BridgeMessage | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const env = value as Partial<BridgeEnvelope>;
	if (env[BRIDGE_ENVELOPE_TAG] !== true) {
		return undefined;
	}
	return env.message;
}
