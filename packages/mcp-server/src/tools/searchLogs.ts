import type { ToolDefinition } from '../server.js';

/**
 * Log search is part of the MCP surface from day 1 so clients can
 * integrate against the frozen tool list even before logs ingest lands
 * (Phase 2 in `docs/plan.md`). Until then this returns an empty result
 * plus a `supported: false` flag, which is the spec-recommended way to
 * tell an LLM "ask me again later".
 */
export const searchLogsTool: ToolDefinition = {
	name: 'otel_search_logs',
	description:
		'Free-text + severity search over structured logs. Answers "why did this log fire?". M1 returns an empty result (logs ingest lands in Phase 2).',
	inputSchema: {
		type: 'object',
		properties: {
			query: { type: 'string' },
			severity: {
				type: 'string',
				enum: ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'],
			},
			service: { type: 'string' },
			limit: { type: 'number', default: 50 },
		},
		required: ['query'],
	},
	handler: () => ({
		supported: false,
		reason: 'log ingest is not enabled in M1; see docs/plan.md Phase 2',
		logs: [] as readonly unknown[],
	}),
};
