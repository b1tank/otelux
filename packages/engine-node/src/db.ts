import { existsSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import {
	SCHEMA_SQL,
	SCHEMA_VERSION,
	SPAN_COLUMN_DEFINITIONS,
	SPAN_COLUMN_NAMES,
} from './schema.js';

type SqliteModule = typeof import('node:sqlite');

/**
 * Thrown when the on-disk database was written by a newer OTelux (its
 * `user_version` exceeds the version this build understands). We never migrate
 * a schema backwards, so the caller must decide what to do — the resilient
 * opener quarantines the file and starts fresh rather than risk corrupting the
 * newer data.
 */
export class SchemaVersionError extends Error {
	constructor(
		readonly found: number,
		readonly supported: number,
	) {
		super(`OTelux database schema version ${found} is newer than supported version ${supported}`);
		this.name = 'SchemaVersionError';
	}
}

class SchemaMigrationError extends Error {
	constructor(
		readonly from: number,
		readonly to: number,
		cause: unknown,
	) {
		super(`Failed to migrate OTelux database schema from version ${from} to ${to}`, { cause });
		this.name = 'SchemaMigrationError';
	}
}

interface Migration {
	/** Target `user_version` this migration produces. */
	readonly to: number;
	/** Apply the schema change. Runs inside the open database. */
	readonly apply: (db: DatabaseSync) => void;
}

/**
 * Ordered forward migrations, each bumping the schema by one version.
 */
const MIGRATIONS: readonly Migration[] = [
	{
		to: 2,
		apply: migrateSpansToCompositeIdentity,
	},
	{
		to: 3,
		apply: migrateTraceServices,
	},
];

/**
 * OTLP span IDs are unique only within a trace. Schema v1 incorrectly used
 * `span_id` as the sole primary key, allowing a span from another trace to
 * overwrite it. SQLite cannot alter a primary key in place, so rebuild the
 * table transactionally and copy every column unchanged.
 */
function migrateTraceServices(db: DatabaseSync): void {
	db.exec(`
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS trace_services (
  trace_id      TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  PRIMARY KEY (trace_id, service_name)
);
INSERT OR IGNORE INTO trace_services (trace_id, service_name)
SELECT traces.trace_id, json_each.value
FROM traces, json_each(traces.services)
WHERE json_each.type = 'text' AND json_each.value <> '';
CREATE INDEX IF NOT EXISTS idx_trace_services_service
  ON trace_services(service_name, trace_id);
COMMIT;
`);
}

function migrateSpansToCompositeIdentity(db: DatabaseSync): void {
	db.exec(`
BEGIN IMMEDIATE;
CREATE TABLE spans_v2 (
${SPAN_COLUMN_DEFINITIONS},
  PRIMARY KEY (trace_id, span_id)
);
INSERT INTO spans_v2 (${SPAN_COLUMN_NAMES})
SELECT ${SPAN_COLUMN_NAMES} FROM spans;
DROP TABLE spans;
ALTER TABLE spans_v2 RENAME TO spans;
CREATE INDEX idx_spans_trace    ON spans(trace_id, start_unix_nano, span_id);
CREATE INDEX idx_spans_parent   ON spans(trace_id, parent_span_id);
CREATE INDEX idx_spans_start    ON spans(start_unix_nano);
CREATE INDEX idx_spans_ingested ON spans(ingested_unix_nano);
DELETE FROM traces
WHERE NOT EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = traces.trace_id);
UPDATE traces
SET root_span_id = (
			SELECT s.span_id FROM spans s
			WHERE s.trace_id = traces.trace_id
			ORDER BY
				CASE WHEN s.parent_span_id IS NULL OR NOT EXISTS (
					SELECT 1 FROM spans parent
					WHERE parent.trace_id = s.trace_id AND parent.span_id = s.parent_span_id
				) THEN 0 ELSE 1 END,
				s.start_unix_nano,
				s.span_id
			LIMIT 1
		),
		root_name = (
			SELECT s.name FROM spans s
			WHERE s.trace_id = traces.trace_id
			ORDER BY
				CASE WHEN s.parent_span_id IS NULL OR NOT EXISTS (
					SELECT 1 FROM spans parent
					WHERE parent.trace_id = s.trace_id AND parent.span_id = s.parent_span_id
				) THEN 0 ELSE 1 END,
				s.start_unix_nano,
				s.span_id
			LIMIT 1
		),
		start_unix_nano = (SELECT MIN(s.start_unix_nano) FROM spans s WHERE s.trace_id = traces.trace_id),
		end_unix_nano = (SELECT MAX(s.end_unix_nano) FROM spans s WHERE s.trace_id = traces.trace_id),
		duration_nanos = (
			SELECT MAX(s.end_unix_nano) - MIN(s.start_unix_nano)
			FROM spans s WHERE s.trace_id = traces.trace_id
		),
		span_count = (SELECT COUNT(*) FROM spans s WHERE s.trace_id = traces.trace_id),
		error_count = (
			SELECT COUNT(*) FROM spans s
			WHERE s.trace_id = traces.trace_id AND s.status_code = 2
		),
		services = COALESCE((
			SELECT json_group_array(service_name)
			FROM (
				SELECT DISTINCT s.service_name AS service_name
				FROM spans s
				WHERE s.trace_id = traces.trace_id AND s.service_name <> ''
				ORDER BY s.service_name
			)
		), '[]'),
		ingested_unix_nano = (
			SELECT MAX(s.ingested_unix_nano) FROM spans s WHERE s.trace_id = traces.trace_id
		);
COMMIT;
`);
}

/**
 * Load the built-in `node:sqlite` module at runtime.
 *
 * A plain `import ... from 'node:sqlite'` does not survive bundling: esbuild
 * (via tsup, and again via the desktop's electron-vite build) does not
 * recognize this newer builtin and rewrites the specifier to a bare `sqlite`,
 * which fails to resolve at runtime (`ERR_MODULE_NOT_FOUND`). Loading through
 * `createRequire` with a specifier assembled at runtime keeps the bundler from
 * touching it, so the real `node:sqlite` is resolved by Node/Electron. The
 * type-only import above is erased and carries no such risk.
 */
function loadSqlite(): SqliteModule {
	const nodeRequire = createRequire(import.meta.url);
	// Assemble the specifier so the bundler cannot statically match 'node:sqlite'.
	const specifier = ['node', 'sqlite'].join(':');
	return nodeRequire(specifier) as SqliteModule;
}

/**
 * Bring an open database to the current schema version. A fresh (`user_version
 * 0`) file is bootstrapped; an older file is migrated forward step by step; a
 * newer file throws {@link SchemaVersionError}. The DDL is idempotent
 * (`CREATE ... IF NOT EXISTS`), so re-running it self-heals a partially created
 * schema without touching existing data.
 */
function initSchema(db: DatabaseSync): void {
	const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
	const version = Number(row.user_version);

	if (version === 0) {
		db.exec(SCHEMA_SQL);
		db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		return;
	}
	if (version > SCHEMA_VERSION) {
		throw new SchemaVersionError(version, SCHEMA_VERSION);
	}
	// Same-version open: ensure every table/index exists (self-heal).
	db.exec(SCHEMA_SQL);
	if (version < SCHEMA_VERSION) {
		for (const migration of MIGRATIONS) {
			if (migration.to > version && migration.to <= SCHEMA_VERSION) {
				try {
					migration.apply(db);
				} catch (err) {
					throw new SchemaMigrationError(version, migration.to, err);
				}
			}
		}
		db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
	}
}

/**
 * Open (or create) the OTelux SQLite database at `path` and bring it to the
 * current schema. `:memory:` gives an ephemeral store for tests. Throws if the
 * file cannot be opened, is corrupt, or was written by a newer schema version;
 * callers that need self-healing use {@link openDatabaseWithRecovery}.
 *
 * PRAGMAs:
 *  - `journal_mode = WAL`: readers (UI/MCP queries) never block the ingest
 *    writer and vice-versa — the workbench queries constantly while telemetry
 *    streams in. WAL is a no-op for `:memory:`.
 *  - `synchronous = NORMAL`: safe with WAL; trades a vanishingly small
 *    crash-durability window for far fewer fsyncs on a hot ingest path. Losing
 *    the last few milliseconds of local debug telemetry on power loss is
 *    acceptable for this product.
 *  - `foreign_keys = ON`: makes the `ON DELETE CASCADE` from instruments to
 *    points fire during retention pruning.
 *  - `auto_vacuum = INCREMENTAL`: lets retention reclaim freed pages via
 *    `PRAGMA incremental_vacuum` without a full, blocking `VACUUM`.
 */
export function openDatabase(path: string): DatabaseSync {
	const { DatabaseSync: DatabaseSyncCtor } = loadSqlite();
	const db = new DatabaseSyncCtor(path);
	try {
		// auto_vacuum must be set before any table is created to take effect, so
		// it runs first on a fresh file. It is a no-op on an already-populated DB.
		db.exec('PRAGMA auto_vacuum = INCREMENTAL');
		db.exec('PRAGMA journal_mode = WAL');
		db.exec('PRAGMA synchronous = NORMAL');
		db.exec('PRAGMA foreign_keys = ON');
		initSchema(db);
		return db;
	} catch (err) {
		// Close the handle so a resilient caller can rename the file (an open
		// handle blocks rename on Windows).
		try {
			db.close();
		} catch {
			// Already unusable; nothing to salvage.
		}
		throw err;
	}
}

/**
 * Open the database, recovering from an unusable file rather than failing the
 * whole app. If {@link openDatabase} throws for a real (non-`:memory:`) path —
 * a corrupt file, or one written by a newer schema version — the file (and its
 * `-wal`/`-shm` siblings) is renamed aside with a timestamp and a fresh
 * database is created in its place. The old data is preserved on disk for
 * manual recovery, never deleted. If the quarantine or the fresh open also
 * fails (e.g. a permission problem), the original error is rethrown so an
 * outer fallback (such as the desktop's default-path fallback) can take over.
 */
export function openDatabaseWithRecovery(path: string): DatabaseSync {
	try {
		return openDatabase(path);
	} catch (err) {
		// A failed forward migration has already rolled back when openDatabase
		// closed its handle. Keep the legacy database at its canonical path so a
		// corrected or transient failure can be retried on the next launch.
		if (path === ':memory:' || err instanceof SchemaMigrationError) {
			throw err;
		}
		try {
			const quarantined = quarantineDatabaseFile(path);
			console.warn(
				`[otelux] database at ${path} was unusable (${
					err instanceof Error ? err.message : String(err)
				}); moved it to ${quarantined} and started a fresh database`,
			);
			return openDatabase(path);
		} catch {
			// Recovery itself failed (e.g. the directory is not writable). Surface
			// the original problem so the caller can fall back elsewhere.
			throw err;
		}
	}
}

/**
 * Rename the database file and its WAL/SHM siblings aside with a timestamped
 * `.corrupt-*` suffix. Returns the quarantine path of the main file.
 */
function quarantineDatabaseFile(path: string): string {
	// Colons are invalid in Windows filenames, so use a filesystem-safe stamp.
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const dest = `${path}.corrupt-${stamp}`;
	for (const suffix of ['', '-wal', '-shm']) {
		const from = `${path}${suffix}`;
		if (existsSync(from)) {
			renameSync(from, `${dest}${suffix}`);
		}
	}
	return dest;
}
