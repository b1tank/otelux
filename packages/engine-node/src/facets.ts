import type { DatabaseSync } from 'node:sqlite';
import type { ListResourceFacetsQuery, ListResourceFacetsResult } from '@otelux/protocol';

/** Indexed source/service facets; source is service.namespace with service.name fallback. */
export function listResourceFacets(
	db: DatabaseSync,
	query: ListResourceFacetsQuery,
): ListResourceFacetsResult {
	const limit = Math.max(1, Math.min(query.limit ?? 500, 1000));
	const sources = query.sources?.filter((source) => source !== '') ?? [];
	const placeholders = sources.map(() => '?').join(', ');
	let sql: string;
	let params: Array<string | number> = [];

	if (query.signal === 'traces') {
		if (query.facet === 'source') {
			sql = `
SELECT source_name AS name, COUNT(*) AS count
FROM trace_sources
WHERE source_name <> ''
GROUP BY source_name
ORDER BY count DESC, source_name ASC
LIMIT ?`;
		} else if (sources.length > 0) {
			sql = `
SELECT services.service_name AS name, COUNT(DISTINCT services.trace_id) AS count
FROM trace_services services
JOIN trace_sources sources ON sources.trace_id = services.trace_id
WHERE services.service_name <> '' AND sources.source_name IN (${placeholders})
GROUP BY services.service_name
ORDER BY count DESC, services.service_name ASC
LIMIT ?`;
			params = [...sources];
		} else {
			sql = `
SELECT service_name AS name, COUNT(*) AS count
FROM trace_services
WHERE service_name <> ''
GROUP BY service_name
ORDER BY count DESC, service_name ASC
LIMIT ?`;
		}
	} else {
		const table = query.signal === 'logs' ? 'logs' : 'metric_instruments';
		const column = query.facet === 'source' ? 'source_name' : 'service_name';
		const sourceClause =
			query.facet === 'service' && sources.length > 0 ? ` AND source_name IN (${placeholders})` : '';
		sql = `
SELECT ${column} AS name, COUNT(*) AS count
FROM ${table}
WHERE ${column} <> ''${sourceClause}
GROUP BY ${column}
ORDER BY count DESC, ${column} ASC
LIMIT ?`;
		if (sourceClause) params = [...sources];
	}

	const rows = db.prepare(sql).all(...params, limit) as Array<{ name: string; count: number }>;
	return { rows: rows.map((row) => ({ name: row.name, count: Number(row.count) })) };
}
