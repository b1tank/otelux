import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ListTracesQuery, ListTracesResult, ListTracesResultRow } from '@otelux/protocol';
import type {
	InstrumentationScope,
	Resource,
	Span,
	SpanId,
	SpanKind,
	SpanStatusCode,
	TraceId,
} from '@otelux/types';
import { decodeAttributes, decodeJson, encodeAttributes, encodeJson } from './attributes.js';
import type { Interner } from './intern.js';
import { serviceNameOf, sourceNameOf } from './resource.js';

/** Columns selected when reconstructing a full {@link Span}. */
const SPAN_SELECT = `
SELECT s.span_id, s.trace_id, s.parent_span_id, s.name, s.kind,
       s.start_unix_nano, s.end_unix_nano, s.status_code, s.status_message,
       s.trace_state, s.attributes, s.events, s.links,
       s.dropped_attributes, s.dropped_events, s.dropped_links,
       r.attributes AS resource_attributes,
       sc.name AS scope_name, sc.version AS scope_version, sc.attributes AS scope_attributes
FROM spans s
JOIN resources r ON r.id = s.resource_id
JOIN scopes sc   ON sc.id = s.scope_id
`;

interface SpanRow {
	span_id: string;
	trace_id: string;
	parent_span_id: string | null;
	name: string;
	kind: bigint;
	start_unix_nano: bigint;
	end_unix_nano: bigint;
	status_code: bigint;
	status_message: string | null;
	trace_state: string | null;
	attributes: string;
	events: string | null;
	links: string | null;
	dropped_attributes: bigint | null;
	dropped_events: bigint | null;
	dropped_links: bigint | null;
	resource_attributes: string;
	scope_name: string;
	scope_version: string | null;
	scope_attributes: string | null;
}

export class SpanStore {
	private readonly insert: StatementSync;
	private readonly selectByTrace: StatementSync;
	private readonly selectById: StatementSync;
	private readonly selectTraceSpanSummary: StatementSync;
	private readonly upsertTrace: StatementSync;
	private readonly deleteTraceServices: StatementSync;
	private readonly insertTraceService: StatementSync;
	private readonly deleteTraceSources: StatementSync;
	private readonly insertTraceSource: StatementSync;

