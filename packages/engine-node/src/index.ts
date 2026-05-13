/**
 * node:sqlite storage adapter for @otelux/engine.
 *
 * Uses Node 22+ built-in `node:sqlite` (DatabaseSync) — no native compile,
 * no node-gyp, no prebuilds. Schema versioning, WAL pragma, retention, and
 * the actual span/log/metric tables land in Phase 1.
 */

import type { Storage } from '@otelux/engine';

export interface NodeSqliteStorageOptions {
	/** Path to the SQLite file. Use `:memory:` for ephemeral tests. */
	path: string;
}

export function createNodeSqliteStorage(_options: NodeSqliteStorageOptions): Storage {
	// Phase 0 stub. Real DatabaseSync wiring lands in Phase 1.
	return {
		kind: 'otelux/storage',
		close() {},
	};
}

export const OTELUX_ENGINE_NODE_VERSION = '0.0.0' as const;
