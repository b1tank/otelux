/**
 * node:sqlite storage adapter for @otelux/engine.
 *
 * Milestone 1 ships with the in-memory storage backend. The persistent
 * SQLite-backed store (using Node 22+ built-in `node:sqlite`
 * `DatabaseSync`, no node-gyp, no prebuilds) lands in Milestone 2.
 * Until then this package simply forwards to `createMemoryStorage` so
 * downstream code can already depend on `@otelux/engine-node` and pick
 * up the real implementation transparently.
 */

import { type Storage, createMemoryStorage } from '@otelux/engine';

export interface NodeSqliteStorageOptions {
	/** Path to the SQLite file. Use `:memory:` for ephemeral tests. */
	path: string;
}

export function createNodeSqliteStorage(_options: NodeSqliteStorageOptions): Storage {
	// TODO(Milestone 2): replace with DatabaseSync-backed implementation.
	return createMemoryStorage();
}

export const OTELUX_ENGINE_NODE_VERSION = '0.1.0' as const;
