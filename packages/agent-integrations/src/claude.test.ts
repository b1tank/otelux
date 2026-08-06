import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from './claude.js';
import type { AgentAdapterContext, CommandResult, InspectPathRequest } from './contracts.js';

function context(results: Record<string, CommandResult>): AgentAdapterContext {
	return {
		homeDirectory: '/home/test',
		workingDirectory: '/workspace',
		commandRunner: {
			run: async (_executable, args) =>
				results[args.join(' ')] ?? { exitCode: 1, stdout: '', stderr: 'not found' },
		},
		pathInspector: {
			inspect: async (request: InspectPathRequest) => ({
				path: request.path,
				scope: request.scope,
				kind: request.kind,
				exists: false,
				secure: true,
				issues: [],
			}),
		},
	};
}

describe('Claude Code read-only adapter', () => {
	it('detects qualified Claude, MCP connectivity, and the enabled plugin', async () => {
		const inspection = await createClaudeCodeAdapter().inspect(
			context({
				'--version': { exitCode: 0, stdout: '2.1.220 (Claude Code)\n', stderr: '' },
				'mcp get otelux': {
					exitCode: 0,
					stdout: 'otelux:\n  Status: ✔ Connected\n  Args: SECRET_VALUE',
					stderr: '',
				},
				'plugin list --json': {
					exitCode: 0,
					stdout: JSON.stringify([{ id: 'otelux@otelux-plugins', enabled: true }]),
					stderr: '',
				},
			}),
		);
		expect(inspection.detected).toBe(true);
		expect(inspection.installations[0]).toMatchObject({ version: '2.1.220', supported: true });
		expect(inspection.capabilities.find(({ id }) => id === 'mcp')).toMatchObject({
			configuration: 'configured',
			verification: 'verified',
		});
		expect(inspection.capabilities.find(({ id }) => id === 'plugin')).toMatchObject({
			configuration: 'configured',
		});
		expect(JSON.stringify(inspection)).not.toContain('SECRET_VALUE');
	});

	it('fails closed for an unqualified major version', async () => {
		const inspection = await createClaudeCodeAdapter().inspect(
			context({
				'--version': { exitCode: 0, stdout: '3.0.0 (Claude Code)\n', stderr: '' },
			}),
		);
		expect(inspection.installations[0]?.supported).toBe(false);
		expect(inspection.capabilities.every(({ support }) => support === 'unknown-version')).toBe(true);
		expect(inspection.issues[0]).toMatch(/outside the qualified 2\.x range/);
	});

	it('reports an absent executable without probing other commands', async () => {
		const calls: string[] = [];
		const input: AgentAdapterContext = {
			...context({}),
			commandRunner: {
				run: async (_executable, args) => {
					calls.push(args.join(' '));
					return { exitCode: 1, stdout: '', stderr: 'not found' };
				},
			},
		};
		const inspection = await createClaudeCodeAdapter().inspect(input);
		expect(inspection.detected).toBe(false);
		expect(calls).toEqual(['--version']);
		expect(inspection.capabilities.every(({ support }) => support === 'unsupported')).toBe(true);
	});
});
