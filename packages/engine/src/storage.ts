import type {
	GetMetricPointsQuery,
	GetMetricPointsResult,
	ListLogsQuery,
	ListLogsResult,
	ListMetricInstrumentsQuery,
	ListMetricInstrumentsResult,
	ListMetricsQuery,
	ListMetricsResult,
	ListResourceFacetsQuery,
	ListResourceFacetsResult,
	ListTracesQuery,
	ListTracesResult,
	LogListResultRow,
} from '@otelux/protocol';
import type { AttributeValue, LogRecord, Metric, Span, SpanId, TraceId } from '@otelux/types';

/**
 * Pluggable storage backend. The engine is the only consumer; engine
 * users compose `createEngine({ storage: ... })`.
 *
 * Methods may return either sync or async. The engine adapts both.
 *
 * SQLite-backed implementations push filtering and sorting down to SQL;
 * the in-memory implementation walks an array. Either way, the engine
 * itself only orchestrates and notifies subscribers.
 */
export interface FullListLogsResult {
	readonly rows: readonly LogRecord[];
	readonly totalCount: number;
}

export interface Storage {
	readonly kind: 'otelux/storage';
	writeSpans(spans: readonly Span[]): Promise<void> | void;
	listTraces(query: ListTracesQuery): Promise<ListTracesResult> | ListTracesResult;
	getTraceSpans(traceId: TraceId): Promise<readonly Span[]> | readonly Span[];
	getSpan(traceId: TraceId, spanId: SpanId): Promise<Span | undefined> | Span | undefined;
	writeLogs(logs: readonly LogRecord[]): Promise<void> | void;
	listLogs(query: ListLogsQuery): Promise<ListLogsResult> | ListLogsResult;
	getLog(logId: string): Promise<LogRecord | undefined> | LogRecord | undefined;
	searchLogs(query: ListLogsQuery): Promise<FullListLogsResult> | FullListLogsResult;
	writeMetrics(metrics: readonly Metric[]): Promise<void> | void;
	listMetricInstruments(
		query: ListMetricInstrumentsQuery,
	): Promise<ListMetricInstrumentsResult> | ListMetricInstrumentsResult;
	getMetricPoints(
		query: GetMetricPointsQuery,
	): Promise<GetMetricPointsResult | undefined> | GetMetricPointsResult | undefined;
	listMetrics(query: ListMetricsQuery): Promise<ListMetricsResult> | ListMetricsResult;
	listResourceFacets(
		query: ListResourceFacetsQuery,
	): Promise<ListResourceFacetsResult> | ListResourceFacetsResult;
	/** Delete all stored telemetry (traces, logs, metrics) but keep the store open for reuse. */
	clear(): Promise<void> | void;
	close(): Promise<void> | void;
}

function attributeValueIncludes(value: AttributeValue, needle: string): boolean {
	if (Array.isArray(value)) {
		return value.some((v) => String(v).toLowerCase().includes(needle));
	}
	return String(value).toLowerCase().includes(needle);
}

/**
 * Free-text match over a log record. Searches body, event name, severity
 * text, and both attribute keys and values — the Codex workload carries
 * its content (prompt text, tool args) in attributes, not the body.
 */
function logMatchesText(log: LogRecord, needle: string): boolean {
	if (log.body !== undefined && attributeValueIncludes(log.body, needle)) {
		return true;
	}
	if (log.eventName?.toLowerCase().includes(needle)) {
		return true;
	}
	if (log.severityText?.toLowerCase().includes(needle)) {
		return true;
	}
	for (const [key, value] of Object.entries(log.attributes)) {
		if (key.toLowerCase().includes(needle) || attributeValueIncludes(value, needle)) {
			return true;
		}
	}
	return false;
}

const MAX_LOG_LIST_MESSAGE_LENGTH = 4_096;

function logMessage(log: LogRecord): string {
	let value: AttributeValue | undefined;
	if (typeof log.body === 'string' && log.body !== '') value = log.body;
	else if (log.body !== undefined && !Array.isArray(log.body)) value = log.body;
	else value = log.attributes.message ?? log.attributes['event.name'] ?? log.attributes.prompt;
	const rendered =
		value !== undefined
			? Array.isArray(value)
				? value.map(String).join(', ')
				: String(value)
			: (log.eventName ?? '(no message)');
	return rendered.slice(0, MAX_LOG_LIST_MESSAGE_LENGTH);
}

