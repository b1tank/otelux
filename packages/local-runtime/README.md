# @otelux/local-runtime

The single-process local OTelux backend. It owns the active SQLite database, retention, OTLP/HTTP receiver, authenticated MCP listener, settings, sample data, and runtime events.

Desktop currently embeds this package in its main process. The CLI and agent MCP launcher will use the same API when the runtime moves into a separately managed daemon. Clients query it through the shared `DataSource` contract and must never open the active database directly.

`resolveOteluxDataDirectory()` selects the product-level data home shared by every form. `createLocalRuntime()` claims `runtime.lock` before migration or SQLite open, publishes owner-only `runtime.json` after listeners bind, and removes both files only when its ownership nonce still matches. Legacy Desktop data is copied atomically and resumably into an empty canonical home; source files are preserved, custom database paths stay external, and two populated default databases are reported as a conflict rather than merged.