# @otelux/local-runtime

The single-process local OTelux backend. It owns the active SQLite database, retention, OTLP/HTTP receiver, authenticated MCP listener, settings, sample data, and runtime events.

Desktop currently embeds this package in its main process. The CLI and agent MCP launcher will use the same API when the runtime moves into a separately managed daemon. Clients query it through the shared `DataSource` contract and must never open the active database directly.