function logListRow(log: LogRecord, logId: string): LogListResultRow {
	const serviceName = resourceServiceName(log.resource);
	return {
		logId,
		timeUnixNano: log.timeUnixNano,
		severityNumber: log.severityNumber,
		...(log.severityText !== undefined ? { severityText: log.severityText } : {}),
		...(log.eventName !== undefined ? { eventName: log.eventName } : {}),
		message: logMessage(log),
		...(serviceName !== '' ? { serviceName } : {}),
		...(log.traceId !== undefined ? { traceId: log.traceId } : {}),
		...(log.spanId !== undefined ? { spanId: log.spanId } : {}),
	};
}

/**
 * Resource `service.name` for an instrument, or `''` when unset. Used as
 * part of the instrument identity and for the `services` filter.
 */
function resourceServiceName(resource: {
	attributes: Readonly<Record<string, AttributeValue>>;
}): string {
	const service = resource.attributes['service.name'];
	return typeof service === 'string' ? service : '';
}

/** Application-level source: explicit OTel namespace, then exact service fallback. */
function resourceSourceName(resource: {
	attributes: Readonly<Record<string, AttributeValue>>;
}): string {
	const namespace = resource.attributes['service.namespace'];
	return typeof namespace === 'string' && namespace !== ''
		? namespace
		: resourceServiceName(resource);
}

function metricServiceName(metric: Metric): string {
	return resourceServiceName(metric.resource);
}

/**
 * Stable identity for an instrument across OTLP exports: same service +
 * meter (scope) + instrument name + kind = the same time series. Codex
 * re-exports the same instruments every interval with fresh delta data
 * points, so merging on this key turns a stream of exports into one
 * growing series the chart can plot. NUL is used as the separator because
 * it cannot appear in any of the component strings.
 */
function metricIdentity(metric: Metric): string {
	return `${resourceSourceName(metric.resource)}\u0000${metricServiceName(metric)}\u0000${metric.scope.name}\u0000${metric.name}\u0000${metric.type}`;
}

/**
 * Per-instrument data-point cap. Keeps memory bounded under a long-running
 * exporter — we retain the most recent points (the tail), matching the
 * bounded-ingest stance in spec.md §10.
 */
const MAX_POINTS_PER_INSTRUMENT = 10_000;

function tail<T>(items: readonly T[], cap: number): T[] {
	return items.length > cap ? items.slice(items.length - cap) : [...items];
}

/**
 * Merge a freshly-decoded export of an instrument into the one already
 * held in storage. Identity guarantees both share a `type`; spreading
 * `incoming` last keeps the newest metadata (description, unit,
 * temporality, monotonicity) while concatenating data points.
 */
function limitMetricPoints(metric: Metric, limit: number): Metric {
	if (metric.type === 'histogram') {
		return { ...metric, dataPoints: tail(metric.dataPoints, limit) };
	}
	if (metric.type === 'gauge') {
		return { ...metric, dataPoints: tail(metric.dataPoints, limit) };
	}
	return { ...metric, dataPoints: tail(metric.dataPoints, limit) };
}

function latestPoint<T extends { readonly timeUnixNano: bigint }>(
	points: readonly T[],
): T | undefined {
	return points.reduce<T | undefined>(
		(current, point) =>
			current === undefined || point.timeUnixNano > current.timeUnixNano ? point : current,
		undefined,
	);
}

function metricInstrumentSummary(
	metric: Metric,
	instrumentId: string,
): ListMetricInstrumentsResult['rows'][number] {
	const sourceName = resourceSourceName(metric.resource);
	const serviceName = metricServiceName(metric);
	const base = {
		instrumentId,
		name: metric.name,
		...(metric.description !== undefined ? { description: metric.description } : {}),
		...(metric.unit !== undefined ? { unit: metric.unit } : {}),
		type: metric.type,
		...(sourceName !== '' ? { sourceName } : {}),
		...(serviceName !== '' ? { serviceName } : {}),
		meterName: metric.scope.name,
		pointCount: metric.dataPoints.length,
	};
	if (metric.type === 'histogram') {
		const latest = latestPoint(metric.dataPoints);
		return {
			...base,
			temporality: metric.temporality,
			...(latest !== undefined
				? {
						latest: {
							kind: 'histogram' as const,
							timeUnixNano: latest.timeUnixNano,
							count: latest.count,
							...(latest.sum !== undefined ? { sum: latest.sum } : {}),
						},
					}
				: {}),
		};
	}
	const latest = latestPoint(metric.dataPoints);
	return {
		...base,
		...(metric.type === 'sum'
			? { isMonotonic: metric.isMonotonic, temporality: metric.temporality }
			: {}),
		...(latest !== undefined
			? {
					latest: {
						kind: 'number' as const,
						timeUnixNano: latest.timeUnixNano,
						value: latest.value,
					},
				}
			: {}),
	};
}

