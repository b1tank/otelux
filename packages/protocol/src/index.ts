/**
 * `DataSource` is the load-bearing contract between `@otelux/ui` and any
 * backend (in-process engine, postMessage bridge, Tauri IPC). All adapters
 * implement the same interface so the UI is unaware of where data lives.
 */

import type { Span, SpanId, Trace, TraceId } from '@otelux/types';

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

/**
 * Span detail view. Engines may return a richer object than `Span` here
 * if they have additional, denormalized info to surface (e.g. peer
 * resolution, derived metrics). For Milestone 1 it is just the span.
 */
export type SpanDetails = Span;

/**
 * Subscription event payload. Engines call `subscribe` with a handler
 * that fires whenever new spans land. UI uses this to refresh the list
 * without polling. `traceIds` may be empty if many traces were affected.
 */
export interface ChangeEvent {
	kind: 'tracesChanged';
	traceIds: readonly TraceId[];
}

export interface DataSource {
	readonly kind: 'otelux/datasource';
	listTraces(query: ListTracesQuery): Promise<ListTracesResult>;
	getTrace(query: GetTraceQuery): Promise<Trace>;
	getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails>;
	subscribe(handler: (event: ChangeEvent) => void): Disposable;
}

export const OTELUX_PROTOCOL_VERSION = '0.1.0' as const;
