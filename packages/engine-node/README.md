# @otelux/engine-node

`node:sqlite` storage adapter for `@otelux/engine`. Requires Node 22+
(the SQLite module is built in — no native compile, no node-gyp).

Milestone 1 ships an in-memory passthrough: `createNodeSqliteStorage()`
currently forwards to `@otelux/engine`'s `createMemoryStorage()` so
downstream code can already depend on this package and pick up the real
implementation transparently. The persistent `DatabaseSync`-backed store
(schema versioning, WAL pragma, retention) lands in Milestone 2.