function replaceMetricPoints(
	metric: Metric,
	points: readonly Metric['dataPoints'][number][],
): Metric {
	if (metric.type === 'histogram') {
		return { ...metric, dataPoints: points as typeof metric.dataPoints };
	}
	if (metric.type === 'gauge') {
		return { ...metric, dataPoints: points as typeof metric.dataPoints };
	}
	return { ...metric, dataPoints: points as typeof metric.dataPoints };
}

function mergeMetric(existing: Metric, incoming: Metric): Metric {
	if (existing.type !== incoming.type) {
		// Identity collision across kinds (should not happen — `type` is part
		// of the key). Prefer the incoming reading.
		return incoming;
	}
	if (incoming.type === 'histogram') {
		const prev = existing as typeof incoming;
		return {
			...incoming,
			dataPoints: tail([...prev.dataPoints, ...incoming.dataPoints], MAX_POINTS_PER_INSTRUMENT),
		};
	}
	const prev = existing as typeof incoming;
	return {
		...incoming,
		dataPoints: tail([...prev.dataPoints, ...incoming.dataPoints], MAX_POINTS_PER_INSTRUMENT),
	};
}

/**
 * In-memory storage. Used for tests, small embedded workloads, and behavioral
 * parity checks against SQLite. Sorting and filtering are O(n) walks; the
 * production backend is `@otelux/engine-node`.
 */
