import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type {
	GetMetricPointsQuery,
	GetMetricPointsResult,
	ListMetricInstrumentsQuery,
	ListMetricInstrumentsResult,
	ListMetricsQuery,
	ListMetricsResult,
	MetricInstrumentSummary,
} from '@otelux/protocol';
import type {
	AggregationTemporality,
	GaugeMetric,
	HistogramDataPoint,
	HistogramMetric,
	InstrumentationScope,
	Metric,
	NumberDataPoint,
	Resource,
	SumMetric,
} from '@otelux/types';
import { decodeAttributes, decodeJson, encodeAttributes, encodeJson } from './attributes.js';
import type { Interner } from './intern.js';
import { serviceNameOf, sourceNameOf } from './resource.js';

/**
 * Per-instrument data-point cap. Matches the memory backend: retain the most
 * recent points so a long-running exporter cannot grow one series without
 * bound. Retention (age/size) prunes across instruments; this caps within one.
 */
const MAX_POINTS_PER_INSTRUMENT = 10_000;

interface InstrumentRow {
	id: bigint;
	name: string;
	description: string | null;
	unit: string | null;
	type: string;
	is_monotonic: bigint | null;
	temporality: bigint | null;
	scope_name: string;
	scope_version: string | null;
	scope_attributes: string | null;
	resource_attributes: string;
}

interface InstrumentSummaryRow {
	id: bigint;
	name: string;
	description: string | null;
	unit: string | null;
	type: string;
	is_monotonic: bigint | null;
	temporality: bigint | null;
	source_name: string;
	service_name: string;
	scope_name: string;
	point_count: bigint;
	time_unix_nano: bigint | null;
	value: number | null;
	count: bigint | null;
	sum: number | null;
}

interface MetricPageRow extends InstrumentRow {
	point_id: bigint | null;
	point_time_unix_nano: bigint | null;
	point_start_time_unix_nano: bigint | null;
	point_flags: bigint | null;
	point_attributes: string | null;
	point_value: number | null;
	point_count: bigint | null;
	point_sum: number | null;
	point_min: number | null;
	point_max: number | null;
	point_bucket_counts: string | null;
	point_explicit_bounds: string | null;
	total_point_count: bigint;
}

interface PointRow {
	instrument_id: bigint;
	time_unix_nano: bigint;
	start_time_unix_nano: bigint | null;
	flags: bigint | null;
	attributes: string;
	value: number | null;
	count: bigint | null;
	sum: number | null;
	min: number | null;
	max: number | null;
	bucket_counts: string | null;
	explicit_bounds: string | null;
}

export class MetricStore {
	private readonly insertInstrument: StatementSync;
	private readonly selectInstrumentId: StatementSync;
	private readonly updateInstrument: StatementSync;
	private readonly insertPoint: StatementSync;
	private readonly countPoints: StatementSync;
	private readonly prunePoints: StatementSync;

