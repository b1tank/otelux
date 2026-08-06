import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { FullListLogsResult } from '@otelux/engine';
import type { ListLogsQuery, ListLogsResult, LogListResultRow } from '@otelux/protocol';
import type { InstrumentationScope, LogRecord, Resource, SpanId, TraceId } from '@otelux/types';
import {
	attributeValueToSearchText,
	decodeAttributes,
	decodeOptionalValue,
	encodeAttributes,
	encodeOptionalValue,
} from './attributes.js';
import type { Interner } from './intern.js';
import { serviceNameOf, sourceNameOf } from './resource.js';

const LOG_SELECT = `
SELECT l.id, l.time_unix_nano, l.observed_time_unix_nano, l.severity_number, l.severity_text,
       l.event_name, l.body, l.attributes, l.flags, l.trace_id, l.span_id,
       l.dropped_attributes,
       r.attributes AS resource_attributes,
       sc.name AS scope_name, sc.version AS scope_version, sc.attributes AS scope_attributes
FROM logs l
JOIN resources r ON r.id = l.resource_id
JOIN scopes sc   ON sc.id = l.scope_id
`;

const LOG_LIST_SELECT = `
SELECT l.id, l.time_unix_nano, l.severity_number, l.severity_text, l.event_name,
       substr(COALESCE(
         CASE WHEN json_type(l.body) IN ('text', 'integer', 'real', 'true', 'false')
              THEN CAST(json_extract(l.body, '$') AS TEXT) END,
         CAST(json_extract(l.attributes, '$.message') AS TEXT),
         CAST(json_extract(l.attributes, '$."event.name"') AS TEXT),
         CAST(json_extract(l.attributes, '$.prompt') AS TEXT),
         l.event_name,
         '(no message)'
       ), 1, 4096) AS message,
       l.service_name, l.trace_id, l.span_id
FROM logs l
`;

interface LogListRow {
	id: bigint;
	time_unix_nano: bigint;
	severity_number: bigint;
	severity_text: string | null;
	event_name: string | null;
	message: string;
	service_name: string;
	trace_id: string | null;
	span_id: string | null;
}

interface LogRow {
	id: bigint;
	time_unix_nano: bigint;
	observed_time_unix_nano: bigint | null;
	severity_number: bigint;
	severity_text: string | null;
	event_name: string | null;
	body: string | null;
	attributes: string;
	flags: bigint | null;
	trace_id: string | null;
	span_id: string | null;
	dropped_attributes: bigint | null;
	resource_attributes: string;
	scope_name: string;
	scope_version: string | null;
	scope_attributes: string | null;
}

export class LogStore {
	private readonly insert: StatementSync;

