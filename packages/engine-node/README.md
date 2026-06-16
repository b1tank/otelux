# @otelux/engine-node

`node:sqlite` storage adapter for `@otelux/engine`. Requires Node 22+ (the SQLite module is built in — no native compile, no node-gyp).

Current status: `createNodeSqliteStorage()` forwards to `@otelux/engine`'s `createMemoryStorage()` so downstream code can depend on this package while the durable implementation is being built. The planned `DatabaseSync`-backed store will add schema versioning, WAL mode, retention, and restart persistence.
