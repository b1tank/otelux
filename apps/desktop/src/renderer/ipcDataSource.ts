import { parseInvokeResult } from '@otelux/protocol';
import type {
	DataSource,
	Disposable,
	GetLogDetailsQuery,
	GetMetricPointsQuery,
	GetMetricPointsResult,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListLogsQuery,
	ListLogsResult,
	ListMetricInstrumentsQuery,
	ListMetricInstrumentsResult,
	ListResourceFacetsQuery,
	ListResourceFacetsResult,
	ListTracesQuery,
	ListTracesResult,
	LogDetails,
	SpanDetails,
} from '@otelux/protocol';
import type { Trace } from '@otelux/types';
import type { InvokeMessage, InvokeResultFor, OteluxEvent } from '../shared/ipc.js';

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
	const invoke = async <M extends InvokeMessage>(message: M): Promise<InvokeResultFor<M>> => {
		const result = await bridge.invoke(message);
		return parseInvokeResult(message.kind, result) as InvokeResultFor<M>;
	};
	return {
		kind: 'otelux/datasource',
		async listTraces(query: ListTracesQuery): Promise<ListTracesResult> {
			return invoke({ kind: 'listTraces', query });
		},
		async getTrace(query: GetTraceQuery): Promise<Trace> {
			return invoke({ kind: 'getTrace', query });
		},
		async getTraceWaterfall(query: GetTraceQuery): Promise<Trace> {
			return invoke({ kind: 'getTraceWaterfall', query });
		},
		async getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails> {
			return invoke({ kind: 'getSpanDetails', query });
		},
		async listLogs(query: ListLogsQuery): Promise<ListLogsResult> {
			return invoke({ kind: 'listLogs', query });
		},
		async getLogDetails(query: GetLogDetailsQuery): Promise<LogDetails> {
			return invoke({ kind: 'getLogDetails', query });
		},
		async listMetricInstruments(
			query: ListMetricInstrumentsQuery,
		): Promise<ListMetricInstrumentsResult> {
			return invoke({ kind: 'listMetricInstruments', query });
		},
		async getMetricPoints(query: GetMetricPointsQuery): Promise<GetMetricPointsResult> {
			return invoke({ kind: 'getMetricPoints', query });
		},
		async listResourceFacets(query: ListResourceFacetsQuery): Promise<ListResourceFacetsResult> {
			return invoke({ kind: 'listResourceFacets', query });
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
