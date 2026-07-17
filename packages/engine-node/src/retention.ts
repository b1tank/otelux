import type { DatabaseSync } from 'node:sqlite';

/** Retention bounds. `0` on either axis disables that bound. */
export interface RetentionConfig {
	/** Drop telemetry older than this many hours. `0` = no age limit. */
	readonly maxAgeHours: number;
	/** Prune oldest telemetry once the DB exceeds this size. `0` = no size limit. */
	readonly maxSizeMb: number;
}

const NANOS_PER_HOUR = 3_600_000_000_000n;
const BYTES_PER_MB = 1024 * 1024;

// Size pruning deletes the oldest fraction of each signal per round and repeats
// until the DB is under the cap. A fraction (not a fixed batch) converges in a
// bounded number of rounds regardless of how far over the cap we are, and stops
// close to the cap instead of overshooting to empty. Small stores get a floor
// so we still make progress when a fraction rounds down to a handful of rows.
const SIZE_PRUNE_FRACTION = 0.1;
const SIZE_PRUNE_FLOOR = 100;
const MAX_SIZE_PRUNE_ROUNDS = 200;

/**
 * Enforce retention against the store. Telemetry is pruned when EITHER bound
 * is exceeded, evaluated against wall-clock arrival time (`ingested_unix_nano`)
 * so a client with a skewed event clock cannot pin data forever.
 *
 * Spans are pruned by whole trace (never a partial trace) so the materialized
 * `traces` rollup stays consistent. Logs and metric points prune per row.
 * Freed pages are reclaimed via `PRAGMA incremental_vacuum`.
 */
export function pruneRetention(
	db: DatabaseSync,
	config: RetentionConfig,
	nowUnixNano: bigint,
): void {
	if (config.maxAgeHours > 0) {
		pruneByAge(db, config.maxAgeHours, nowUnixNano);
	}
	if (config.maxSizeMb > 0) {
		pruneBySize(db, config.maxSizeMb);
	}
	// Reclaim space freed by the deletes above (no-op when nothing was freed).
	db.exec('PRAGMA incremental_vacuum');
}

function pruneByAge(db: DatabaseSync, maxAgeHours: number, nowUnixNano: bigint): void {
	const cutoff = nowUnixNano - BigInt(maxAgeHours) * NANOS_PER_HOUR;
	// Whole-trace deletion keeps the rollup consistent: a trace is dropped only
	// once it has received no spans since the cutoff.
	db
		.prepare(
			'DELETE FROM spans WHERE trace_id IN (SELECT trace_id FROM traces WHERE ingested_unix_nano < ?)',
		)
		.run(cutoff);
	db.prepare('DELETE FROM traces WHERE ingested_unix_nano < ?').run(cutoff);
	db.prepare('DELETE FROM logs WHERE ingested_unix_nano < ?').run(cutoff);
	db.prepare('DELETE FROM metric_points WHERE ingested_unix_nano < ?').run(cutoff);
	// Idle instruments (no export since the cutoff); their points cascade.
	db.prepare('DELETE FROM metric_instruments WHERE updated_unix_nano < ?').run(cutoff);
}

function pruneBySize(db: DatabaseSync, maxSizeMb: number): void {
	const capBytes = maxSizeMb * BYTES_PER_MB;
	for (let round = 0; round < MAX_SIZE_PRUNE_ROUNDS; round++) {
		if (databasePageBytes(db) <= capBytes) {
			return;
		}
		const removed = deleteOldestFraction(db);
		if (removed === 0) {
			// Nothing left to delete; the floor size (schema + WAL) exceeds the
			// cap. Stop rather than spin — the user set an unrealistically small
			// limit, and an empty DB is the best we can do.
			return;
		}
		db.exec('PRAGMA incremental_vacuum');
	}
}

/**
 * Delete the oldest {@link SIZE_PRUNE_FRACTION} of each signal (with a floor).
 * Traces are dropped whole (with their spans); logs and metric points drop per
 * row. Returns the total rows removed so the caller can detect "nothing left".
 */
function deleteOldestFraction(db: DatabaseSync): number {
	let removed = 0;

	const traceCount = countRows(db, 'traces');
	const traceBatch = batchSize(traceCount);
	if (traceBatch > 0) {
		const oldestTraces = db
			.prepare('SELECT trace_id FROM traces ORDER BY ingested_unix_nano ASC LIMIT ?')
			.all(traceBatch) as Array<{ trace_id: string }>;
		if (oldestTraces.length > 0) {
			const placeholders = oldestTraces.map(() => '?').join(', ');
			const ids = oldestTraces.map((t) => t.trace_id);
			db.prepare(`DELETE FROM spans WHERE trace_id IN (${placeholders})`).run(...ids);
			removed += db.prepare(`DELETE FROM traces WHERE trace_id IN (${placeholders})`).run(...ids)
				.changes as number;
		}
	}

	const logBatch = batchSize(countRows(db, 'logs'));
	if (logBatch > 0) {
		removed += db
			.prepare(
				'DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY ingested_unix_nano ASC LIMIT ?)',
			)
			.run(logBatch).changes as number;
	}

	const pointBatch = batchSize(countRows(db, 'metric_points'));
	if (pointBatch > 0) {
		removed += db
			.prepare(
				'DELETE FROM metric_points WHERE id IN (SELECT id FROM metric_points ORDER BY ingested_unix_nano ASC LIMIT ?)',
			)
			.run(pointBatch).changes as number;
	}

	// Drop instruments that lost their last point so the explorer does not show
	// an empty series.
	db.exec(
		'DELETE FROM metric_instruments WHERE id NOT IN (SELECT DISTINCT instrument_id FROM metric_points)',
	);

	return removed;
}

function batchSize(count: number): number {
	if (count === 0) {
		return 0;
	}
	return Math.min(count, Math.max(SIZE_PRUNE_FLOOR, Math.ceil(count * SIZE_PRUNE_FRACTION)));
}

function countRows(db: DatabaseSync, table: string): number {
	// `table` is a fixed internal literal, never user input — safe to inline.
	return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** Bytes in SQLite pages, matching the quantity enforced by size retention. */
export function databasePageBytes(db: DatabaseSync): number {
	const pageCount = (db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count;
	const pageSize = (db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size;
	return pageCount * pageSize;
}