	constructor(
		private readonly db: DatabaseSync,
		private readonly interner: Interner,
	) {
		this.insert = db.prepare(`
INSERT INTO logs (
  time_unix_nano, observed_time_unix_nano, severity_number, severity_text,
  event_name, body, attributes, flags, trace_id, span_id, dropped_attributes,
  resource_id, scope_id, service_name, source_name, scope_name, search_text, ingested_unix_nano
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
	}

	write(records: readonly LogRecord[], ingestedUnixNano: bigint): void {
		this.db.prepare('BEGIN').run();
		try {
			for (const log of records) {
				const resourceId = this.interner.internResource(log.resource);
				const scopeId = this.interner.internScope(log.scope);
				this.insert.run(
					log.timeUnixNano,
					log.observedTimeUnixNano ?? null,
					log.severityNumber,
					log.severityText ?? null,
					log.eventName ?? null,
					encodeOptionalValue(log.body),
					encodeAttributes(log.attributes),
					log.flags ?? null,
					log.traceId ?? null,
					log.spanId ?? null,
					log.droppedAttributesCount ?? null,
					resourceId,
					scopeId,
					serviceNameOf(log.resource),
					sourceNameOf(log.resource),
					log.scope.name,
					buildSearchText(log),
					ingestedUnixNano,
				);
			}
			this.db.prepare('COMMIT').run();
		} catch (err) {
			this.db.prepare('ROLLBACK').run();
			throw err;
		}
	}

	listLogs(query: ListLogsQuery): ListLogsResult {
		const where: string[] = [];
		const params: Array<string | number | bigint> = [];
		if (query.timeFromUnixNano !== undefined) {
			where.push('l.time_unix_nano >= ?');
			params.push(query.timeFromUnixNano);
		}
		if (query.timeToUnixNano !== undefined) {
			where.push('l.time_unix_nano < ?');
			params.push(query.timeToUnixNano);
		}
		if (query.minSeverity !== undefined) {
			where.push('l.severity_number >= ?');
			params.push(query.minSeverity);
		}
		if (query.traceId !== undefined) {
			where.push('l.trace_id = ?');
			params.push(query.traceId);
		}
		if (query.sources && query.sources.length > 0) {
			where.push(`l.source_name IN (${query.sources.map(() => '?').join(', ')})`);
			params.push(...query.sources);
		}
		if (query.services && query.services.length > 0) {
			where.push(`l.service_name IN (${query.services.map(() => '?').join(', ')})`);
			params.push(...query.services);
		}
		if (query.scopes && query.scopes.length > 0) {
			where.push(`l.scope_name IN (${query.scopes.map(() => '?').join(', ')})`);
			params.push(...query.scopes);
		}
		if (query.search) {
			where.push(`(
  l.search_text LIKE ? OR lower(coalesce(l.trace_id, '')) LIKE ? OR
  lower(coalesce(l.span_id, '')) LIKE ? OR lower(l.scope_name) LIKE ? OR
  EXISTS (SELECT 1 FROM resources sr WHERE sr.id = l.resource_id AND lower(sr.attributes) LIKE ?) OR
  EXISTS (SELECT 1 FROM scopes ss WHERE ss.id = l.scope_id AND (
    lower(ss.name) LIKE ? OR lower(coalesce(ss.version, '')) LIKE ? OR
    lower(coalesce(ss.attributes, '')) LIKE ?
  ))
)`);
			const needle = `%${query.search.toLowerCase()}%`;
			params.push(needle, needle, needle, needle, needle, needle, needle, needle);
		}
		const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

		const includeTotalCount = query.includeTotalCount !== false;
		const countRow = includeTotalCount
			? (this.db.prepare(`SELECT COUNT(*) AS n FROM logs l ${whereSql}`).get(...params) as {
					n: number;
				})
			: undefined;

		const sortColumn = query.sortBy === 'severity' ? 'l.severity_number' : 'l.time_unix_nano';
		const direction = (query.sortDirection ?? 'desc') === 'asc' ? 'ASC' : 'DESC';
		const pageWhere = [...where];
		const pageParams = [...params];
		if (query.cursor && /^\d+$/.test(query.cursor)) {
			const comparator = direction === 'ASC' ? '>' : '<';
			pageWhere.push(`(${sortColumn} ${comparator} (SELECT ${sortColumn.replace('l.', '')} FROM logs WHERE id = ?)
  OR (${sortColumn} = (SELECT ${sortColumn.replace('l.', '')} FROM logs WHERE id = ?) AND l.id ${comparator} ?))`);
			pageParams.push(query.cursor, query.cursor, query.cursor);
		}
		const pageWhereSql = pageWhere.length > 0 ? `WHERE ${pageWhere.join(' AND ')}` : '';
		const limit = query.limit ?? 100;
		const offset = query.cursor ? 0 : (query.offset ?? 0);
		const stmt = this.db.prepare(
			`${LOG_LIST_SELECT} ${pageWhereSql} ORDER BY ${sortColumn} ${direction}, l.id ${direction} LIMIT ? OFFSET ?`,
		);
		stmt.setReadBigInts(true);
		const rows = stmt.all(
			...pageParams,
			BigInt(limit + 1),
			BigInt(offset),
		) as unknown as LogListRow[];
		const hasMore = rows.length > limit;
		const page = rows.slice(0, limit);
		const nextCursor = hasMore ? page.at(-1)?.id.toString() : undefined;
		return {
			rows: page.map(logListFromRow),
			totalCount: countRow?.n ?? page.length,
			...(!includeTotalCount ? { totalCountIsExact: false } : {}),
			...(nextCursor ? { nextCursor } : {}),
		};
	}

	getLog(logId: string): LogRecord | undefined {
		if (!/^\d+$/.test(logId)) return undefined;
		const stmt = this.db.prepare(`${LOG_SELECT} WHERE l.id = ?`);
		stmt.setReadBigInts(true);
		const row = stmt.get(logId) as unknown as LogRow | undefined;
		return row ? logFromRow(row) : undefined;
	}

	searchLogs(query: ListLogsQuery): FullListLogsResult {
		const listed = this.listLogs(query);
		const ids = listed.rows.map((row) => row.logId);
		if (ids.length === 0) return { rows: [], totalCount: listed.totalCount };
		const stmt = this.db.prepare(`${LOG_SELECT} WHERE l.id IN (${ids.map(() => '?').join(', ')})`);
		stmt.setReadBigInts(true);
		const records = stmt.all(...ids) as unknown as LogRow[];
		const byId = new Map(records.map((row) => [row.id.toString(), logFromRow(row)] as const));
		return {
			rows: ids.flatMap((id) => {
				const log = byId.get(id);
				return log ? [log] : [];
			}),
			totalCount: listed.totalCount,
		};
	}
}

/**
 * Build the lowercased free-text index for a log. Mirrors the memory
 * backend: body, event name, severity text, and both attribute keys and
 * values are searchable — Codex content (prompt, tool args) rides
 * attributes, not the body.
 */
function buildSearchText(log: LogRecord): string {
	const parts: string[] = [];
	if (log.body !== undefined) {
		parts.push(attributeValueToSearchText(log.body));
	}
	if (log.eventName) {
		parts.push(log.eventName);
	}
	if (log.severityText) {
		parts.push(log.severityText);
	}
	if (log.traceId) parts.push(log.traceId);
	if (log.spanId) parts.push(log.spanId);
	parts.push(log.scope.name);
	if (log.scope.version) parts.push(log.scope.version);
	for (const attributes of [log.attributes, log.resource.attributes, log.scope.attributes ?? {}]) {
		for (const [key, value] of Object.entries(attributes)) {
			parts.push(key);
			parts.push(attributeValueToSearchText(value));
		}
	}
	return parts.join(' ').toLowerCase();
}

function logListFromRow(row: LogListRow): LogListResultRow {
	return {
		logId: row.id.toString(),
		timeUnixNano: row.time_unix_nano,
		severityNumber: Number(row.severity_number),
		...(row.severity_text !== null ? { severityText: row.severity_text } : {}),
		...(row.event_name !== null ? { eventName: row.event_name } : {}),
		message: row.message,
		...(row.service_name !== '' ? { serviceName: row.service_name } : {}),
		...(row.trace_id !== null ? { traceId: row.trace_id as TraceId } : {}),
		...(row.span_id !== null ? { spanId: row.span_id as SpanId } : {}),
	};
}

function logFromRow(row: LogRow): LogRecord {
	const resource: Resource = { attributes: decodeAttributes(row.resource_attributes) };
	const scope: InstrumentationScope = {
		name: row.scope_name,
		...(row.scope_version !== null ? { version: row.scope_version } : {}),
		...(row.scope_attributes !== null ? { attributes: decodeAttributes(row.scope_attributes) } : {}),
	};
	const body = row.body !== null ? decodeOptionalValue(row.body) : undefined;
	return {
		timeUnixNano: row.time_unix_nano,
		...(row.observed_time_unix_nano !== null
			? { observedTimeUnixNano: row.observed_time_unix_nano }
			: {}),
		severityNumber: Number(row.severity_number),
		...(row.severity_text !== null ? { severityText: row.severity_text } : {}),
		...(row.event_name !== null ? { eventName: row.event_name } : {}),
		...(body !== undefined ? { body } : {}),
		attributes: decodeAttributes(row.attributes),
		...(row.flags !== null ? { flags: Number(row.flags) } : {}),
		...(row.trace_id !== null ? { traceId: row.trace_id as TraceId } : {}),
		...(row.span_id !== null ? { spanId: row.span_id as SpanId } : {}),
		...(row.dropped_attributes !== null
			? { droppedAttributesCount: Number(row.dropped_attributes) }
			: {}),
		resource,
		scope,
	};
}
