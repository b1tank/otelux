/**
 * node:sqlite storage adapter for @otelux/engine.
 *
 * A durable, on-disk store built on Node's built-in `node:sqlite`
 * (`DatabaseSync`) — no native addon, no node-gyp, no prebuilds. It implements
 * the same {@link Storage} contract the memory backend does, so the engine,
 * UI, and MCP tools are unaware of where telemetry lives, and adds two things
 * the memory store cannot: persistence across restarts and user-configurable
 * retention (age and size bounds).
 *
 * The schema is generalizable for OpenTelemetry — attribute bags ride as JSON
 * rather than being exploded into convention-specific columns — while hot
 * filter/sort fields are promoted to indexed columns for query efficiency. See
 * `schema.ts` for the layout.
 */

import { chmodSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { FullListLogsResult, Storage } from '@otelux/engine';
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
	StorageUsageInfo,
} from '@otelux/protocol';
import type { LogRecord, Metric, Span, SpanId, TraceId } from '@otelux/types';
import { openDatabaseWithRecovery } from './db.js';
import { listResourceFacets } from './facets.js';
import { Interner } from './intern.js';
import { LogStore } from './logs.js';
import { MetricStore } from './metrics.js';
import { type RetentionConfig, databasePageBytes, pruneRetention } from './retention.js';
import { SpanStore } from './spans.js';

export type { RetentionConfig } from './retention.js';
export { SchemaVersionError } from './db.js';

export interface NodeSqliteStorageOptions {
	/** Path to the SQLite file. Use `:memory:` for ephemeral tests. */
	path: string;
	/**
	 * Retention bounds. Defaults to unlimited (`0`/`0`) so tests and callers
	 * that do not care never prune; the desktop host passes the user's setting.
	 */
	retention?: RetentionConfig;
	/**
	 * Background prune interval in milliseconds. `0` disables the timer (tests
	 * drive {@link NodeSqliteStorage.prune} directly). The timer is `unref`'d so
	 * it never keeps the process alive on its own.
	 */
	pruneIntervalMs?: number;
	/** Injectable wall clock in Unix nanoseconds. Defaults to `Date.now()`. */
	now?: () => bigint;
}

/**
 * Storage plus retention controls. Every method is synchronous — `node:sqlite`
 * `DatabaseSync` is a blocking API — so the signatures are narrowed from the
 * base {@link Storage} (whose methods are `T | Promise<T>`) to plain `T`. That
 * is a valid subtype and lets callers use results without awaiting. The engine
 * only sees {@link Storage}; the desktop host keeps this wider handle so it can
 * re-apply retention when the user changes the setting.
 */
export interface NodeSqliteStorage extends Storage {
	writeSpans(spans: readonly Span[]): void;
	listTraces(query: ListTracesQuery): ListTracesResult;
	getTraceSpans(traceId: TraceId): readonly Span[];
	getSpan(traceId: TraceId, spanId: SpanId): Span | undefined;
	writeLogs(logs: readonly LogRecord[]): void;
	listLogs(query: ListLogsQuery): ListLogsResult;
	getLog(logId: string): LogRecord | undefined;
	searchLogs(query: ListLogsQuery): FullListLogsResult;
	writeMetrics(metrics: readonly Metric[]): void;
	listMetricInstruments(query: ListMetricInstrumentsQuery): ListMetricInstrumentsResult;
	getMetricPoints(query: GetMetricPointsQuery): GetMetricPointsResult | undefined;
	listMetrics(query: ListMetricsQuery): ListMetricsResult;
	listResourceFacets(query: ListResourceFacetsQuery): ListResourceFacetsResult;
	getStorageUsage(): StorageUsageInfo;
	clear(): void;
	close(): void;
	/** Replace the retention config and prune immediately against it. */
	applyRetention(config: RetentionConfig): void;
	/** Run a retention pass now (used by the background timer and on demand). */
	prune(): void;
}

const DEFAULT_RETENTION: RetentionConfig = { maxAgeHours: 0, maxSizeMb: 0 };
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

function defaultNow(): bigint {
	// Date.now() is millisecond precision; scale to the nanosecond wire unit.
	return BigInt(Date.now()) * 1_000_000n;
}

