import type {
	DataSource,
	Disposable,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListLogsQuery,
	ListLogsResult,
	ListMetricsQuery,
	ListMetricsResult,
	ListServiceFacetsQuery,
	ListServiceFacetsResult,
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
	readonly version: string;
	readonly runtime: {
		readonly electron: string;
		readonly chromium: string;
		readonly node: string;
		readonly platform: string;
	};
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
		async listLogs(query: ListLogsQuery): Promise<ListLogsResult> {
			return (await bridge.invoke({ kind: 'listLogs', query })) as ListLogsResult;
		},
		async listMetrics(query: ListMetricsQuery): Promise<ListMetricsResult> {
			return (await bridge.invoke({ kind: 'listMetrics', query })) as ListMetricsResult;
		},
		async listServiceFacets(query: ListServiceFacetsQuery): Promise<ListServiceFacetsResult> {
			return (await bridge.invoke({ kind: 'listServiceFacets', query })) as ListServiceFacetsResult;
		},
		subscribe(handler): Disposable {
			// The bridge surface delivers a wider event union (settings and
			// receiver-status pushes share the same channel). The workbench
			// only cares about engine ChangeEvents, so filter here — keeps the
			// engine subscription contract narrow.
			const unsubscribe = bridge.onEvent((event) => {
				if (
					event.kind === 'tracesChanged' ||
					event.kind === 'logsChanged' ||
					event.kind === 'metricsChanged'
				) {
					handler(event);
				}
			});
			return { dispose: unsubscribe };
		},
	};
}
