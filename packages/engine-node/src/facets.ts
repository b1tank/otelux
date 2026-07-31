import type { DatabaseSync } from 'node:sqlite';
import type { ListServiceFacetsQuery, ListServiceFacetsResult } from '@otelux/protocol';

export function listServiceFacets(
	db: DatabaseSync,
	query: ListServiceFacetsQuery,
): ListServiceFacetsResult {
	const source =
		query.signal === 'traces'
			? 'trace_services'
			: query.signal === 'logs'
				? 'logs'
				: 'metric_instruments';
	const limit = Math.max(1, Math.min(query.limit ?? 500, 1000));
	const rows = db
		.prepare(`
SELECT service_name AS name, COUNT(*) AS count
FROM ${source}
WHERE service_name <> ''
GROUP BY service_name
ORDER BY count DESC, service_name ASC
LIMIT ?`)
		.all(limit) as Array<{ name: string; count: number }>;
	return { rows: rows.map((row) => ({ name: row.name, count: Number(row.count) })) };
}
