/**
 * Commands that write per-tool MCP server registrations so the user
 * can wire OTelux into Codex CLI / Claude Code / Cursor with a single
 * click. Each agent has its own JSON config location — we write
 * idempotently and surface the file path so users can audit changes.
 *
 * GitHub Copilot uses a different path (vscode.lm.registerTool, set up
 * in lmTools.ts) and does not need a config-file edit.
 *
 * Current state: commands describe the intended config target so the UX is in
 * place. Durable, tested disk-write logic is planned work.
 */

import * as vscode from 'vscode';

export interface AgentEnablementOptions {
	readonly mcpPort: number;
}

export function registerAgentEnablementCommands(
	context: vscode.ExtensionContext,
	options: AgentEnablementOptions,
): void {
	const agents: ReadonlyArray<{ id: string; label: string; configHint: string }> = [
		{
			id: 'otelux.enableCopilotMcp',
			label: 'GitHub Copilot',
			// Copilot uses workspace settings rather than a separate MCP config.
			configHint: 'settings.json -> github.copilot.advanced.mcpServers',
		},
		{
			id: 'otelux.enableCodexMcp',
			label: 'OpenAI Codex CLI',
			configHint: '~/.codex/mcp.json',
		},
		{
			id: 'otelux.enableClaudeMcp',
			label: 'Claude Code',
			configHint: '~/.config/claude-code/mcp.json',
		},
		{
			id: 'otelux.enableCursorMcp',
			label: 'Cursor',
			configHint: '~/.cursor/mcp.json',
		},
	];

	for (const agent of agents) {
		const disposable = vscode.commands.registerCommand(agent.id, async () => {
			await vscode.window.showInformationMessage(
				`OTelux: connect ${agent.label} to MCP at http://127.0.0.1:${options.mcpPort}/ ` +
					`(planned write target: ${agent.configHint}). Disk write is planned work.`,
			);
		});
		context.subscriptions.push(disposable);
	}
}
