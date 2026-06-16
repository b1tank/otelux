# @otelux/adapter-vscode

`DataSource` bridge for VS Code extensions hosting the `@otelux/ui` workbench inside a webview.

Two halves, deliberately decoupled so neither side imports `vscode`:

- **Host side** — call `serveDataSource(webview, dataSource)` from your extension. It listens for `postMessage` requests from the webview and forwards them into the supplied `DataSource` (typically an engine via `@otelux/adapter-direct`). It also forwards engine `ChangeEvent`s back to the webview so live subscription works across the bridge.

- **Webview side** — call `createPostMessageDataSource(vscodeApi)` from the React entry that mounts `<OTeluxWorkbench>`. It returns a `DataSource` whose every call is a JSON-RPC over `acquireVsCodeApi(). postMessage`.

Wire protocol is a tagged-union `{ id, kind, ... }` carried on whatever the host's `webview.postMessage` accepts — VS Code-shaped, but the implementation only needs `{ postMessage, onDidReceiveMessage }` and works with any embedding that provides that.

## Status

Pre-release bridge. The shape follows [`@otelux/protocol`](../protocol/) and is used by `apps/vscode-extension`; hardening work remains around error states, timeouts, and subscription cleanup.
