# @otelux/adapter-direct

In-process `DataSource` implementation. Wraps an `@otelux/engine`
instance so that `@otelux/ui` can talk to it directly inside the same
process — used today by the Electron renderer-over-IPC bridge in
`apps/desktop`.

For sandboxed webviews, a future `@otelux/adapter-vscode` package will
provide a postMessage-bridged `DataSource` (planned in
[docs/plan.md](../../docs/plan.md) Phase 9).
