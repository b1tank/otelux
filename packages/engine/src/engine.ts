import type {
	ChangeEvent,
	DataSource,
	Disposable,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListTracesQuery,
	ListTracesResult,
	SpanDetails,
} from '@otelux/protocol';
import type { Span, Trace } from '@otelux/types';
import type { Storage } from './storage.js';
import { traceFromSpans } from './trace.js';

export interface EngineOptions {
	storage: Storage;
}

export interface Engine extends DataSource {
	ingestSpans(spans: readonly Span[]): Promise<void>;
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

		async listTraces(query: ListTracesQuery): Promise<ListTracesResult> {
			return await storage.listTraces(query);
		},

		async getTrace(query: GetTraceQuery): Promise<Trace> {
			const spans = await storage.getTraceSpans(query.traceId);
			const trace = traceFromSpans(query.traceId, spans);
			if (!trace) {
				// Returning an empty Trace keeps the API total — UI shows an
				// empty state rather than a thrown error for a missing trace.
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
			return trace;
		},

		async getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails> {
			const span = await storage.getSpan(query.spanId);
			if (!span) {
				throw new Error(`OTelux engine: span ${query.spanId} not found`);
			}
			return span;
		},

		subscribe(handler: (event: ChangeEvent) => void): Disposable {
			listeners.add(handler);
			return {
				dispose: () => {
					listeners.delete(handler);
				},
			};
		},

		async close(): Promise<void> {
			listeners.clear();
			await storage.close();
		},
	};
}

export const OTELUX_ENGINE_VERSION = '0.1.0' as const;