export function createMemoryStorage(): Storage {
	// Index by traceId, then spanId. OTLP span IDs are unique only within a
	// trace, and repeated exports replace the same logical span.
	const byTrace = new Map<TraceId, Map<SpanId, Span>>();
	// Logs are a flat append-only list; filtering/sorting is an O(n) walk,
	// matching the span path. The production backend pushes this into SQL.
	const logs: LogRecord[] = [];
	const logIds = new WeakMap<LogRecord, number>();
	const logsById = new Map<number, LogRecord>();
	let nextLogId = 1;
	// Metrics are merged by instrument identity so repeated exports of the
	// same instrument grow one time series rather than piling up duplicates.
	const metrics = new Map<string, Metric>();
	const metricIds = new Map<string, number>();
	const metricKeysById = new Map<number, string>();
	const metricPointIds = new WeakMap<object, number>();
	let nextMetricId = 1;
	let nextMetricPointId = 1;

	function rowFromTrace(spans: readonly Span[]):
		| {
				traceId: TraceId;
				rootName: string;
				startTimeUnixNano: bigint;
				durationNanos: bigint;
				services: readonly string[];
				sources: readonly string[];
				spanCount: number;
				errorCount: number;
		  }
		| undefined {
		if (spans.length === 0) {
			return undefined;
		}
		const first = spans[0];
		if (!first) {
			return undefined;
		}
		// Root span: parent missing from the trace span set. Fallback to
		// the earliest span if no clear root (broken parent chain).
		const idSet = new Set(spans.map((s) => s.spanId));
		const roots = spans.filter((s) => !s.parentSpanId || !idSet.has(s.parentSpanId));
		let root: Span = roots[0] ?? first;
		if (roots.length === 0) {
			let earliest = first;
			for (let i = 1; i < spans.length; i++) {
				const s = spans[i];
				if (s && s.startTimeUnixNano < earliest.startTimeUnixNano) {
					earliest = s;
				}
			}
			root = earliest;
		}
		let start = first.startTimeUnixNano;
		let end = first.endTimeUnixNano;
		const services = new Set<string>();
		const sources = new Set<string>();
		let errorCount = 0;
		for (const s of spans) {
			if (s.startTimeUnixNano < start) {
				start = s.startTimeUnixNano;
			}
			if (s.endTimeUnixNano > end) {
				end = s.endTimeUnixNano;
			}
			const service = resourceServiceName(s.resource);
			const source = resourceSourceName(s.resource);
			if (service) services.add(service);
			if (source) sources.add(source);
			if (s.status.code === 2 /* Error */) {
				errorCount++;
			}
		}
		return {
			traceId: root.traceId,
			rootName: root.name,
			startTimeUnixNano: start,
			durationNanos: end - start,
			services: [...services],
			sources: [...sources],
			spanCount: spans.length,
			errorCount,
		};
	}

	return {
		kind: 'otelux/storage',

		writeSpans(spans: readonly Span[]): void {
			for (const span of spans) {
				const traceSpans = byTrace.get(span.traceId);
				if (traceSpans) {
					traceSpans.set(span.spanId, span);
				} else {
					byTrace.set(span.traceId, new Map([[span.spanId, span]]));
				}
			}
		},

		listTraces(query: ListTracesQuery): ListTracesResult {
			const rows: NonNullable<ReturnType<typeof rowFromTrace>>[] = [];
			for (const spans of byTrace.values()) {
				const row = rowFromTrace([...spans.values()]);
				if (row) {
					rows.push(row);
				}
			}

			// Filters.
			const filtered = rows.filter((row) => {
				if (query.timeFromUnixNano !== undefined && row.startTimeUnixNano < query.timeFromUnixNano) {
					return false;
				}
				if (query.timeToUnixNano !== undefined && row.startTimeUnixNano >= query.timeToUnixNano) {
					return false;
				}
				if (query.hasError === true && row.errorCount === 0) {
					return false;
				}
				if (query.hasError === false && row.errorCount > 0) {
					return false;
				}
				if (query.sources && query.sources.length > 0) {
					const set = new Set(query.sources);
					if (!row.sources.some((source) => set.has(source))) return false;
				}
				if (query.services && query.services.length > 0) {
					const set = new Set(query.services);
					if (!row.services.some((s) => set.has(s))) {
						return false;
					}
				}
				if (query.search) {
					const needle = query.search.toLowerCase();
					const haystack = `${row.rootName} ${row.services.join(' ')}`.toLowerCase();
					if (!haystack.includes(needle)) {
						return false;
					}
				}
				return true;
			});

			// Sort. Default: startTime desc (most recent first).
			const sortBy = query.sortBy ?? 'startTime';
			const direction = query.sortDirection ?? (sortBy === 'startTime' ? 'desc' : 'asc');
			const cmpDir = direction === 'asc' ? 1 : -1;
			filtered.sort((a, b) => {
				let cmp = 0;
				switch (sortBy) {
					case 'startTime':
						cmp =
							a.startTimeUnixNano < b.startTimeUnixNano
								? -1
								: a.startTimeUnixNano > b.startTimeUnixNano
									? 1
									: 0;
						break;
					case 'duration':
						cmp = a.durationNanos < b.durationNanos ? -1 : a.durationNanos > b.durationNanos ? 1 : 0;
						break;
					case 'name':
						cmp = a.rootName.localeCompare(b.rootName);
						break;
					case 'spanCount':
						cmp = a.spanCount - b.spanCount;
						break;
					case 'errorCount':
						cmp = a.errorCount - b.errorCount;
						break;
				}
				if (cmp !== 0) return cmp * cmpDir;
				return a.traceId.localeCompare(b.traceId) * cmpDir;
			});

			const totalCount = filtered.length;
			const cursorIndex = query.cursor
				? filtered.findIndex((row) => row.traceId === query.cursor)
				: -1;
			const offset = cursorIndex >= 0 ? cursorIndex + 1 : (query.offset ?? 0);
			const limit = query.limit ?? 100;
			const page = filtered.slice(offset, offset + limit);
			const nextCursor = offset + page.length < filtered.length ? page.at(-1)?.traceId : undefined;

			return {
				rows: page,
				totalCount: query.includeTotalCount === false ? page.length : totalCount,
				...(query.includeTotalCount === false ? { totalCountIsExact: false } : {}),
				...(nextCursor ? { nextCursor } : {}),
			};
		},

		getTraceSpans(traceId: TraceId): readonly Span[] {
			return [...(byTrace.get(traceId)?.values() ?? [])];
		},

		getSpan(traceId: TraceId, spanId: SpanId): Span | undefined {
			return byTrace.get(traceId)?.get(spanId);
		},

		writeLogs(records: readonly LogRecord[]): void {
			for (const record of records) {
				const id = nextLogId++;
				logIds.set(record, id);
				logsById.set(id, record);
				logs.push(record);
			}
		},

		listLogs(query: ListLogsQuery): ListLogsResult {
			const filtered = logs.filter((log) => {
				if (query.timeFromUnixNano !== undefined && log.timeUnixNano < query.timeFromUnixNano) {
					return false;
				}
				if (query.timeToUnixNano !== undefined && log.timeUnixNano >= query.timeToUnixNano) {
					return false;
				}
				if (query.minSeverity !== undefined && log.severityNumber < query.minSeverity) {
					return false;
				}
				if (query.traceId !== undefined && log.traceId !== query.traceId) {
					return false;
				}
				if (
					query.sources &&
					query.sources.length > 0 &&
					!query.sources.includes(resourceSourceName(log.resource))
				) {
					return false;
				}
				if (query.services && query.services.length > 0) {
					const svc = log.resource.attributes['service.name'];
					if (typeof svc !== 'string' || !query.services.includes(svc)) {
						return false;
					}
				}
				if (query.scopes && query.scopes.length > 0 && !query.scopes.includes(log.scope.name)) {
					return false;
				}
				if (query.search) {
					// Search body AND attribute values — Codex content (prompt,
					// tool args) lives in attributes, not the body.
					const needle = query.search.toLowerCase();
					if (!logMatchesText(log, needle)) {
						return false;
					}
				}
				return true;
			});

			// Sort. Default: time desc (most recent first).
			const sortBy = query.sortBy ?? 'time';
			const direction = query.sortDirection ?? 'desc';
			const cmpDir = direction === 'asc' ? 1 : -1;
			filtered.sort((a, b) => {
				let cmp = 0;
				if (sortBy === 'severity') {
					cmp = a.severityNumber - b.severityNumber;
				} else {
					cmp = a.timeUnixNano < b.timeUnixNano ? -1 : a.timeUnixNano > b.timeUnixNano ? 1 : 0;
				}
				if (cmp !== 0) return cmp * cmpDir;
				return ((logIds.get(a) ?? 0) - (logIds.get(b) ?? 0)) * cmpDir;
			});

			const totalCount = filtered.length;
			const cursorId = query.cursor ? Number(query.cursor) : undefined;
			const cursorIndex = cursorId ? filtered.findIndex((log) => logIds.get(log) === cursorId) : -1;
			const offset = cursorIndex >= 0 ? cursorIndex + 1 : (query.offset ?? 0);
			const limit = query.limit ?? 100;
			const page = filtered.slice(offset, offset + limit);
			const nextCursor =
				offset + page.length < filtered.length
					? String(logIds.get(page.at(-1) as LogRecord))
					: undefined;

			return {
				rows: page.map((log) => logListRow(log, String(logIds.get(log)))),
				totalCount: query.includeTotalCount === false ? page.length : totalCount,
				...(query.includeTotalCount === false ? { totalCountIsExact: false } : {}),
				...(nextCursor ? { nextCursor } : {}),
			};
		},

		getLog(logId: string): LogRecord | undefined {
			return /^\d+$/.test(logId) ? logsById.get(Number(logId)) : undefined;
		},

		searchLogs(query: ListLogsQuery): FullListLogsResult {
			const listed = this.listLogs(query) as ListLogsResult;
			return {
				rows: listed.rows.flatMap((row) => {
					const log = logsById.get(Number(row.logId));
					return log ? [log] : [];
				}),
				totalCount: listed.totalCount,
			};
		},

		writeMetrics(incoming: readonly Metric[]): void {
			for (const metric of incoming) {
				for (const point of metric.dataPoints) {
					if (!metricPointIds.has(point)) metricPointIds.set(point, nextMetricPointId++);
				}
				const key = metricIdentity(metric);
				const existing = metrics.get(key);
				if (!metricIds.has(key)) {
					const id = nextMetricId++;
					metricIds.set(key, id);
					metricKeysById.set(id, key);
				}
				metrics.set(key, existing ? mergeMetric(existing, metric) : metric);
			}
		},

		listMetricInstruments(query: ListMetricInstrumentsQuery): ListMetricInstrumentsResult {
			const result = this.listMetrics({ ...query, pointLimit: 1 }) as ListMetricsResult;
			return {
				rows: result.rows.map((metric) => {
					const key = metricIdentity(metric);
					return metricInstrumentSummary(metrics.get(key) ?? metric, String(metricIds.get(key)));
				}),
				totalCount: result.totalCount,
			};
		},

		getMetricPoints(query: GetMetricPointsQuery): GetMetricPointsResult | undefined {
			if (!/^\d+$/.test(query.instrumentId)) return undefined;
			const key = metricKeysById.get(Number(query.instrumentId));
			const metric = key ? metrics.get(key) : undefined;
			if (!metric) return undefined;
			const limit = Math.max(1, Math.min(query.limit ?? 120, 1_000));
			const cursor = query.cursor ? /^(\d+):(\d+)$/.exec(query.cursor) : undefined;
			const cursorTime = cursor ? BigInt(cursor[1] as string) : undefined;
			const cursorId = cursor ? Number(cursor[2]) : undefined;
			const ordered = [...metric.dataPoints]
				.sort((a, b) => {
					if (a.timeUnixNano !== b.timeUnixNano) return a.timeUnixNano > b.timeUnixNano ? -1 : 1;
					return (metricPointIds.get(b) ?? 0) - (metricPointIds.get(a) ?? 0);
				})
				.filter((point) => {
					if (cursorTime === undefined || cursorId === undefined) return true;
					const id = metricPointIds.get(point) ?? 0;
					return point.timeUnixNano < cursorTime || (point.timeUnixNano === cursorTime && id < cursorId);
				});
			const candidates = ordered.slice(0, limit + 1);
			const hasMore = candidates.length > limit;
			const descendingPage = candidates.slice(0, limit);
			const last = descendingPage.at(-1);
			const page = [...descendingPage].reverse();
			return {
				metric: replaceMetricPoints(metric, page),
				totalPointCount: metric.dataPoints.length,
				...(hasMore && last
					? { nextCursor: `${last.timeUnixNano}:${metricPointIds.get(last) ?? 0}` }
					: {}),
			};
		},

		listMetrics(query: ListMetricsQuery): ListMetricsResult {
			const filtered = [...metrics.values()].filter((metric) => {
				if (
					query.sources &&
					query.sources.length > 0 &&
					!query.sources.includes(resourceSourceName(metric.resource))
				) {
					return false;
				}
				if (query.services && query.services.length > 0) {
					if (!query.services.includes(metricServiceName(metric))) {
						return false;
					}
				}
				if (query.meters && query.meters.length > 0 && !query.meters.includes(metric.scope.name)) {
					return false;
				}
				if (query.search) {
					const needle = query.search.toLowerCase();
					const haystack = `${metric.name} ${metric.description ?? ''}`.toLowerCase();
					if (!haystack.includes(needle)) {
						return false;
					}
				}
				return true;
			});

			// Stable, human-friendly ordering: meter, then instrument name.
			filtered.sort(
				(a, b) => a.scope.name.localeCompare(b.scope.name) || a.name.localeCompare(b.name),
			);

			const totalCount = filtered.length;
			const offset = query.offset ?? 0;
			const limit = query.limit ?? 500;
			const pointLimit = Math.max(1, Math.min(query.pointLimit ?? 120, MAX_POINTS_PER_INSTRUMENT));
			const page = filtered
				.slice(offset, offset + limit)
				.map((metric) => limitMetricPoints(metric, pointLimit));

			return { rows: page, totalCount };
		},

		listResourceFacets(query: ListResourceFacetsQuery): ListResourceFacetsResult {
			const counts = new Map<string, number>();
			const add = (name: string): void => {
				if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
			};
			const includedSource = (source: string): boolean =>
				!query.sources || query.sources.length === 0 || query.sources.includes(source);
			const facetName = (resource: {
				attributes: Readonly<Record<string, AttributeValue>>;
			}): string =>
				query.facet === 'source' ? resourceSourceName(resource) : resourceServiceName(resource);
			if (query.signal === 'traces') {
				for (const spans of byTrace.values()) {
					const names = new Set<string>();
					for (const span of spans.values()) {
						if (includedSource(resourceSourceName(span.resource))) names.add(facetName(span.resource));
					}
					for (const name of names) add(name);
				}
			} else if (query.signal === 'logs') {
				for (const log of logs) {
					if (includedSource(resourceSourceName(log.resource))) add(facetName(log.resource));
				}
			} else {
				for (const metric of metrics.values()) {
					if (includedSource(resourceSourceName(metric.resource))) add(facetName(metric.resource));
				}
			}
			const limit = Math.max(1, Math.min(query.limit ?? 500, 1000));
			return {
				rows: [...counts.entries()]
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
					.slice(0, limit)
					.map(([name, count]) => ({ name, count })),
			};
		},

		clear(): void {
			byTrace.clear();
			logs.length = 0;
			logsById.clear();
			metrics.clear();
			metricIds.clear();
			metricKeysById.clear();
		},

		close(): void {
			byTrace.clear();
			logs.length = 0;
			logsById.clear();
			metrics.clear();
			metricIds.clear();
			metricKeysById.clear();
		},
	};
}

// Re-export for query helpers — not part of the public API.
export type { GetSpanDetailsQuery, GetTraceQuery } from '@otelux/protocol';
