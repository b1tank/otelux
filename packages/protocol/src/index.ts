/**
 * `DataSource` is the load-bearing contract between `@otelux/ui` and any
 * backend (in-process engine, postMessage bridge, Tauri IPC). All adapters
 * implement the same interface so the UI is unaware of where data lives.
 */

import type {
	AggregationTemporality,
	LogRecord,
	Metric,
	Span,
	SpanId,
	Trace,
	TraceId,
} from '@otelux/types';

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
	/** Opaque trace-id cursor returned as nextCursor by the previous page. */
	cursor?: string;
	/** Set false to skip the exact COUNT query on live-tail pages. Defaults true. */
	includeTotalCount?: boolean;
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
	/** False means totalCount is the returned page size, not a full filtered count. */
	totalCountIsExact?: boolean;
	nextCursor?: string;
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
	/** Opaque log cursor returned as nextCursor by the previous page. */
	cursor?: string;
	/** Set false to skip the exact COUNT query on live-tail pages. Defaults true. */
	includeTotalCount?: boolean;
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

export interface LogListResultRow {
	/** Opaque storage identity used only to load this record's details. */
	logId: string;
	timeUnixNano: bigint;
	severityNumber: number;
	severityText?: string;
	eventName?: string;
	/** Bounded display value derived from body/message/event attributes. */
	message: string;
	serviceName?: string;
	traceId?: TraceId;
	spanId?: SpanId;
}

export interface ListLogsResult {
	rows: readonly LogListResultRow[];
	totalCount: number;
	totalCountIsExact?: boolean;
	nextCursor?: string;
}

export interface GetLogDetailsQuery {
	logId: string;
}

export type LogDetails = LogRecord;

/** Shared filters for metric instrument discovery. */
export interface ListMetricInstrumentsQuery {
	limit?: number;
	offset?: number;
	/** Application-level source (`service.namespace`, falling back to `service.name`). */
	sources?: readonly string[];
	services?: readonly string[];
	meters?: readonly string[];
	search?: string;
}

export type MetricLatestValue =
	| { readonly kind: 'number'; readonly timeUnixNano: bigint; readonly value: number }
	| {
			readonly kind: 'histogram';
			readonly timeUnixNano: bigint;
			readonly count: number;
			readonly sum?: number;
	  };

export interface MetricInstrumentSummary {
	/** Opaque storage identity used only with getMetricPoints. */
	instrumentId: string;
	name: string;
	description?: string;
	unit?: string;
	type: Metric['type'];
	isMonotonic?: boolean;
	temporality?: AggregationTemporality;
	sourceName?: string;
	serviceName?: string;
	meterName: string;
	pointCount: number;
	latest?: MetricLatestValue;
}

export interface ListMetricInstrumentsResult {
	rows: readonly MetricInstrumentSummary[];
	totalCount: number;
}

export interface GetMetricPointsQuery {
	instrumentId: string;
	/** Most-recent points to return. Defaults to 120; maximum 1,000. */
	limit?: number;
	/** Opaque continuation returned by the previous point page. */
	cursor?: string;
}

export interface TruncatedMetricPointAttributes {
	pointIndex: number;
	truncatedOrOmittedAttributeCount: number;
}

export interface GetMetricPointsResult {
	metric: Metric;
	totalPointCount: number;
	nextCursor?: string;
	truncatedAttributes?: readonly TruncatedMetricPointAttributes[];
	resourceAttributesTruncated?: number;
	scopeAttributesTruncated?: number;
	metadataTruncated?: boolean;
	histogramBucketsTruncated?: readonly number[];
}

/** Internal engine query retained for bounded MCP/service composition. */
export interface ListMetricsQuery extends ListMetricInstrumentsQuery {
	/** Most-recent points returned per instrument. Defaults to 120; maximum 10,000. */
	pointLimit?: number;
}

/** Internal engine result retained for bounded MCP/service composition. */
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

export type InvokeMessage =
	| { kind: 'listTraces'; query: ListTracesQuery }
	| { kind: 'getTrace'; query: GetTraceQuery }
	| { kind: 'getTraceWaterfall'; query: GetTraceQuery }
	| { kind: 'getSpanDetails'; query: GetSpanDetailsQuery }
	| { kind: 'listLogs'; query: ListLogsQuery }
	| { kind: 'getLogDetails'; query: GetLogDetailsQuery }
	| { kind: 'listMetricInstruments'; query: ListMetricInstrumentsQuery }
	| { kind: 'getMetricPoints'; query: GetMetricPointsQuery }
	| { kind: 'listResourceFacets'; query: ListResourceFacetsQuery }
	| { kind: 'getSettings' }
	| { kind: 'updateSettings'; patch: PartialSettings }
	| { kind: 'getReceiverStatus' }
	| { kind: 'getMcpStatus' }
	| { kind: 'getStoragePath' }
	| { kind: 'getStorageUsage' }
	| { kind: 'loadSampleData' }
	| { kind: 'clearData' };

