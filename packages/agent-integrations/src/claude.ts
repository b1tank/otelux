import { join } from 'node:path';
import type {
	AgentAdapter,
	AgentAdapterContext,
	AgentCapabilityState,
	AgentInspection,
	CommandResult,
} from './contracts.js';
import { parseAgentInspection } from './validation.js';

const descriptor = {
	id: 'claude-code' as const,
	displayName: 'Claude Code',
	documentationUrl: 'https://docs.anthropic.com/en/docs/claude-code/mcp',
};

export interface ClaudeCodeAdapterOptions {
	readonly executable?: string;
}

/**
 * Read-only Claude Code adapter, qualified against Claude Code 2.1.220.
 * It uses advertised CLI commands and never parses or mutates private config values.
 */
export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions = {}): AgentAdapter {
	const executable = options.executable ?? 'claude';
	return {
		descriptor,
		inspect: async (context) => parseAgentInspection(await inspectClaudeCode(context, executable)),
	};
}

async function inspectClaudeCode(
	context: AgentAdapterContext,
	executable: string,
): Promise<AgentInspection> {
	const versionResult = await context.commandRunner.run(executable, ['--version']);
	const version = parseVersion(versionResult);
	const detected = version !== undefined;
	const supported = version?.startsWith('2.') ?? false;
	const reason = detected
		? supported
			? undefined
			: `Claude Code ${version} is outside the qualified 2.x range`
		: 'Claude Code executable was not detected';
	const paths = await Promise.all([
		context.pathInspector.inspect({
			path: join(context.homeDirectory, '.claude.json'),
			allowedRoot: context.homeDirectory,
			scope: 'user',
			kind: 'file',
			hashContents: true,
		}),
		context.pathInspector.inspect({
			path: join(context.homeDirectory, '.claude', 'settings.json'),
			allowedRoot: context.homeDirectory,
			scope: 'user',
			kind: 'file',
			hashContents: true,
		}),
		context.pathInspector.inspect({
			path: join(context.workingDirectory, '.mcp.json'),
			allowedRoot: context.workingDirectory,
			scope: 'project',
			kind: 'file',
			hashContents: true,
		}),
		context.pathInspector.inspect({
			path: join(context.workingDirectory, '.claude', 'settings.json'),
			allowedRoot: context.workingDirectory,
			scope: 'project',
			kind: 'file',
			hashContents: true,
		}),
	]);
	let mcp: CommandResult | undefined;
	let plugins: CommandResult | undefined;
	if (detected && supported) {
		[mcp, plugins] = await Promise.all([
			context.commandRunner.run(executable, ['mcp', 'get', 'otelux']),
			context.commandRunner.run(executable, ['plugin', 'list', '--json']),
		]);
	}
	const mcpConfigured = mcp?.exitCode === 0;
	const mcpVerified =
		mcp !== undefined && mcpConfigured && /Status:\s*[✔✓]\s*Connected/i.test(mcp.stdout);
	const pluginConfigured = plugins?.exitCode === 0 && hasOteluxPlugin(plugins.stdout);
	const capabilities = capabilitiesFor({
		detected,
		supported,
		reason,
		mcpConfigured,
		mcpVerified,
		pluginConfigured,
	});
	const issues = [
		...(reason ? [reason] : []),
		...paths.flatMap((path) => path.issues.map((issue) => `${path.scope} ${path.kind}: ${issue}`)),
		...(mcpConfigured && !mcpVerified ? ['OTelux MCP is configured but not connected'] : []),
	];
	return {
		agent: descriptor,
		detected,
		installations: version
			? [
					{
						executable,
						version,
						supported,
						...(reason ? { reason } : {}),
					},
				]
			: [],
		capabilities,
		paths,
		restartRequired: false,
		issues,
	};
}

function parseVersion(result: CommandResult): string | undefined {
	if (result.exitCode !== 0) return undefined;
	return /^(\d+\.\d+\.\d+)\s+\(Claude Code\)\s*$/m.exec(result.stdout)?.[1];
}

function hasOteluxPlugin(value: string): boolean {
	try {
		const parsed = JSON.parse(value) as unknown;
		return (
			Array.isArray(parsed) &&
			parsed.some(
				(entry) =>
					typeof entry === 'object' &&
					entry !== null &&
					'id' in entry &&
					typeof entry.id === 'string' &&
					(entry.id === 'otelux' || entry.id.startsWith('otelux@')) &&
					(!('enabled' in entry) || entry.enabled === true),
			)
		);
	} catch {
		return false;
	}
}

function capabilitiesFor(input: {
	detected: boolean;
	supported: boolean;
	reason: string | undefined;
	mcpConfigured: boolean;
	mcpVerified: boolean;
	pluginConfigured: boolean;
}): AgentCapabilityState[] {
	if (!input.detected || !input.supported) {
		return (['mcp', 'skills', 'plugin', 'telemetry', 'sensitive-content'] as const).map((id) => ({
			id,
			support: input.detected ? 'unknown-version' : 'unsupported',
			configuration: 'unknown',
			verification: 'not-applicable',
			...(id === 'sensitive-content' ? { sensitive: true } : {}),
			...(input.reason ? { reason: input.reason } : {}),
		}));
	}
	return [
		{
			id: 'mcp',
			support: 'supported',
			configuration: input.mcpConfigured ? 'configured' : 'not-configured',
			verification: input.mcpVerified ? 'verified' : input.mcpConfigured ? 'failed' : 'not-verified',
		},
		{
			id: 'plugin',
			support: 'supported',
			configuration: input.pluginConfigured ? 'configured' : 'not-configured',
			verification: input.pluginConfigured ? 'not-verified' : 'not-applicable',
		},
		{
			id: 'skills',
			support: 'supported',
			configuration: input.pluginConfigured ? 'configured' : 'not-configured',
			verification: input.pluginConfigured ? 'not-verified' : 'not-applicable',
		},
		{
			id: 'telemetry',
			support: 'supported',
			configuration: 'unknown',
			verification: 'not-verified',
			reason: 'Telemetry configuration inspection is not implemented yet',
		},
		{
			id: 'sensitive-content',
			support: 'supported',
			configuration: 'unknown',
			verification: 'not-verified',
			sensitive: true,
			reason: 'Sensitive content remains a separate explicit opt-in',
		},
	];
}
