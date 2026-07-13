/**
 * VS Code extension host entry point.
 *
 * Responsibilities on activation:
 * 1. Boot a shared OTelux engine (engine-node is a pass-through to
 *    in-memory storage until M2 lands the real node:sqlite store).
 * 2. Attempt to bind the OTLP receiver. If another OTelux instance
 *    already owns the port (single-instance lock from `@otelux/receiver`),
 *    register us as a client so we forward into the shared engine
 *    instead of binding twice.
 * 3. Optionally start the local MCP server so external agents
 *    (Codex CLI, Claude Code, Cursor) can call our tools over HTTP.
 * 4. Register vscode.lm tools so GitHub Copilot can call us in-IDE
 *    without ever leaving VS Code.
 * 5. Register the `otelux.openExplorer` command which opens the
 *    workbench in a WebviewPanel and wires `serveDataSource()` from
 *    `@otelux/adapter-vscode` to bridge the webview to the engine.
 *
 * This file is intentionally thin: it composes packages we already
 * tested rather than re-implementing anything.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import { createDirectDataSource } from '@otelux/adapter-direct';
import { serveDataSource } from '@otelux/adapter-vscode';
import { createEngine } from '@otelux/engine';
import { createNodeSqliteStorage } from '@otelux/engine-node';
import { createMcpServer, httpRouter } from '@otelux/mcp-server';
import { claimSingleInstance, createReceiver } from '@otelux/receiver';
import * as vscode from 'vscode';
import { registerAgentEnablementCommands } from './enableAgentIntegration.js';
import { registerLmTools } from './lmTools.js';

let disposeReceiver: (() => Promise<void>) | undefined;
let disposeMcp: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration('otelux');
	const receiverPort = config.get<number>('receiver.port', 4318);
	const mcpEnabled = config.get<boolean>('mcp.enabled', true);
	const mcpPort = config.get<number>('mcp.port', 4319);

	await fs.promises.mkdir(context.globalStorageUri.fsPath, { recursive: true });
	const storage = createNodeSqliteStorage({
		path: path.join(context.globalStorageUri.fsPath, 'otelux.sqlite'),
	});
	const engine = createEngine({ storage });

	// Receiver — co-exist with the desktop app via the single-instance
	// lockfile so both can be open at once without port conflicts.
	const claim = await claimSingleInstance({
		lockfile: path.join(context.globalStorageUri.fsPath, 'receiver.lock'),
		preferredPort: receiverPort,
		ping: async ({ host, port }) => {
			try {
				const res = await fetch(`http://${host}:${port}/healthz`);
				return res.ok;
			} catch {
				return false;
			}
		},
	});
	if (claim.role === 'owner') {
		const receiver = createReceiver({ engine, port: receiverPort });
		await receiver.start();
		disposeReceiver = async () => {
			await receiver.stop();
			await claim.release();
		};
	}

	if (mcpEnabled) {
		const mcp = createMcpServer({ engine });
		const router = httpRouter({ server: mcp });
		const httpServer: ServerType = serve({
			fetch: router.fetch,
			port: mcpPort,
			hostname: '127.0.0.1',
		});
		disposeMcp = () =>
			new Promise<void>((resolve, reject) => {
				httpServer.close((err) => (err ? reject(err) : resolve()));
			});
	}

	registerLmTools(context, engine);
	registerAgentEnablementCommands(context, { mcpPort });

	context.subscriptions.push(
		vscode.commands.registerCommand('otelux.openExplorer', async () => {
			const panel = vscode.window.createWebviewPanel(
				'otelux.explorer',
				'OTelux',
				vscode.ViewColumn.Active,
				{ enableScripts: true, retainContextWhenHidden: true },
			);
			const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'out', 'webview');
			panel.webview.options = { enableScripts: true, localResourceRoots: [webviewRoot] };
			panel.webview.html = renderWebviewHtml(panel.webview, webviewRoot);

			const dataSource = createDirectDataSource(engine);
			const subscription = serveDataSource({
				dataSource,
				webview: {
					// VS Code's postMessage returns `Thenable<boolean>`; the bridge
					// adapter only inspects `.then`, so widening to `Promise` via a
					// resolve wrapper keeps the structural type happy without
					// taking a dependency on Thenable.
					postMessage: (message) => Promise.resolve(panel.webview.postMessage(message)),
					onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
				},
			});
			panel.onDidDispose(() => subscription.dispose());
		}),
	);
}

export async function deactivate(): Promise<void> {
	await disposeMcp?.();
	await disposeReceiver?.();
}

function renderWebviewHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
	// Vite emits `index.html` + asset bundles into out/webview. We rewrite
	// the script/link srcs to webview-safe URIs and stamp a CSP that
	// allows only the bundled assets to load.
	const indexPath = vscode.Uri.joinPath(webviewRoot, 'index.html');
	let html = fs.readFileSync(indexPath.fsPath, 'utf8');
	html = html.replace(/(src|href)="\/?([^"]+)"/g, (_match, attr: string, src: string) => {
		const asset = vscode.Uri.joinPath(webviewRoot, src);
		return `${attr}="${webview.asWebviewUri(asset).toString()}"`;
	});
	const cspSource = webview.cspSource;
	const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource} data:; img-src ${cspSource} data:;">`;
	return html.replace('<head>', `<head>${csp}`);
}
