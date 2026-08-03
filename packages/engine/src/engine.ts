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

export interface ServiceOverviewRow {
	readonly name: string;
	readonly traces: number;
	readonly errorTraces: number;
	readonly spans: number;
	readonly errorRate: number;
	readonly p50DurationNanos: bigint;
	readonly p95DurationNanos: bigint;
	readonly logs: number;
	readonly logSeverity: Readonly<Record<string, number>>;
	readonly metricInstruments: number;
}

export interface Engine extends DataSource {
	getTraceWaterfall(query: GetTraceQuery): Promise<Trace>;
	getServiceOverview(sinceMinutes: number): Promise<readonly ServiceOverviewRow[]>;
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

		async getServiceOverview(sinceMinutes: number): Promise<readonly ServiceOverviewRow[]> {
			const nowNs = BigInt(Date.now()) * 1_000_000n;
			const fromNs = nowNs - BigInt(sinceMinutes) * 60n * 1_000_000_000n;
			const services = new Map<string, MutableServiceOverview>();
			let cursor: string | undefined;
			do {
				const page = await storage.listTraces({
					limit: 500,
					...(cursor ? { cursor, includeTotalCount: false } : {}),
					sortBy: 'startTime',
					sortDirection: 'desc',
					timeFromUnixNano: fromNs,
					timeToUnixNano: nowNs,
				});
				for (const row of page.rows) {
					for (const name of row.services) {
						const entry = overviewEntry(services, name);
						entry.traces++;
						entry.spans += row.spanCount;
						if (row.errorCount > 0) entry.errorTraces++;
						entry.durations.push(row.durationNanos);
					}
				}
				cursor = page.nextCursor;
			} while (cursor);

			const logs = await storage.listLogs({
				limit: 5_000,
				timeFromUnixNano: fromNs,
				timeToUnixNano: nowNs,
				includeTotalCount: false,
			});
			for (const log of logs.rows) {
				const name = log.resource.attributes['service.name'];
				if (typeof name !== 'string' || name === '') continue;
				const entry = overviewEntry(services, name);
				entry.logs++;
				const band = severityBand(log.severityNumber);
				entry.logSeverity[band] = (entry.logSeverity[band] ?? 0) + 1;
			}

			const metrics = await storage.listMetrics({ limit: 5_000, pointLimit: 1 });
			for (const metric of metrics.rows) {
				const name = metric.resource.attributes['service.name'];
				if (typeof name !== 'string' || name === '') continue;
				overviewEntry(services, name).metricInstruments++;
			}

			return [...services.entries()]
				.map(([name, entry]) => finalizeOverview(name, entry))
				.sort((a, b) => b.traces - a.traces || b.logs - a.logs || a.name.localeCompare(b.name));
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

interface MutableServiceOverview {
	traces: number;
	errorTraces: number;
	spans: number;
	durations: bigint[];
	logs: number;
	logSeverity: Record<string, number>;
	metricInstruments: number;
}

function overviewEntry(
	services: Map<string, MutableServiceOverview>,
	name: string,
): MutableServiceOverview {
	let entry = services.get(name);
	if (!entry) {
		entry = {
			traces: 0,
			errorTraces: 0,
			spans: 0,
			durations: [],
			logs: 0,
			logSeverity: {},
			metricInstruments: 0,
		};
		services.set(name, entry);
	}
	return entry;
}

function finalizeOverview(name: string, entry: MutableServiceOverview): ServiceOverviewRow {
	entry.durations.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const percentile = (p: number): bigint => {
		if (entry.durations.length === 0) return 0n;
		return (
			entry.durations[Math.min(entry.durations.length - 1, Math.floor(entry.durations.length * p))] ??
			0n
		);
	};
	return {
		name,
		traces: entry.traces,
		errorTraces: entry.errorTraces,
		spans: entry.spans,
		errorRate: entry.traces > 0 ? entry.errorTraces / entry.traces : 0,
		p50DurationNanos: percentile(0.5),
		p95DurationNanos: percentile(0.95),
		logs: entry.logs,
		logSeverity: entry.logSeverity,
		metricInstruments: entry.metricInstruments,
	};
}

function severityBand(number: number): string {
	if (number >= 21) return 'fatal';
	if (number >= 17) return 'error';
	if (number >= 13) return 'warn';
	if (number >= 9) return 'info';
	if (number >= 5) return 'debug';
	return 'trace';
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
