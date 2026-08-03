import type { ToolDefinition } from '../server.js';

/** Correlate standard conversation/session IDs through searchable logs and trace context. */
export const correlateAgentRunTool: ToolDefinition = {
	name: 'otel_correlate_agent_run',
	description:
		'Return traces and matching logs correlated to an agent run or conversation identifier. Uses exact searchable telemetry attributes and propagated trace context without service-name inference.',
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
	handler: async (raw, { engine }) => {
		const input = (raw ?? {}) as { agentRunId?: string; limit?: number };
		const agentRunId = input.agentRunId?.trim();
		if (!agentRunId) throw new Error('agentRunId is required');
		const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
		const logs = await engine.listLogs({ search: agentRunId, limit });
		const traceIds = [
			...new Set(logs.rows.flatMap((log) => (log.traceId ? [log.traceId] : []))),
		].slice(0, limit);
		const traces = await Promise.all(traceIds.map((traceId) => engine.getTrace({ traceId })));
		return {
			supported: true,
			agentRunId,
			matchStrategy: traceIds.length > 0 ? 'log-attribute+trace-context' : 'log-attribute',
			matchedLogs: logs.rows.length,
			traceCount: traces.length,
			traces: traces.map((trace) => ({
				traceId: trace.traceId,
				startTimeUnixNano: trace.startTimeUnixNano.toString(),
				durationNanos: trace.durationNanos.toString(),
				services: trace.services,
				spanCount: trace.spanCount,
				errorCount: trace.errorCount,
			})),
			logs: logs.rows.slice(0, limit).map((log) => ({
				timeUnixNano: log.timeUnixNano.toString(),
				severityNumber: log.severityNumber,
				severityText: log.severityText,
				eventName: log.eventName,
				body: log.body,
				traceId: log.traceId,
				spanId: log.spanId,
				serviceName: log.resource.attributes['service.name'],
			})),
		};
	},
};
