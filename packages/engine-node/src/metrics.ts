import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { ListMetricsQuery, ListMetricsResult } from '@otelux/protocol';
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

interface PointRow {
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
	private readonly selectPoints: StatementSync;

	constructor(
		private readonly db: DatabaseSync,
		private readonly interner: Interner,
	) {
		this.insertInstrument = db.prepare(`
INSERT OR IGNORE INTO metric_instruments (
  identity, service_name, scope_name, name, description, unit, type,
  is_monotonic, temporality, resource_id, scope_id, updated_unix_nano
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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
		this.selectPoints = db.prepare(
			'SELECT * FROM metric_points WHERE instrument_id = ? ORDER BY id ASC',
		);
		this.selectPoints.setReadBigInts(true);
	}

	write(metrics: readonly Metric[], ingestedUnixNano: bigint): void {
		this.db.prepare('BEGIN').run();
		try {
			for (const metric of metrics) {
				const resourceId = this.interner.internResource(metric.resource);
				const scopeId = this.interner.internScope(metric.scope);
				const serviceName = serviceNameOf(metric.resource);
				const identity = [serviceName, metric.scope.name, metric.name, metric.type].join('\u0000');
				const isMonotonic = metric.type === 'sum' ? (metric.isMonotonic ? 1 : 0) : null;
				const temporality = metric.type === 'gauge' ? null : metric.temporality;
				this.insertInstrument.run(
					identity,
					serviceName,
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

	listMetrics(query: ListMetricsQuery): ListMetricsResult {
		const where: string[] = [];
		const params: Array<string | number | bigint> = [];
		if (query.services && query.services.length > 0) {
			where.push(`i.service_name IN (${query.services.map(() => '?').join(', ')})`);
			params.push(...query.services);
		}
		if (query.meters && query.meters.length > 0) {
			where.push(`i.scope_name IN (${query.meters.map(() => '?').join(', ')})`);
			params.push(...query.meters);
		}
		if (query.search) {
			where.push("(lower(i.name) LIKE ? OR lower(coalesce(i.description, '')) LIKE ?)");
			const needle = `%${query.search.toLowerCase()}%`;
			params.push(needle, needle);
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
ORDER BY i.scope_name ASC, i.name ASC
LIMIT ? OFFSET ?`);
		stmt.setReadBigInts(true);
		const rows = stmt.all(...params, BigInt(limit), BigInt(offset)) as unknown as InstrumentRow[];
		const metrics = rows.map((row) => this.metricFromRow(row));
		return { rows: metrics, totalCount: countRow.n };
	}

	private metricFromRow(row: InstrumentRow): Metric {
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
		const pointRows = this.selectPoints.all(row.id) as unknown as PointRow[];
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

function serviceNameOf(resource: Resource): string {
	const svc = resource.attributes['service.name'];
	return typeof svc === 'string' ? svc : '';
}
