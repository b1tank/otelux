# @otelux/adapter-direct

In-process `DataSource` implementation. Wraps an `@otelux/engine` instance so that `@otelux/ui` can talk to it directly inside the same process — used today by the Electron renderer-over-IPC bridge in `apps/desktop`.

For sandboxed webviews, use `@otelux/adapter-vscode`, which provides the same `DataSource` shape over host/webview `postMessage`.
