import type {
	ChangeEvent,
	DataSource,
	Disposable,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListLogsQuery,
	ListLogsResult,
	ListMetricsQuery,
	ListMetricsResult,
	ListResourceFacetsQuery,
	ListResourceFacetsResult,
	ListTracesQuery,
	ListTracesResult,
	SpanDetails,
} from '@otelux/protocol';
import type { LogRecord, Metric, Span, Trace } from '@otelux/types';
import type { Storage } from './storage.js';
import { traceFromSpans } from './trace.js';

export interface EngineOptions {
	storage: Storage;
}

export interface Engine extends DataSource {
	getTraceWaterfall(query: GetTraceQuery): Promise<Trace>;
	ingestSpans(spans: readonly Span[]): Promise<void>;
	ingestLogs(logs: readonly LogRecord[]): Promise<void>;
	ingestMetrics(metrics: readonly Metric[]): Promise<void>;
	/** Delete all stored telemetry and notify subscribers that every signal is now empty. */
	clear(): Promise<void>;
	close(): Promise<void>;
}

/**
 * Build an engine over a {@link Storage} backend. The engine adds:
 *
 * - Subscription/notify on every successful ingest.
 * - {@link Trace} composition from raw spans (root, services, counts).
 * - Async normalization (Storage methods may be sync or async).
 */
export function createEngine(options: EngineOptions): Engine {
	const { storage } = options;
	const listeners = new Set<(event: ChangeEvent) => void>();

	function notify(event: ChangeEvent): void {
		for (const listener of listeners) {
			try {
				listener(event);
			} catch {
				// Listeners must not break ingest. Swallow and continue.
			}
		}
	}

	return {
		kind: 'otelux/datasource',

		async ingestSpans(spans: readonly Span[]): Promise<void> {
			if (spans.length === 0) {
				return;
			}
			await storage.writeSpans(spans);
			const traceIds = [...new Set(spans.map((s) => s.traceId))];
			notify({ kind: 'tracesChanged', traceIds });
		},

		async ingestLogs(logs: readonly LogRecord[]): Promise<void> {
			if (logs.length === 0) {
				return;
			}
			await storage.writeLogs(logs);
			notify({ kind: 'logsChanged', count: logs.length });
		},

		async ingestMetrics(metrics: readonly Metric[]): Promise<void> {
			if (metrics.length === 0) {
				return;
			}
			await storage.writeMetrics(metrics);
			notify({ kind: 'metricsChanged', count: metrics.length });
		},

		async listTraces(query: ListTracesQuery): Promise<ListTracesResult> {
			return await storage.listTraces(query);
		},

		async getTrace(query: GetTraceQuery): Promise<Trace> {
			return traceForQuery(query, await storage.getTraceSpans(query.traceId));
		},

		async getTraceWaterfall(query: GetTraceQuery): Promise<Trace> {
			const trace = traceForQuery(query, await storage.getTraceSpans(query.traceId));
			const spans = trace.spans.map((span) => ({
				traceId: span.traceId,
				spanId: span.spanId,
				...(span.parentSpanId !== undefined ? { parentSpanId: span.parentSpanId } : {}),
				name: span.name,
				kind: span.kind,
				startTimeUnixNano: span.startTimeUnixNano,
				endTimeUnixNano: span.endTimeUnixNano,
				status: span.status,
				attributes: {},
				resource: {
					attributes: Object.fromEntries(
						Object.entries(span.resource.attributes).filter(
							([key]) => key === 'service.name' || key === 'service.namespace',
						),
					),
				},
				scope: span.scope,
			}));
			const rootSpan = trace.rootSpan
				? spans.find((span) => span.spanId === trace.rootSpan?.spanId)
				: undefined;
			return { ...trace, spans, ...(rootSpan !== undefined ? { rootSpan } : {}) };
		},

		async getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails> {
			const span = await storage.getSpan(query.traceId, query.spanId);
			if (!span) {
				throw new Error(`OTelux engine: span ${query.traceId}/${query.spanId} not found`);
			}
			return span;
		},

		async listLogs(query: ListLogsQuery): Promise<ListLogsResult> {
			return await storage.listLogs(query);
		},

		async listMetrics(query: ListMetricsQuery): Promise<ListMetricsResult> {
			return await storage.listMetrics(query);
		},

		async listResourceFacets(query: ListResourceFacetsQuery): Promise<ListResourceFacetsResult> {
			return await storage.listResourceFacets(query);
		},

		subscribe(handler: (event: ChangeEvent) => void): Disposable {
			listeners.add(handler);
			return {
				dispose: () => {
					listeners.delete(handler);
				},
			};
		},

		async clear(): Promise<void> {
			await storage.clear();
			// Tell every subscriber the store is now empty so open views refetch
			// and drop their rows, matching the notify-on-ingest path.
			notify({ kind: 'tracesChanged', traceIds: [] });
			notify({ kind: 'logsChanged', count: 0 });
			notify({ kind: 'metricsChanged', count: 0 });
		},

		async close(): Promise<void> {
			listeners.clear();
			await storage.close();
		},
	};
}

function traceForQuery(query: GetTraceQuery, spans: readonly Span[]): Trace {
	const trace = traceFromSpans(query.traceId, spans);
	if (trace) return trace;
	return {
		traceId: query.traceId,
		spans: [],
		startTimeUnixNano: 0n,
		endTimeUnixNano: 0n,
		durationNanos: 0n,
		services: [],
		spanCount: 0,
		errorCount: 0,
	};
}

export const OTELUX_ENGINE_VERSION = '0.1.0' as const;