	constructor(
		private readonly db: DatabaseSync,
		private readonly interner: Interner,
	) {
		this.insert = db.prepare(`
INSERT OR REPLACE INTO spans (
  span_id, trace_id, parent_span_id, name, kind,
  start_unix_nano, end_unix_nano, status_code, status_message, trace_state,
  attributes, events, links, dropped_attributes, dropped_events, dropped_links,
  resource_id, scope_id, service_name, source_name, ingested_unix_nano
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

		this.selectByTrace = db.prepare(
			`${SPAN_SELECT} WHERE s.trace_id = ? ORDER BY s.start_unix_nano ASC`,
		);
		this.selectByTrace.setReadBigInts(true);

		this.selectById = db.prepare(`${SPAN_SELECT} WHERE s.trace_id = ? AND s.span_id = ?`);
		this.selectById.setReadBigInts(true);

		// Minimal columns needed to recompute a trace rollup.
		this.selectTraceSpanSummary = db.prepare(`
SELECT span_id, parent_span_id, name, start_unix_nano, end_unix_nano, status_code, service_name, source_name
FROM spans WHERE trace_id = ?`);
		this.selectTraceSpanSummary.setReadBigInts(true);

		this.upsertTrace = db.prepare(`
INSERT OR REPLACE INTO traces (
  trace_id, root_span_id, root_name, start_unix_nano, end_unix_nano,
  duration_nanos, span_count, error_count, services, ingested_unix_nano
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
		this.deleteTraceServices = db.prepare('DELETE FROM trace_services WHERE trace_id = ?');
		this.insertTraceService = db.prepare(
			'INSERT INTO trace_services (trace_id, service_name) VALUES (?, ?)',
		);
		this.deleteTraceSources = db.prepare('DELETE FROM trace_sources WHERE trace_id = ?');
		this.insertTraceSource = db.prepare(
			'INSERT INTO trace_sources (trace_id, source_name) VALUES (?, ?)',
		);
	}

	write(spans: readonly Span[], ingestedUnixNano: bigint): void {
		const affected = new Set<TraceId>();
		const run = this.db.prepare('BEGIN');
		run.run();
		try {
			for (const span of spans) {
				const resourceId = this.interner.internResource(span.resource);
				const scopeId = this.interner.internScope(span.scope);
				const serviceName = serviceNameOf(span.resource);
				const sourceName = sourceNameOf(span.resource);
				this.insert.run(
					span.spanId,
					span.traceId,
					span.parentSpanId ?? null,
					span.name,
					span.kind,
					span.startTimeUnixNano,
					span.endTimeUnixNano,
					span.status.code,
					span.status.message ?? null,
					span.traceState ?? null,
					encodeAttributes(span.attributes),
					span.events ? encodeJson(span.events) : null,
					span.links ? encodeJson(span.links) : null,
					span.droppedAttributesCount ?? null,
					span.droppedEventsCount ?? null,
					span.droppedLinksCount ?? null,
					resourceId,
					scopeId,
					serviceName,
					sourceName,
					ingestedUnixNano,
				);
				affected.add(span.traceId);
			}
			for (const traceId of affected) {
				this.recomputeTrace(traceId, ingestedUnixNano);
			}
			this.db.prepare('COMMIT').run();
		} catch (err) {
			this.db.prepare('ROLLBACK').run();
			throw err;
		}
	}

	/**
	 * Recompute the materialized rollup for one trace from its spans. Spans
	 * can arrive across multiple exports (the root may land last), so the
	 * rollup is derived from the full current span set every time rather than
	 * incrementally patched. The root is the span whose parent is absent from
	 * the trace's own span set, falling back to the earliest span — identical
	 * to the memory backend.
	 */
	private recomputeTrace(traceId: TraceId, ingestedUnixNano: bigint): void {
		const rows = this.selectTraceSpanSummary.all(traceId) as Array<{
			span_id: string;
			parent_span_id: string | null;
			name: string;
			start_unix_nano: bigint;
			end_unix_nano: bigint;
			status_code: bigint;
			service_name: string;
			source_name: string;
		}>;
		if (rows.length === 0) {
			this.db.prepare('DELETE FROM traces WHERE trace_id = ?').run(traceId);
			return;
		}
		const first = rows[0];
		if (!first) {
			return;
		}
		const ids = new Set(rows.map((r) => r.span_id));
		const roots = rows.filter((r) => !r.parent_span_id || !ids.has(r.parent_span_id));
		let root = roots[0];
		if (!root) {
			root = rows.reduce((earliest, r) =>
				r.start_unix_nano < earliest.start_unix_nano ? r : earliest,
			);
		}
		let start = first.start_unix_nano;
		let end = first.end_unix_nano;
		const services = new Set<string>();
		const sources = new Set<string>();
		let errorCount = 0;
		for (const r of rows) {
			if (r.start_unix_nano < start) {
				start = r.start_unix_nano;
			}
			if (r.end_unix_nano > end) {
				end = r.end_unix_nano;
			}
			if (r.service_name) services.add(r.service_name);
			if (r.source_name) sources.add(r.source_name);
			if (r.status_code === 2n) {
				errorCount++;
			}
		}
		const serviceNames = [...services].sort();
		const sourceNames = [...sources].sort();
		this.upsertTrace.run(
			traceId,
			root.span_id,
			root.name,
			start,
			end,
			end - start,
			rows.length,
			errorCount,
			encodeJson(serviceNames),
			ingestedUnixNano,
		);
		this.deleteTraceServices.run(traceId);
		for (const serviceName of serviceNames) {
			this.insertTraceService.run(traceId, serviceName);
		}
		this.deleteTraceSources.run(traceId);
		for (const sourceName of sourceNames) {
			this.insertTraceSource.run(traceId, sourceName);
		}
	}

	listTraces(query: ListTracesQuery): ListTracesResult {
		const where: string[] = [];
		const params: Array<string | number | bigint> = [];
		if (query.timeFromUnixNano !== undefined) {
			where.push('start_unix_nano >= ?');
			params.push(query.timeFromUnixNano);
		}
		if (query.timeToUnixNano !== undefined) {
			where.push('start_unix_nano < ?');
			params.push(query.timeToUnixNano);
		}
		if (query.hasError === true) {
			where.push('error_count > 0');
		} else if (query.hasError === false) {
			where.push('error_count = 0');
		}
		if (query.sources && query.sources.length > 0) {
			const placeholders = query.sources.map(() => '?').join(', ');
			where.push(`trace_id IN (
  SELECT ts.trace_id FROM trace_sources ts
  WHERE ts.source_name IN (${placeholders})
)`);
			params.push(...query.sources);
		}
		if (query.services && query.services.length > 0) {
			const placeholders = query.services.map(() => '?').join(', ');
			where.push(`trace_id IN (
  SELECT ts.trace_id FROM trace_services ts
  WHERE ts.service_name IN (${placeholders})
)`);
			params.push(...query.services);
		}
		if (query.search) {
			where.push(`(
  lower(trace_id) LIKE ? OR lower(root_name) LIKE ? OR lower(services) LIKE ? OR EXISTS (
    SELECT 1 FROM spans search_span
    WHERE search_span.trace_id = traces.trace_id AND (
      lower(search_span.span_id) LIKE ? OR lower(search_span.name) LIKE ? OR
      lower(search_span.attributes) LIKE ?
    )
  )
)`);
			const needle = `%${query.search.toLowerCase()}%`;
			params.push(needle, needle, needle, needle, needle, needle);
		}
		const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

		const includeTotalCount = query.includeTotalCount !== false;
		const countRow = includeTotalCount
			? (this.db.prepare(`SELECT COUNT(*) AS n FROM traces ${whereSql}`).get(...params) as {
					n: number;
				})
			: undefined;

		const sortColumn = traceSortColumn(query.sortBy);
		const direction =
			(query.sortDirection ?? (query.sortBy ? 'asc' : 'desc')) === 'asc' ? 'ASC' : 'DESC';
		const pageWhere = [...where];
		const pageParams = [...params];
		if (query.cursor) {
			const comparator = direction === 'ASC' ? '>' : '<';
			pageWhere.push(`(${sortColumn} ${comparator} (SELECT ${sortColumn} FROM traces WHERE trace_id = ?)
  OR (${sortColumn} = (SELECT ${sortColumn} FROM traces WHERE trace_id = ?) AND trace_id ${comparator} ?))`);
			pageParams.push(query.cursor, query.cursor, query.cursor);
		}
		const pageWhereSql = pageWhere.length > 0 ? `WHERE ${pageWhere.join(' AND ')}` : '';
		const limit = query.limit ?? 100;
		const offset = query.cursor ? 0 : (query.offset ?? 0);
		const stmt = this.db.prepare(
			`SELECT trace_id, root_name, start_unix_nano, duration_nanos, span_count, error_count, services
FROM traces ${pageWhereSql} ORDER BY ${sortColumn} ${direction}, trace_id ${direction} LIMIT ? OFFSET ?`,
		);
		stmt.setReadBigInts(true);
		const rows = stmt.all(...pageParams, BigInt(limit + 1), BigInt(offset)) as Array<{
			trace_id: string;
			root_name: string;
			start_unix_nano: bigint;
			duration_nanos: bigint;
			span_count: bigint;
			error_count: bigint;
			services: string;
		}>;

		const hasMore = rows.length > limit;
		const mapped: ListTracesResultRow[] = rows.slice(0, limit).map((r) => ({
			traceId: r.trace_id,
			rootName: r.root_name,
			startTimeUnixNano: r.start_unix_nano,
			durationNanos: r.duration_nanos,
			services: decodeJson<string[]>(r.services, []),
			spanCount: Number(r.span_count),
			errorCount: Number(r.error_count),
		}));
		const nextCursor = hasMore ? mapped.at(-1)?.traceId : undefined;
		return {
			rows: mapped,
			totalCount: countRow?.n ?? mapped.length,
			...(!includeTotalCount ? { totalCountIsExact: false } : {}),
			...(nextCursor ? { nextCursor } : {}),
		};
	}

	getTraceSpans(traceId: TraceId): readonly Span[] {
		const rows = this.selectByTrace.all(traceId) as unknown as SpanRow[];
		return rows.map(spanFromRow);
	}

	getSpan(traceId: TraceId, spanId: SpanId): Span | undefined {
		const row = this.selectById.get(traceId, spanId) as unknown as SpanRow | undefined;
		return row ? spanFromRow(row) : undefined;
	}
}

function traceSortColumn(sortBy: ListTracesQuery['sortBy']): string {
	switch (sortBy) {
		case 'name':
			return 'root_name';
		case 'duration':
			return 'duration_nanos';
		case 'spanCount':
			return 'span_count';
		case 'errorCount':
			return 'error_count';
		default:
			return 'start_unix_nano';
	}
}

function spanFromRow(row: SpanRow): Span {
	const resource: Resource = { attributes: decodeAttributes(row.resource_attributes) };
	const scope: InstrumentationScope = {
		name: row.scope_name,
		...(row.scope_version !== null ? { version: row.scope_version } : {}),
		...(row.scope_attributes !== null ? { attributes: decodeAttributes(row.scope_attributes) } : {}),
	};
	const span: Span = {
		traceId: row.trace_id as TraceId,
		spanId: row.span_id as SpanId,
		...(row.parent_span_id !== null ? { parentSpanId: row.parent_span_id as SpanId } : {}),
		name: row.name,
		kind: Number(row.kind) as SpanKind,
		startTimeUnixNano: row.start_unix_nano,
		endTimeUnixNano: row.end_unix_nano,
		status: {
			code: Number(row.status_code) as SpanStatusCode,
			...(row.status_message !== null ? { message: row.status_message } : {}),
		},
		attributes: decodeAttributes(row.attributes),
		...(row.events !== null ? { events: decodeJson(row.events, []) } : {}),
		...(row.links !== null ? { links: decodeJson(row.links, []) } : {}),
		...(row.trace_state !== null ? { traceState: row.trace_state } : {}),
		...(row.dropped_attributes !== null
			? { droppedAttributesCount: Number(row.dropped_attributes) }
			: {}),
		...(row.dropped_events !== null ? { droppedEventsCount: Number(row.dropped_events) } : {}),
		...(row.dropped_links !== null ? { droppedLinksCount: Number(row.dropped_links) } : {}),
		resource,
		scope,
	};
	return span;
}
