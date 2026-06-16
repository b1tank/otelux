/**
 * `DataSource` is the load-bearing contract between `@otelux/ui` and any
 * backend (in-process engine, postMessage bridge, Tauri IPC). All adapters
 * implement the same interface so the UI is unaware of where data lives.
 */

import type { LogRecord, Span, SpanId, Trace, TraceId } from '@otelux/types';

export interface Disposable {
	dispose(): void;
}

export type SortDirection = 'asc' | 'desc';

export type TraceListSort = 'startTime' | 'name' | 'duration' | 'spanCount' | 'errorCount';

/**
 * Query for the trace list page.
 *
 * Time windows are inclusive on `from`, exclusive on `to`. Free-text
 * `search` matches against the root span name and resource service names.
 * Filters compose with AND; values inside an array compose with OR.
 */
export interface ListTracesQuery {
	limit?: number;
	offset?: number;
	sortBy?: TraceListSort;
	sortDirection?: SortDirection;
	timeFromUnixNano?: bigint;
	timeToUnixNano?: bigint;
	services?: readonly string[];
	hasError?: boolean;
	search?: string;
}

export interface ListTracesResultRow {
	traceId: TraceId;
	rootName: string;
	startTimeUnixNano: bigint;
	durationNanos: bigint;
	services: readonly string[];
	spanCount: number;
	errorCount: number;
}

export interface ListTracesResult {
	rows: readonly ListTracesResultRow[];
	totalCount: number;
}

export interface GetTraceQuery {
	traceId: TraceId;
}

export interface GetSpanDetailsQuery {
	spanId: SpanId;
}

export type LogListSort = 'time' | 'severity';

/**
 * Query for the structured-logs page.
 *
 * Time windows are inclusive on `from`, exclusive on `to`. `minSeverity`
 * filters by OTLP severity number (>=). Free-text `search` matches the
 * body **and attribute values** — the Codex workload puts its content
 * (prompt text, tool args) in attributes, not the body. Filters compose
 * with AND; values inside an array compose with OR.
 */
export interface ListLogsQuery {
	limit?: number;
	offset?: number;
	sortBy?: LogListSort;
	sortDirection?: SortDirection;
	timeFromUnixNano?: bigint;
	timeToUnixNano?: bigint;
	minSeverity?: number;
	services?: readonly string[];
	scopes?: readonly string[];
	traceId?: TraceId;
	search?: string;
}

export interface ListLogsResult {
	rows: readonly LogRecord[];
	totalCount: number;
}

/**
 * Span detail view. Engines may return a richer object than `Span` here
 * if they have additional, denormalized info to surface (e.g. peer
 * resolution, derived metrics). For Milestone 1 it is just the span.
 */
export type SpanDetails = Span;

/**
 * Subscription event payload. Engines call `subscribe` with a handler
 * that fires whenever new data lands. UI uses this to refresh lists
 * without polling. ID arrays may be empty if many items were affected.
 */
export type ChangeEvent =
	| { kind: 'tracesChanged'; traceIds: readonly TraceId[] }
	| { kind: 'logsChanged'; count: number };

export interface DataSource {
	readonly kind: 'otelux/datasource';
	listTraces(query: ListTracesQuery): Promise<ListTracesResult>;
	getTrace(query: GetTraceQuery): Promise<Trace>;
	getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails>;
	listLogs(query: ListLogsQuery): Promise<ListLogsResult>;
	subscribe(handler: (event: ChangeEvent) => void): Disposable;
}

export const OTELUX_PROTOCOL_VERSION = '0.1.0' as const;
