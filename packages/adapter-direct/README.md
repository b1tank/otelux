# @otelux/adapter-direct

In-process `DataSource` implementation. Wraps an `@otelux/engine` instance so
that `@otelux/ui` can talk to it directly inside the same process (Electron
renderer-over-IPC, web demo). For sandboxed webviews use
`@otelux/adapter-vscode`.