	constructor(
		private readonly db: DatabaseSync,
		private readonly interner: Interner,
	) {
		this.insertInstrument = db.prepare(`
INSERT OR IGNORE INTO metric_instruments (
  identity, service_name, source_name, scope_name, name, description, unit, type,
  is_monotonic, temporality, resource_id, scope_id, updated_unix_nano
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
		this.selectInstrumentId = db.prepare('SELECT id FROM metric_instruments WHERE identity = ?');
		// Later exports carry the freshest metadata (description/unit/temporality).
		this.updateInstrument = db.prepare(`
UPDATE metric_instruments
SET description = ?, unit = ?, is_monotonic = ?, temporality = ?,
    resource_id = ?, scope_id = ?, updated_unix_nano = ?
WHERE id = ?`);
		this.insertPoint = db.prepare(`
INSERT INTO metric_points (
  instrument_id, time_unix_nano, start_time_unix_nano, flags, attributes,
  value, count, sum, min, max, bucket_counts, explicit_bounds, ingested_unix_nano
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
		this.countPoints = db.prepare('SELECT COUNT(*) AS n FROM metric_points WHERE instrument_id = ?');
		// Keep the newest N points (highest ids) for one instrument, drop the rest.
		this.prunePoints = db.prepare(`
DELETE FROM metric_points
WHERE instrument_id = ?
  AND id NOT IN (
    SELECT id FROM metric_points WHERE instrument_id = ? ORDER BY id DESC LIMIT ?
  )`);
	}

	write(metrics: readonly Metric[], ingestedUnixNano: bigint): void {
		this.db.prepare('BEGIN').run();
		try {
			for (const metric of metrics) {
				const resourceId = this.interner.internResource(metric.resource);
				const scopeId = this.interner.internScope(metric.scope);
				const serviceName = serviceNameOf(metric.resource);
				const sourceName = sourceNameOf(metric.resource);
				const identity = [sourceName, serviceName, metric.scope.name, metric.name, metric.type].join(
					'\u0000',
				);
				const isMonotonic = metric.type === 'sum' ? (metric.isMonotonic ? 1 : 0) : null;
				const temporality = metric.type === 'gauge' ? null : metric.temporality;
				this.insertInstrument.run(
					identity,
					serviceName,
					sourceName,
					metric.scope.name,
					metric.name,
					metric.description ?? null,
					metric.unit ?? null,
					metric.type,
					isMonotonic,
					temporality,
					resourceId,
					scopeId,
					ingestedUnixNano,
				);
				const idRow = this.selectInstrumentId.get(identity) as { id: number };
				const instrumentId = idRow.id;
				this.updateInstrument.run(
					metric.description ?? null,
					metric.unit ?? null,
					isMonotonic,
					temporality,
					resourceId,
					scopeId,
					ingestedUnixNano,
					instrumentId,
				);
				this.insertDataPoints(instrumentId, metric, ingestedUnixNano);
				this.capPoints(instrumentId);
			}
			this.db.prepare('COMMIT').run();
		} catch (err) {
			this.db.prepare('ROLLBACK').run();
			throw err;
		}
	}

	private insertDataPoints(instrumentId: number, metric: Metric, ingestedUnixNano: bigint): void {
		if (metric.type === 'histogram') {
			for (const p of metric.dataPoints) {
				this.insertPoint.run(
					instrumentId,
					p.timeUnixNano,
					p.startTimeUnixNano ?? null,
					p.flags ?? null,
					encodeAttributes(p.attributes),
					null,
					p.count,
					p.sum ?? null,
					p.min ?? null,
					p.max ?? null,
					encodeJson(p.bucketCounts),
					encodeJson(p.explicitBounds),
					ingestedUnixNano,
				);
			}
			return;
		}
		for (const p of metric.dataPoints) {
			this.insertPoint.run(
				instrumentId,
				p.timeUnixNano,
				p.startTimeUnixNano ?? null,
				p.flags ?? null,
				encodeAttributes(p.attributes),
				p.value,
				null,
				null,
				null,
				null,
				null,
				null,
				ingestedUnixNano,
			);
		}
	}

	private capPoints(instrumentId: number): void {
		const countRow = this.countPoints.get(instrumentId) as { n: number };
		if (countRow.n > MAX_POINTS_PER_INSTRUMENT) {
			this.prunePoints.run(instrumentId, instrumentId, MAX_POINTS_PER_INSTRUMENT);
		}
	}

	listMetricInstruments(query: ListMetricInstrumentsQuery): ListMetricInstrumentsResult {
		const where: string[] = [];
		const params: Array<string | number | bigint> = [];
		if (query.sources && query.sources.length > 0) {
			where.push(`i.source_name IN (${query.sources.map(() => '?').join(', ')})`);
			params.push(...query.sources);
		}
		if (query.services && query.services.length > 0) {
			where.push(`i.service_name IN (${query.services.map(() => '?').join(', ')})`);
			params.push(...query.services);
		}
		if (query.meters && query.meters.length > 0) {
			where.push(`i.scope_name IN (${query.meters.map(() => '?').join(', ')})`);
			params.push(...query.meters);
		}
		if (query.search) {
			where.push(`(
  CAST(i.id AS TEXT) LIKE ? OR lower(i.name) LIKE ? OR
  lower(coalesce(i.description, '')) LIKE ? OR lower(coalesce(i.unit, '')) LIKE ? OR
  lower(i.source_name) LIKE ? OR lower(i.service_name) LIKE ? OR lower(i.scope_name) LIKE ? OR
  EXISTS (SELECT 1 FROM resources sr WHERE sr.id = i.resource_id AND lower(sr.attributes) LIKE ?) OR
  EXISTS (SELECT 1 FROM scopes ss WHERE ss.id = i.scope_id AND lower(coalesce(ss.attributes, '')) LIKE ?) OR
  EXISTS (SELECT 1 FROM metric_points sp WHERE sp.instrument_id = i.id AND lower(sp.attributes) LIKE ?)
)`);
			const needle = `%${query.search.toLowerCase()}%`;
			params.push(needle, needle, needle, needle, needle, needle, needle, needle, needle, needle);
		}
		const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
		const countRow = this.db
			.prepare(`SELECT COUNT(*) AS n FROM metric_instruments i ${whereSql}`)
			.get(...params) as { n: number };
		const limit = query.limit ?? 500;
		const offset = query.offset ?? 0;
		const stmt = this.db.prepare(`
SELECT i.id, i.name, i.description, i.unit, i.type, i.is_monotonic, i.temporality,
       i.source_name, i.service_name, i.scope_name,
       (SELECT COUNT(*) FROM metric_points pc WHERE pc.instrument_id = i.id) AS point_count,
       lp.time_unix_nano, lp.value, lp.count, lp.sum
FROM metric_instruments i
LEFT JOIN metric_points lp ON lp.id = (
  SELECT id FROM metric_points
  WHERE instrument_id = i.id
  ORDER BY time_unix_nano DESC, id DESC
  LIMIT 1
)
${whereSql}
ORDER BY i.source_name ASC, i.service_name ASC, i.scope_name ASC, i.name ASC
LIMIT ? OFFSET ?`);
		stmt.setReadBigInts(true);
		const rows = stmt.all(
			...params,
			BigInt(limit),
			BigInt(offset),
		) as unknown as InstrumentSummaryRow[];
		return { rows: rows.map(instrumentSummaryFromRow), totalCount: countRow.n };
	}

	getMetricPoints(query: GetMetricPointsQuery): GetMetricPointsResult | undefined {
		if (!/^\d+$/.test(query.instrumentId)) return undefined;
		const limit = Math.max(1, Math.min(query.limit ?? 120, 1_000));
		const cursor = query.cursor ? /^(\d+):(\d+)$/.exec(query.cursor) : undefined;
		const cursorSql = cursor ? 'AND (time_unix_nano < ? OR (time_unix_nano = ? AND id < ?))' : '';
		const stmt = this.db.prepare(`
SELECT i.id, i.name, i.description, i.unit, i.type, i.is_monotonic, i.temporality,
       i.scope_name, sc.version AS scope_version, sc.attributes AS scope_attributes,
       r.attributes AS resource_attributes,
       p.id AS point_id, p.time_unix_nano AS point_time_unix_nano,
       p.start_time_unix_nano AS point_start_time_unix_nano, p.flags AS point_flags,
       p.attributes AS point_attributes, p.value AS point_value, p.count AS point_count,
       p.sum AS point_sum, p.min AS point_min, p.max AS point_max,
       p.bucket_counts AS point_bucket_counts, p.explicit_bounds AS point_explicit_bounds,
       (SELECT COUNT(*) FROM metric_points pc WHERE pc.instrument_id = i.id) AS total_point_count
FROM metric_instruments i
JOIN resources r ON r.id = i.resource_id
JOIN scopes sc ON sc.id = i.scope_id
LEFT JOIN (
  SELECT * FROM metric_points
  WHERE instrument_id = ?
  ${cursorSql}
  ORDER BY time_unix_nano DESC, id DESC
  LIMIT ?
) p ON p.instrument_id = i.id
WHERE i.id = ?
ORDER BY p.time_unix_nano DESC, p.id DESC`);
		stmt.setReadBigInts(true);
		const cursorParams = cursor
			? [BigInt(cursor[1] as string), BigInt(cursor[1] as string), BigInt(cursor[2] as string)]
			: [];
		const rows = stmt.all(
			query.instrumentId,
			...cursorParams,
			BigInt(limit + 1),
			query.instrumentId,
		) as unknown as MetricPageRow[];
		const first = rows[0];
		if (!first) return undefined;
		const pointPageRows = rows.filter((row) => row.point_id !== null);
		const hasMore = pointPageRows.length > limit;
		const selectedRows = pointPageRows.slice(0, limit);
		const last = selectedRows.at(-1);
		const pointRows = selectedRows.flatMap(pointRowFromPageRow).reverse();
		return {
			metric: this.metricFromRow(first, pointRows),
			totalPointCount: Number(first.total_point_count),
			...(hasMore && last && last.point_time_unix_nano !== null && last.point_id !== null
				? { nextCursor: `${last.point_time_unix_nano}:${last.point_id}` }
				: {}),
		};
	}

	listMetrics(query: ListMetricsQuery): ListMetricsResult {
		const where: string[] = [];
		const params: Array<string | number | bigint> = [];
		if (query.sources && query.sources.length > 0) {
			where.push(`i.source_name IN (${query.sources.map(() => '?').join(', ')})`);
			params.push(...query.sources);
		}
		if (query.services && query.services.length > 0) {
			where.push(`i.service_name IN (${query.services.map(() => '?').join(', ')})`);
			params.push(...query.services);
		}
		if (query.meters && query.meters.length > 0) {
			where.push(`i.scope_name IN (${query.meters.map(() => '?').join(', ')})`);
			params.push(...query.meters);
		}
		if (query.search) {
			where.push(`(
  CAST(i.id AS TEXT) LIKE ? OR lower(i.name) LIKE ? OR
  lower(coalesce(i.description, '')) LIKE ? OR lower(coalesce(i.unit, '')) LIKE ? OR
  lower(i.source_name) LIKE ? OR lower(i.service_name) LIKE ? OR lower(i.scope_name) LIKE ? OR
  EXISTS (SELECT 1 FROM resources sr WHERE sr.id = i.resource_id AND lower(sr.attributes) LIKE ?) OR
  EXISTS (SELECT 1 FROM scopes ss WHERE ss.id = i.scope_id AND lower(coalesce(ss.attributes, '')) LIKE ?) OR
  EXISTS (SELECT 1 FROM metric_points sp WHERE sp.instrument_id = i.id AND lower(sp.attributes) LIKE ?)
)`);
			const needle = `%${query.search.toLowerCase()}%`;
			params.push(needle, needle, needle, needle, needle, needle, needle, needle, needle, needle);
		}
		const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

		const countRow = this.db
			.prepare(`SELECT COUNT(*) AS n FROM metric_instruments i ${whereSql}`)
			.get(...params) as { n: number };

		const limit = query.limit ?? 1000;
		const offset = query.offset ?? 0;
		const stmt = this.db.prepare(`
SELECT i.id, i.name, i.description, i.unit, i.type, i.is_monotonic, i.temporality,
       i.scope_name, sc.version AS scope_version, sc.attributes AS scope_attributes,
       r.attributes AS resource_attributes
FROM metric_instruments i
JOIN resources r ON r.id = i.resource_id
JOIN scopes sc   ON sc.id = i.scope_id
${whereSql}
ORDER BY i.source_name ASC, i.service_name ASC, i.scope_name ASC, i.name ASC
LIMIT ? OFFSET ?`);
		stmt.setReadBigInts(true);
		const rows = stmt.all(...params, BigInt(limit), BigInt(offset)) as unknown as InstrumentRow[];
		const pointLimit = Math.max(1, Math.min(query.pointLimit ?? 120, MAX_POINTS_PER_INSTRUMENT));
		const pointsByInstrument = this.selectRecentPoints(rows, pointLimit);
		const metrics = rows.map((row) => this.metricFromRow(row, pointsByInstrument.get(row.id) ?? []));
		return { rows: metrics, totalCount: countRow.n };
	}

	private selectRecentPoints(
		instruments: readonly InstrumentRow[],
		pointLimit: number,
	): ReadonlyMap<bigint, readonly PointRow[]> {
		const byInstrument = new Map<bigint, PointRow[]>();
		if (instruments.length === 0) return byInstrument;
		// One compound statement, one indexed tail per instrument. A window
		// function over the whole point table ranked every historical point even
		// when the UI requested one latest value; these UNION branches seek
		// directly through (instrument_id, id) and remain one SQL round trip.
		const branches = instruments.map(
			() => `SELECT * FROM (
  SELECT * FROM metric_points
  WHERE instrument_id = ?
  ORDER BY id DESC
  LIMIT ?
)`,
		);
		const stmt = this.db.prepare(`
SELECT * FROM (${branches.join('\nUNION ALL\n')})
ORDER BY instrument_id ASC, id ASC`);
		stmt.setReadBigInts(true);
		const queryParams = instruments.flatMap((instrument) => [instrument.id, BigInt(pointLimit)]);
		const rows = stmt.all(...queryParams) as unknown as PointRow[];
		for (const row of rows) {
			const points = byInstrument.get(row.instrument_id);
			if (points) points.push(row);
			else byInstrument.set(row.instrument_id, [row]);
		}
		return byInstrument;
	}

	private metricFromRow(row: InstrumentRow, pointRows: readonly PointRow[]): Metric {
		const resource: Resource = { attributes: decodeAttributes(row.resource_attributes) };
		const scope: InstrumentationScope = {
			name: row.scope_name,
			...(row.scope_version !== null ? { version: row.scope_version } : {}),
			...(row.scope_attributes !== null ? { attributes: decodeAttributes(row.scope_attributes) } : {}),
		};
		const base = {
			name: row.name,
			...(row.description !== null ? { description: row.description } : {}),
			...(row.unit !== null ? { unit: row.unit } : {}),
			resource,
			scope,
		};
		if (row.type === 'histogram') {
			const metric: HistogramMetric = {
				...base,
				type: 'histogram',
				temporality: Number(row.temporality ?? 0) as AggregationTemporality,
				dataPoints: pointRows.map(histogramPointFromRow),
			};
			return metric;
		}
		if (row.type === 'gauge') {
			const metric: GaugeMetric = {
				...base,
				type: 'gauge',
				dataPoints: pointRows.map(numberPointFromRow),
			};
			return metric;
		}
		const metric: SumMetric = {
			...base,
			type: 'sum',
			isMonotonic: row.is_monotonic === 1n,
			temporality: Number(row.temporality ?? 0) as AggregationTemporality,
			dataPoints: pointRows.map(numberPointFromRow),
		};
		return metric;
	}
}

function pointRowFromPageRow(row: MetricPageRow): PointRow[] {
	if (row.point_id === null || row.point_time_unix_nano === null || row.point_attributes === null) {
		return [];
	}
	return [
		{
			instrument_id: row.id,
			time_unix_nano: row.point_time_unix_nano,
			start_time_unix_nano: row.point_start_time_unix_nano,
			flags: row.point_flags,
			attributes: row.point_attributes,
			value: row.point_value,
			count: row.point_count,
			sum: row.point_sum,
			min: row.point_min,
			max: row.point_max,
			bucket_counts: row.point_bucket_counts,
			explicit_bounds: row.point_explicit_bounds,
		},
	];
}

function instrumentSummaryFromRow(row: InstrumentSummaryRow): MetricInstrumentSummary {
	const base = {
		instrumentId: row.id.toString(),
		name: row.name,
		...(row.description !== null ? { description: row.description } : {}),
		...(row.unit !== null ? { unit: row.unit } : {}),
		type: row.type as Metric['type'],
		...(row.source_name !== '' ? { sourceName: row.source_name } : {}),
		...(row.service_name !== '' ? { serviceName: row.service_name } : {}),
		meterName: row.scope_name,
		pointCount: Number(row.point_count),
	};
	if (row.type === 'histogram') {
		return {
			...base,
			type: 'histogram',
			temporality: Number(row.temporality ?? 0) as AggregationTemporality,
			...(row.time_unix_nano !== null
				? {
						latest: {
							kind: 'histogram' as const,
							timeUnixNano: row.time_unix_nano,
							count: Number(row.count ?? 0),
							...(row.sum !== null ? { sum: row.sum } : {}),
						},
					}
				: {}),
		};
	}
	return {
		...base,
		type: row.type === 'sum' ? 'sum' : 'gauge',
		...(row.type === 'sum'
			? {
					isMonotonic: row.is_monotonic === 1n,
					temporality: Number(row.temporality ?? 0) as AggregationTemporality,
				}
			: {}),
		...(row.time_unix_nano !== null
			? {
					latest: {
						kind: 'number' as const,
						timeUnixNano: row.time_unix_nano,
						value: row.value ?? 0,
					},
				}
			: {}),
	};
}

function numberPointFromRow(row: PointRow): NumberDataPoint {
	return {
		...(row.start_time_unix_nano !== null ? { startTimeUnixNano: row.start_time_unix_nano } : {}),
		timeUnixNano: row.time_unix_nano,
		value: row.value ?? 0,
		attributes: decodeAttributes(row.attributes),
		...(row.flags !== null ? { flags: Number(row.flags) } : {}),
	};
}

function histogramPointFromRow(row: PointRow): HistogramDataPoint {
	return {
		...(row.start_time_unix_nano !== null ? { startTimeUnixNano: row.start_time_unix_nano } : {}),
		timeUnixNano: row.time_unix_nano,
		count: Number(row.count ?? 0),
		...(row.sum !== null ? { sum: row.sum } : {}),
		...(row.min !== null ? { min: row.min } : {}),
		...(row.max !== null ? { max: row.max } : {}),
		bucketCounts: decodeJson<number[]>(row.bucket_counts, []),
		explicitBounds: decodeJson<number[]>(row.explicit_bounds, []),
		attributes: decodeAttributes(row.attributes),
		...(row.flags !== null ? { flags: Number(row.flags) } : {}),
	};
}
