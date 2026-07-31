/**
 * `DataSource` is the load-bearing contract between `@otelux/ui` and any
 * backend (in-process engine, postMessage bridge, Tauri IPC). All adapters
 * implement the same interface so the UI is unaware of where data lives.
 */

import type { LogRecord, Metric, Span, SpanId, Trace, TraceId } from '@otelux/types';

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
	/** Application-level source (`service.namespace`, falling back to `service.name`). */
	sources?: readonly string[];
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
	traceId: TraceId;
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
	/** Application-level source (`service.namespace`, falling back to `service.name`). */
	sources?: readonly string[];
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
 * Query for the metrics page.
 *
 * Filters compose with AND; values inside an array compose with OR.
 * `services` filters by resource `service.name`; `meters` filters by
 * instrumentation-scope (meter) name; `search` matches the instrument
 * name/description. Unlike traces/logs there is no time window here yet —
 * the engine returns whole instruments (with all their buffered data
 * points) and the UI windows them client-side when charting.
 */
export interface ListMetricsQuery {
	limit?: number;
	offset?: number;
	/** Most-recent points returned per instrument. Defaults to 120; maximum 10,000. */
	pointLimit?: number;
	/** Application-level source (`service.namespace`, falling back to `service.name`). */
	sources?: readonly string[];
	services?: readonly string[];
	meters?: readonly string[];
	search?: string;
}

export interface ListMetricsResult {
	rows: readonly Metric[];
	totalCount: number;
}

export type TelemetrySignal = 'traces' | 'logs' | 'metrics';

export type ResourceFacetKind = 'source' | 'service';

export interface ListResourceFacetsQuery {
	signal: TelemetrySignal;
	facet: ResourceFacetKind;
	/** Restrict service facets to these application-level sources. */
	sources?: readonly string[];
	limit?: number;
}

export interface ResourceFacet {
	name: string;
	count: number;
}

export interface ListResourceFacetsResult {
	rows: readonly ResourceFacet[];
}

/**
 * Span detail view. Engines may return a richer object than `Span` here
 * if they have additional, denormalized info to surface (e.g. peer
 * resolution, derived metrics). Today it is just the span.
 */
export type SpanDetails = Span;

/**
 * Subscription event payload. Engines call `subscribe` with a handler
 * that fires whenever new data lands. UI uses this to refresh lists
 * without polling. ID arrays may be empty if many items were affected.
 */
export type ChangeEvent =
	| { kind: 'tracesChanged'; traceIds: readonly TraceId[] }
	| { kind: 'logsChanged'; count: number }
	| { kind: 'metricsChanged'; count: number };

export interface DataSource {
	readonly kind: 'otelux/datasource';
	listTraces(query: ListTracesQuery): Promise<ListTracesResult>;
	getTrace(query: GetTraceQuery): Promise<Trace>;
	getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails>;
	listLogs(query: ListLogsQuery): Promise<ListLogsResult>;
	listMetrics(query: ListMetricsQuery): Promise<ListMetricsResult>;
	listResourceFacets(query: ListResourceFacetsQuery): Promise<ListResourceFacetsResult>;
	subscribe(handler: (event: ChangeEvent) => void): Disposable;
}

/** User-controllable settings owned by the shared local runtime. */
export interface Settings {
	readonly version: 1;
	readonly otlp: {
		readonly port: number;
	};
	readonly mcp: {
		readonly enabled: boolean;
		readonly port: number;
	};
	readonly retention: {
		/** Drop telemetry older than this many hours. `0` disables the age limit. */
		readonly maxAgeHours: number;
		/** Prune oldest telemetry above this size. `0` disables the size limit. */
		readonly maxSizeMb: number;
	};
	readonly storage: {
		/** Absolute database path, or an empty string for the runtime default. */
		readonly dbPath: string;
	};
}

/** Patch accepted by the runtime settings update operation. */
export interface PartialSettings {
	readonly otlp?: {
		readonly port?: number;
	};
	readonly mcp?: {
		readonly enabled?: boolean;
		readonly port?: number;
	};
	readonly retention?: {
		readonly maxAgeHours?: number;
		readonly maxSizeMb?: number;
	};
	readonly storage?: {
		readonly dbPath?: string;
	};
}

export const DEFAULT_SETTINGS: Settings = {
	version: 1,
	otlp: { port: 4319 },
	mcp: { enabled: true, port: 4320 },
	retention: { maxAgeHours: 72, maxSizeMb: 512 },
	storage: { dbPath: '' },
};

export const MIN_PORT = 1;
export const MAX_PORT = 65_535;
export const MAX_RETENTION_AGE_HOURS = 43_800;
export const MAX_RETENTION_SIZE_MB = 1_048_576;

export interface StoragePathInfo {
	readonly activePath: string;
	readonly defaultPath: string;
}

/** Snapshot of the active SQLite store's retention budget and disk footprint. */
export interface StorageUsageInfo {
	readonly activePath: string;
	/** SQLite page bytes used by size-retention enforcement. */
	readonly retentionBytes: number;
	readonly databaseFileBytes: number;
	readonly walBytes: number;
	readonly sharedMemoryBytes: number;
	readonly totalBytes: number;
}

export interface LoadSampleDataResult {
	readonly traces: number;
	readonly logs: number;
	readonly metrics: number;
}

export type ReceiverStatus =
	| { readonly kind: 'starting' }
	| { readonly kind: 'running'; readonly port: number; readonly host: string }
	| {
			readonly kind: 'error';
			readonly port: number;
			readonly host: string;
			readonly message: string;
	  };

export type McpStatus =
	| { readonly kind: 'starting' }
	| { readonly kind: 'running'; readonly port: number; readonly host: string }
	| { readonly kind: 'disabled' }
	| {
			readonly kind: 'error';
			readonly port: number;
			readonly host: string;
			readonly message: string;
	  };

export type UpdateSettingsResult =
	| {
			readonly ok: true;
			readonly settings: Settings;
			readonly status: ReceiverStatus;
			readonly mcpStatus: McpStatus;
	  }
	| { readonly ok: false; readonly error: string };

/** Every event emitted by the shared runtime to its clients. */
export type RuntimeEvent =
	| ChangeEvent
	| { readonly kind: 'settings-changed'; readonly settings: Settings }
	| { readonly kind: 'receiver-status-changed'; readonly status: ReceiverStatus }
	| { readonly kind: 'mcp-status-changed'; readonly status: McpStatus };

export const OTELUX_PROTOCOL_VERSION = '0.5.0' as const;
