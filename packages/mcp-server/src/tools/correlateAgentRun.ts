import type { ToolDefinition } from '../server.js';

/**
 * Agent-run correlation waits on engine-side detection. Until then this tool
 * returns an empty result with `supported: false` so clients can integrate
 * against the frozen schema today.
 */
export const correlateAgentRunTool: ToolDefinition = {
	name: 'otel_correlate_agent_run',
	description:
		'Return user-app spans that occurred during a specific Copilot / Codex / Claude agent run. Joins by trace context propagation when available, falling back to time window + agent-host attributes. Schema-stable stub until engine detection lands.',
	inputSchema: {
		type: 'object',
		properties: {
			agentRunId: {
				type: 'string',
				description: 'The agent run identifier (genai.agent.run_id or vendor-specific).',
			},
			limit: { type: 'number', default: 100 },
		},
		required: ['agentRunId'],
	},
	handler: (raw) => {
		const input = (raw ?? {}) as { agentRunId?: string };
		return {
			supported: false,
			reason: 'agent-run detection is planned in @otelux/engine; see docs/plan.md',
			agentRunId: input.agentRunId,
			spans: [] as readonly unknown[],
		};
	},
};
