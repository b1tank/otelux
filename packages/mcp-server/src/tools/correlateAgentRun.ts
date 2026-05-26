import type { ToolDefinition } from '../server.js';

/**
 * Agent-run correlation is the headline integration (`docs/proposal.md`
 * Surface C). The engine-side detection lands in Phase 1 Track B; until
 * then this tool returns an empty result with `supported: false` so
 * clients can integrate against the frozen schema today.
 */
export const correlateAgentRunTool: ToolDefinition = {
	name: 'otel_correlate_agent_run',
	description:
		'Return user-app spans that occurred during a specific Copilot / Codex / Claude agent run. Joins by trace context propagation when available, falling back to time window + agent-host attributes. Stub in M1; engine detection lands in Phase 1 Track B.',
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
			reason:
				'agent-run detection lands in @otelux/engine in Phase 1 Track B; see docs/plan.md',
			agentRunId: input.agentRunId,
			spans: [] as readonly unknown[],
		};
	},
};