export type InvokeResultFor<M extends InvokeMessage> = M extends { kind: 'listTraces' }
	? ListTracesResult
	: M extends { kind: 'getTrace' | 'getTraceWaterfall' }
		? Trace
		: M extends { kind: 'getSpanDetails' }
			? SpanDetails
			: M extends { kind: 'listLogs' }
				? ListLogsResult
				: M extends { kind: 'getLogDetails' }
					? LogDetails
					: M extends { kind: 'listMetricInstruments' }
						? ListMetricInstrumentsResult
						: M extends { kind: 'getMetricPoints' }
							? GetMetricPointsResult
							: M extends { kind: 'listResourceFacets' }
								? ListResourceFacetsResult
								: M extends { kind: 'getSettings' }
									? Settings
									: M extends { kind: 'updateSettings' }
										? UpdateSettingsResult
										: M extends { kind: 'getReceiverStatus' }
											? ReceiverStatus
											: M extends { kind: 'getMcpStatus' }
												? McpStatus
												: M extends { kind: 'getStoragePath' }
													? StoragePathInfo
													: M extends { kind: 'getStorageUsage' }
														? StorageUsageInfo
														: M extends { kind: 'loadSampleData' }
															? LoadSampleDataResult
															: M extends { kind: 'clearData' }
																? undefined
																: never;

export interface DataSource {
	readonly kind: 'otelux/datasource';
	listTraces(query: ListTracesQuery): Promise<ListTracesResult>;
	getTrace(query: GetTraceQuery): Promise<Trace>;
	/** Lightweight trace for waterfall rendering; full span bags load through getSpanDetails. */
	getTraceWaterfall?(query: GetTraceQuery): Promise<Trace>;
	getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails>;
	listLogs(query: ListLogsQuery): Promise<ListLogsResult>;
	getLogDetails(query: GetLogDetailsQuery): Promise<LogDetails>;
	listMetricInstruments(query: ListMetricInstrumentsQuery): Promise<ListMetricInstrumentsResult>;
	getMetricPoints(query: GetMetricPointsQuery): Promise<GetMetricPointsResult>;
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

export interface ReceiverPressure {
	readonly overloadedTraces: number;
	readonly overloadedLogs: number;
	readonly overloadedMetrics: number;
}

export type ReceiverStatus =
	| { readonly kind: 'starting' }
	| {
			readonly kind: 'running';
			readonly port: number;
			readonly host: string;
			readonly pressure?: ReceiverPressure;
	  }
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

export type RuntimeApiStatus =
	| { readonly kind: 'starting' }
	| { readonly kind: 'running'; readonly host: string; readonly port: number }
	| {
			readonly kind: 'error';
			readonly host: string;
			readonly port: number;
			readonly message: string;
	  };

export interface RuntimeLockOwner {
	readonly version: 1;
	readonly instanceId: string;
	readonly pid: number;
	readonly acquiredAt: string;
}

export interface RuntimeState {
	readonly version: 1;
	readonly runtimeVersion: string;
	readonly protocolVersion: string;
	readonly instanceId: string;
	readonly pid: number;
	readonly startedAt: string;
	readonly dataDirectory: string;
	readonly databasePath: string;
	readonly mcpTokenFile: string;
	readonly runtimeTokenFile?: string;
	readonly receiver: ReceiverStatus;
	readonly mcp: McpStatus;
	readonly api?: RuntimeApiStatus;
}

/** Every event emitted by the shared runtime to its clients. */
export type RuntimeEvent =
	| ChangeEvent
	| { readonly kind: 'settings-changed'; readonly settings: Settings }
	| { readonly kind: 'receiver-status-changed'; readonly status: ReceiverStatus }
	| { readonly kind: 'mcp-status-changed'; readonly status: McpStatus }
	| { readonly kind: 'api-status-changed'; readonly status: RuntimeApiStatus };

export const OTELUX_PROTOCOL_VERSION = '0.6.0' as const;

export * from './runtimeEvents.js';
export * from './runtimeRpc.js';
export * from './validation.js';
export * from './wire.js';