function hardenDatabaseFiles(path: string): void {
	if (path === ':memory:' || process.platform === 'win32') return;
	for (const file of [path, `${path}-wal`, `${path}-shm`]) {
		try {
			chmodSync(file, 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
}

function fileSize(path: string): number {
	try {
		return statSync(path).size;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return 0;
		}
		throw error;
	}
}

export function createNodeSqliteStorage(options: NodeSqliteStorageOptions): NodeSqliteStorage {
	const now = options.now ?? defaultNow;
	let retention = options.retention ?? DEFAULT_RETENTION;

	const db: DatabaseSync = openDatabaseWithRecovery(options.path);
	hardenDatabaseFiles(options.path);
	const interner = new Interner(db);
	const spans = new SpanStore(db, interner);
	const logs = new LogStore(db, interner);
	const metrics = new MetricStore(db, interner);

	const prune = (): void => {
		pruneRetention(db, retention, now());
		hardenDatabaseFiles(options.path);
	};

	const intervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
	let timer: ReturnType<typeof setInterval> | undefined;
	if (intervalMs > 0) {
		timer = setInterval(prune, intervalMs);
		// Do not let the prune timer hold the event loop open.
		timer.unref?.();
	}

	return {
		kind: 'otelux/storage',

		writeSpans(input: readonly Span[]): void {
			spans.write(input, now());
			hardenDatabaseFiles(options.path);
		},
		listTraces(query: ListTracesQuery): ListTracesResult {
			return spans.listTraces(query);
		},
		getTraceSpans(traceId: TraceId): readonly Span[] {
			return spans.getTraceSpans(traceId);
		},
		getSpan(traceId: TraceId, spanId: SpanId): Span | undefined {
			return spans.getSpan(traceId, spanId);
		},

		writeLogs(input: readonly LogRecord[]): void {
			logs.write(input, now());
			hardenDatabaseFiles(options.path);
		},
		listLogs(query: ListLogsQuery): ListLogsResult {
			return logs.listLogs(query);
		},
		getLog(logId: string): LogRecord | undefined {
			return logs.getLog(logId);
		},
		searchLogs(query: ListLogsQuery): FullListLogsResult {
			return logs.searchLogs(query);
		},

		writeMetrics(input: readonly Metric[]): void {
			metrics.write(input, now());
			hardenDatabaseFiles(options.path);
		},
		listMetricInstruments(query: ListMetricInstrumentsQuery): ListMetricInstrumentsResult {
			return metrics.listMetricInstruments(query);
		},
		getMetricPoints(query: GetMetricPointsQuery): GetMetricPointsResult | undefined {
			return metrics.getMetricPoints(query);
		},
		listMetrics(query: ListMetricsQuery): ListMetricsResult {
			return metrics.listMetrics(query);
		},
		listResourceFacets(query: ListResourceFacetsQuery): ListResourceFacetsResult {
			return listResourceFacets(db, query);
		},
		getStorageUsage(): StorageUsageInfo {
			const inMemory = options.path === ':memory:';
			const databaseFileBytes = inMemory ? 0 : fileSize(options.path);
			const walBytes = inMemory ? 0 : fileSize(`${options.path}-wal`);
			const sharedMemoryBytes = inMemory ? 0 : fileSize(`${options.path}-shm`);
			return {
				activePath: options.path,
				retentionBytes: databasePageBytes(db),
				databaseFileBytes,
				walBytes,
				sharedMemoryBytes,
				totalBytes: databaseFileBytes + walBytes + sharedMemoryBytes,
			};
		},

		applyRetention(config: RetentionConfig): void {
			retention = config;
			prune();
		},
		prune,

		clear(): void {
			// Delete every fact and dimension table. Order respects the foreign
			// keys (children before parents) since `foreign_keys = ON`. The
			// interner's in-memory hash→id cache must be reset too, or the next
			// write would reference resource/scope rows that no longer exist.
			db.exec('BEGIN');
			try {
				for (const table of [
					'metric_points',
					'metric_instruments',
					'spans',
					'traces',
					'logs',
					'resources',
					'scopes',
				]) {
					db.exec(`DELETE FROM ${table}`);
				}
				db.exec('COMMIT');
			} catch (err) {
				db.exec('ROLLBACK');
				throw err;
			}
			interner.reset();
			// Reclaim the freed pages so clearing actually shrinks the file.
			db.exec('PRAGMA incremental_vacuum');
			hardenDatabaseFiles(options.path);
		},

		close(): void {
			if (timer !== undefined) {
				clearInterval(timer);
			}
			db.close();
		},
	};
}

export const OTELUX_ENGINE_NODE_VERSION = '0.1.0' as const;
