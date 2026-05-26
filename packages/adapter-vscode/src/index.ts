/**
 * @otelux/adapter-vscode — postMessage bridge for the `@otelux/ui`
 * workbench mounted inside a VS Code webview.
 *
 * The protocol is a request/response JSON-RPC carried on whatever
 * `postMessage` channel the host provides. Two surfaces ship from this
 * package:
 *
 * - {@link serveDataSource} runs on the **extension host** side. It
 *   pipes incoming requests into a `DataSource` (engine-backed,
 *   adapter-direct-backed, anything) and pushes `ChangeEvent`s back.
 * - {@link createPostMessageDataSource} runs on the **webview** side.
 *   It returns a `DataSource` whose every call serializes through
 *   `postMessage` and resolves when the host replies.
 *
 * Neither side imports `vscode` — the host adapter is structurally
 * typed against `{ postMessage, onDidReceiveMessage }` and the webview
 * adapter is structurally typed against `{ postMessage }` +
 * `window.addEventListener('message', ...)`. Keeps this package
 * webview-portable (it bundles into the CSP-clean webview build) and
 * easy to test without a VS Code runtime.
 */

export {
	serveDataSource,
	type ServeDataSourceOptions,
	type WebviewHostLike,
} from './host.js';
export {
	createPostMessageDataSource,
	type CreatePostMessageDataSourceOptions,
	type VsCodeWebviewApiLike,
} from './webview.js';
export type { BridgeMessage, BridgeRequest, BridgeResponse, BridgeEvent } from './protocol.js';

export const OTELUX_ADAPTER_VSCODE_VERSION = '0.1.0' as const;
