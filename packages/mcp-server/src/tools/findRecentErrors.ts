import type { ToolDefinition } from '../server.js';

interface Input {
	readonly service?: string;
	readonly sinceMinutes?: number;
	readonly limit?: number;
}

export const findRecentErrorsTool: ToolDefinition = {
	name: 'otel_find_recent_errors',
	description:
		'Return recent spans with status=ERROR, optionally scoped to a service. Answers "what just broke?".',
	inputSchema: {
		type: 'object',
		properties: {
			service: { type: 'string', description: 'Filter to spans from this service.name.' },
			sinceMinutes: {
				type: 'number',
				default: 15,
				description: 'Look back this many minutes.',
			},
			limit: { type: 'number', default: 25 },
		},
	},
	handler: async (raw, { engine }) => {
		const input = (raw ?? {}) as Input;
		const sinceMinutes = input.sinceMinutes ?? 15;
		const limit = input.limit ?? 25;
		const nowNs = BigInt(Date.now()) * 1_000_000n;
		const fromNs = nowNs - BigInt(sinceMinutes) * 60n * 1_000_000_000n;

		const result = await engine.listTraces({
			limit,
			sortBy: 'startTime',
			sortDirection: 'desc',
			hasError: true,
			timeFromUnixNano: fromNs,
			timeToUnixNano: nowNs,
			...(input.service ? { services: [input.service] } : {}),
		});

		return {
			tracesWithErrors: result.rows.map((row) => ({
				traceId: row.traceId,
				rootName: row.rootName,
				services: row.services,
				errorCount: row.errorCount,
				spanCount: row.spanCount,
				durationMillis: Number(row.durationNanos / 1_000_000n),
				startTime: new Date(Number(row.startTimeUnixNano / 1_000_000n)).toISOString(),
			})),
			totalMatching: result.totalCount,
			windowMinutes: sinceMinutes,
		};
	},
};
