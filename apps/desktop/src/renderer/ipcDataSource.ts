import type {
	DataSource,
	Disposable,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListTracesQuery,
	ListTracesResult,
	SpanDetails,
} from '@otelux/protocol';
import type { Trace } from '@otelux/types';
import type { InvokeMessage, OteluxEvent } from '../shared/ipc.js';

/**
 * Subset of the preload bridge the renderer actually consumes. Declared
 * here (not imported) so the renderer doesn't need to know preload exists
 * — we get the typed surface from `window.otelux` and the rest is IPC.
 */
export interface OteluxWindowBridge {
	invoke(message: InvokeMessage): Promise<unknown>;
	onEvent(listener: (event: OteluxEvent) => void): () => void;
}

declare global {
	interface Window {
		otelux?: OteluxWindowBridge;
	}
}

/**
 * Wrap the preload bridge as a {@link DataSource}. Every query is a
 * fire-and-forget `invoke`; every subscriber is a single `onEvent` hook
 * that forwards engine `ChangeEvent`s. There is no client-side caching —
 * the workbench refreshes via the subscription contract.
 */
export function createIpcDataSource(bridge: OteluxWindowBridge): DataSource {
	return {
		kind: 'otelux/datasource',
		async listTraces(query: ListTracesQuery): Promise<ListTracesResult> {
			return (await bridge.invoke({ kind: 'listTraces', query })) as ListTracesResult;
		},
		async getTrace(query: GetTraceQuery): Promise<Trace> {
			return (await bridge.invoke({ kind: 'getTrace', query })) as Trace;
		},
		async getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails> {
			return (await bridge.invoke({ kind: 'getSpanDetails', query })) as SpanDetails;
		},
		subscribe(handler): Disposable {
			const unsubscribe = bridge.onEvent(handler);
			return { dispose: unsubscribe };
		},
	};
}
