/**
 * Register `vscode.lm.registerTool` handlers that delegate to the
 * same engine queries the MCP server uses. Copilot can then invoke
 * these tools by their `toolReferenceName` in chat (e.g. `#otelRecentErrors`).
 *
 * M1 stubs: the schemas exist and the handlers return engine-backed
 * data for the three "ready" tools. Logs and agent-run correlation
 * mirror the MCP-server stubs and return supported:false until the
 * engine grows the underlying capability.
 */

import * as vscode from 'vscode';
import type { Engine } from '@otelux/engine';
import { createMcpServer } from '@otelux/mcp-server';

export function registerLmTools(context: vscode.ExtensionContext, engine: Engine): void {
	// Build a transient MCP server purely so we can share its tool
	// dispatcher. This keeps the tool implementations defined exactly
	// once across MCP + LM Tools.
	const mcp = createMcpServer({ engine });

	for (const tool of mcp.tools) {
		const disposable = vscode.lm.registerTool(tool.name, {
			prepareInvocation: async () => ({
				invocationMessage: `Querying OpenTelemetry data: ${tool.name}`,
			}),
			invoke: async (request, _token) => {
				const response = await mcp.handle({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: tool.name, arguments: request.input as Record<string, unknown> },
				});
				if (response && 'error' in response) {
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(`Error: ${response.error.message}`),
					]);
				}
				const result = response && 'result' in response ? response.result : { content: [] };
				const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '';
				return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
			},
		});
		context.subscriptions.push(disposable);
	}
}
