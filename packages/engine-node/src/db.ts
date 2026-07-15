import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

type SqliteModule = typeof import('node:sqlite');

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
 * Open (or create) the OTelux SQLite database at `path` and bring it to the
 * current schema. `:memory:` gives an ephemeral store for tests.
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
	// auto_vacuum must be set before any table is created to take effect, so it
	// runs first on a fresh file. It is a no-op on an already-populated DB.
	db.exec('PRAGMA auto_vacuum = INCREMENTAL');
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA synchronous = NORMAL');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec(SCHEMA_SQL);
	db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
	return db;
}
