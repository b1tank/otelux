import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogRecord } from '@otelux/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SchemaVersionError, openDatabase, openDatabaseWithRecovery } from './db.js';
import { createNodeSqliteStorage } from './index.js';

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
		expect(userVersion(db)).toBe(1);
		db.close();
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
		expect(userVersion(recovered)).toBe(1);
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
