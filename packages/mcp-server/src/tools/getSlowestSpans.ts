import type { ToolDefinition } from '../server.js';

interface Input {
	readonly service?: string;
	readonly limit?: number;
}

export const getSlowestSpansTool: ToolDefinition = {
	name: 'otel_get_slowest_spans',
	description:
		'Return the slowest traces by root duration, optionally scoped to a service. Answers "what is slow?".',
	inputSchema: {
		type: 'object',
		properties: {
			service: { type: 'string', description: 'Filter to traces involving this service.name.' },
			limit: { type: 'number', default: 10 },
		},
	},
	handler: async (raw, { engine }) => {
		const input = (raw ?? {}) as Input;
		const limit = input.limit ?? 10;

		const result = await engine.listTraces({
			limit,
			sortBy: 'duration',
			sortDirection: 'desc',
			...(input.service ? { services: [input.service] } : {}),
		});

		return {
			slowestTraces: result.rows.map((row) => ({
				traceId: row.traceId,
				rootName: row.rootName,
				services: row.services,
				durationMillis: Number(row.durationNanos / 1_000_000n),
				spanCount: row.spanCount,
				errorCount: row.errorCount,
				startTime: new Date(Number(row.startTimeUnixNano / 1_000_000n)).toISOString(),
			})),
		};
	},
};
