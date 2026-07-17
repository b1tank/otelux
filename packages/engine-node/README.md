# @otelux/engine-node

`node:sqlite` storage adapter for `@otelux/engine`. Requires Node 22+ (the SQLite module is built in — no native compile, no node-gyp).

`createNodeSqliteStorage()` provides durable trace, log, and metric storage through `DatabaseSync`, with WAL mode, prepared statements, materialized trace summaries, interned resources/scopes, and configurable age/size retention. Schema upgrades are forward-only and transactional: failed migrations leave the legacy database in place for retry, while unreadable or newer-schema files are quarantined before a fresh store is created.
