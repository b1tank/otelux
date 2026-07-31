import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogRecord } from '@otelux/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SchemaVersionError, openDatabase, openDatabaseWithRecovery } from './db.js';
import { createNodeSqliteStorage } from './index.js';
import { SPAN_COLUMN_DEFINITIONS, SPAN_COLUMN_NAMES } from './schema.js';

function userVersion(db: ReturnType<typeof openDatabase>): number {
	const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
	return Number(row.user_version);
}

const SAMPLE_LOG: LogRecord = {
	timeUnixNano: 1n,
	severityNumber: 9,
	body: 'ok',
	attributes: {},
	resource: { attributes: { 'service.name': 'svc' } },
	scope: { name: 's' },
};

describe('db schema versioning and recovery', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'otelux-db-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('bootstraps a fresh database to the current schema version', () => {
		const db = openDatabase(join(dir, 'otelux.db'));
		expect(userVersion(db)).toBe(3);
		db.close();
	});

	it('migrates v1 spans to composite trace and span identity without losing data', () => {
		const path = join(dir, 'otelux.db');
		const db = openDatabase(path);
		db.exec(`
INSERT INTO resources (id, hash, service_name, attributes) VALUES (1, 'resource', 'svc', '{}');
INSERT INTO scopes (id, hash, name) VALUES (1, 'scope', 'test');
`);
		db
			.prepare(`INSERT INTO spans (${SPAN_COLUMN_NAMES}) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)`)
			.run(
				'1'.repeat(16),
				'a'.repeat(32),
				null,
				'persisted-v1-span',
				1,
				1n,
				2n,
				0,
				null,
				null,
				'{}',
				null,
				null,
				null,
				null,
				null,
				1,
				1,
				'svc',
				3n,
			);
		const insertTrace = db.prepare(`INSERT INTO traces (
  trace_id, root_span_id, root_name, start_unix_nano, end_unix_nano,
  duration_nanos, span_count, error_count, services, ingested_unix_nano
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
		insertTrace.run(
			'a'.repeat(32),
			'missing-root',
			'stale-name',
			0n,
			99n,
			99n,
			9,
			9,
			'["stale"]',
			99n,
		);
		insertTrace.run('b'.repeat(32), null, 'ghost', 0n, 1n, 1n, 1, 0, '[]', 1n);
		rebuildSpanTableAsV1(db);
		db.close();

		const migrated = openDatabase(path);
		expect(userVersion(migrated)).toBe(3);
		expect(migrated.prepare('SELECT trace_id, span_id, name FROM spans').get()).toEqual({
			trace_id: 'a'.repeat(32),
			span_id: '1'.repeat(16),
			name: 'persisted-v1-span',
		});
		const primaryKey = migrated.prepare('PRAGMA table_info(spans)').all() as Array<{
			name: string;
			pk: number;
		}>;
		expect(
			primaryKey
				.filter((column) => column.pk > 0)
				.sort((a, b) => a.pk - b.pk)
				.map((column) => column.name),
		).toEqual(['trace_id', 'span_id']);
		expect(
			migrated
				.prepare(
					'SELECT root_span_id, root_name, start_unix_nano, end_unix_nano, duration_nanos, span_count, error_count, services FROM traces WHERE trace_id = ?',
				)
				.get('a'.repeat(32)),
		).toEqual({
			root_span_id: '1'.repeat(16),
			root_name: 'persisted-v1-span',
			start_unix_nano: 1,
			end_unix_nano: 2,
			duration_nanos: 1,
			span_count: 1,
			error_count: 0,
			services: '["svc"]',
		});
		expect(
			migrated.prepare('SELECT COUNT(*) AS n FROM traces WHERE trace_id = ?').get('b'.repeat(32)),
		).toEqual({ n: 0 });
		migrated.close();
	});

	it('preserves a v1 database when migration fails and retries it on the next open', () => {
		const path = join(dir, 'otelux.db');
		const db = openDatabase(path);
		db.exec(`
INSERT INTO resources (id, hash, service_name, attributes) VALUES (1, 'resource', 'svc', '{}');
INSERT INTO scopes (id, hash, name) VALUES (1, 'scope', 'test');
`);
		db
			.prepare(`INSERT INTO spans (${SPAN_COLUMN_NAMES}) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)`)
			.run(
				'1'.repeat(16),
				'a'.repeat(32),
				null,
				'preserved-v1-span',
				1,
				1n,
				2n,
				0,
				null,
				null,
				'{}',
				null,
				null,
				null,
				null,
				null,
				1,
				1,
				'svc',
				3n,
			);
		rebuildSpanTableAsV1(db);
		// Simulate a retryable migration failure without corrupting schema v1.
		db.exec('CREATE TABLE spans_v2 (blocker TEXT)');

		expect(() => openDatabaseWithRecovery(path)).toThrow(
			'Failed to migrate OTelux database schema from version 1 to 2',
		);
		expect(userVersion(db)).toBe(1);
		expect(db.prepare('SELECT name FROM spans').get()).toEqual({ name: 'preserved-v1-span' });
		expect(readdirSync(dir).some((file) => file.startsWith('otelux.db.corrupt-'))).toBe(false);

		db.exec('DROP TABLE spans_v2');
		db.close();
		const retried = openDatabaseWithRecovery(path);
		expect(userVersion(retried)).toBe(3);
		expect(retried.prepare('SELECT name FROM spans').get()).toEqual({
			name: 'preserved-v1-span',
		});
		retried.close();
	});

	it('migrates v2 trace service JSON into the normalized membership table', () => {
		const path = join(dir, 'otelux.db');
		const db = openDatabase(path);
		db.exec(`
INSERT INTO traces (
  trace_id, root_name, start_unix_nano, end_unix_nano, duration_nanos,
  span_count, error_count, services, ingested_unix_nano
) VALUES ('${'a'.repeat(32)}', 'root', 1, 2, 1, 1, 0, '["api","worker"]', 3);
DROP TABLE trace_services;
PRAGMA user_version = 2;
`);
		db.close();

		const migrated = openDatabase(path);
		expect(userVersion(migrated)).toBe(3);
		expect(
			migrated.prepare('SELECT service_name FROM trace_services ORDER BY service_name').all(),
		).toEqual([{ service_name: 'api' }, { service_name: 'worker' }]);
		migrated.close();
	});

	it('reopens an existing database at the same version without wiping data', () => {
		const path = join(dir, 'otelux.db');
		const first = createNodeSqliteStorage({ path, pruneIntervalMs: 0 });
		first.writeLogs([SAMPLE_LOG]);
		first.close();

		const second = createNodeSqliteStorage({ path, pruneIntervalMs: 0 });
		expect(second.listLogs({}).totalCount).toBe(1);
		second.close();
	});

	it('throws SchemaVersionError for a database written by a newer version', () => {
		const path = join(dir, 'otelux.db');
		const db = openDatabase(path);
		db.exec('PRAGMA user_version = 999');
		db.close();

		expect(() => openDatabase(path)).toThrow(SchemaVersionError);
	});

	it('quarantines a newer-version database and starts fresh via recovery', () => {
		const path = join(dir, 'otelux.db');
		const db = openDatabase(path);
		db.exec('PRAGMA user_version = 999');
		db.close();

		const recovered = openDatabaseWithRecovery(path);
		expect(userVersion(recovered)).toBe(3);
		recovered.close();

		const quarantined = readdirSync(dir).filter((f) => f.startsWith('otelux.db.corrupt-'));
		expect(quarantined.length).toBeGreaterThan(0);
	});

	it('quarantines a corrupt file and starts a fresh, usable database', () => {
		const path = join(dir, 'otelux.db');
		// Not a SQLite file — SQLite rejects it on the first access.
		writeFileSync(path, 'this is not a sqlite database, just garbage bytes');

		const storage = createNodeSqliteStorage({ path, pruneIntervalMs: 0 });
		expect(storage.listLogs({}).totalCount).toBe(0);
		storage.writeLogs([SAMPLE_LOG]);
		expect(storage.listLogs({}).totalCount).toBe(1);
		storage.close();

		const quarantined = readdirSync(dir).filter((f) => f.startsWith('otelux.db.corrupt-'));
		expect(quarantined.length).toBeGreaterThan(0);
	});
});

function rebuildSpanTableAsV1(db: ReturnType<typeof openDatabase>): void {
	db.exec(`
BEGIN IMMEDIATE;
CREATE TABLE spans_v1 (
${SPAN_COLUMN_DEFINITIONS},
  PRIMARY KEY (span_id)
);
INSERT INTO spans_v1 (${SPAN_COLUMN_NAMES}) SELECT ${SPAN_COLUMN_NAMES} FROM spans;
DROP TABLE spans;
ALTER TABLE spans_v1 RENAME TO spans;
CREATE INDEX idx_spans_trace    ON spans(trace_id);
CREATE INDEX idx_spans_start    ON spans(start_unix_nano);
CREATE INDEX idx_spans_ingested ON spans(ingested_unix_nano);
PRAGMA user_version = 1;
COMMIT;
`);
}
