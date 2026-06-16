/**
 * Webview entry. Mounts the OTelux workbench inside the VS Code
 * webview, wired to the extension host via the postMessage bridge in
 * `@otelux/adapter-vscode`.
 *
 * The workbench root sets `data-host="vscode"` so token CSS in
 * `@otelux/ui` remaps `--otelux-*` to the user's VS Code theme.
 */

import { OTeluxWorkbench } from '@otelux/ui';
import '@otelux/ui/workbench.css';
import { createPostMessageDataSource } from '@otelux/adapter-vscode';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

interface VsCodeApi {
	postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = acquireVsCodeApi();
const dataSource = createPostMessageDataSource({
	vscode: vscodeApi,
	// `message` events on `window` carry both bridge envelopes and any
	// VS Code internal traffic; the bridge filters by envelope tag.
	target: window,
});

const container = document.getElementById('root');
if (container) {
	createRoot(container).render(
		<StrictMode>
			<div className="otelux-workbench" data-host="vscode">
				<OTeluxWorkbench dataSource={dataSource} />
			</div>
		</StrictMode>,
	);
}
