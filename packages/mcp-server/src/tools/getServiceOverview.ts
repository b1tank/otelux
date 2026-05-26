import type { ToolDefinition } from '../server.js';

/**
 * Service overview aggregates `listTraces` results from the engine. A
 * dedicated `Engine.listServices` query lands later — for M1 we
 * approximate by paging through recent traces, which gives correct
 * service identity but not per-service span counts.
 */
export const getServiceOverviewTool: ToolDefinition = {
	name: 'otel_get_service_overview',
	description:
		'List the services that have emitted telemetry recently, plus per-service trace and error counts.',
	inputSchema: {
		type: 'object',
		properties: {
			sinceMinutes: { type: 'number', default: 60 },
		},
	},
	handler: async (raw, { engine }) => {
		const input = (raw ?? {}) as { sinceMinutes?: number };
		const sinceMinutes = input.sinceMinutes ?? 60;
		const nowNs = BigInt(Date.now()) * 1_000_000n;
		const fromNs = nowNs - BigInt(sinceMinutes) * 60n * 1_000_000_000n;

		// Engine doesn't expose listServices in M1; we approximate by
		// scanning the most recent batch of traces. 200 is plenty for a
		// local desktop install.
		const result = await engine.listTraces({
			limit: 200,
			sortBy: 'startTime',
			sortDirection: 'desc',
			timeFromUnixNano: fromNs,
			timeToUnixNano: nowNs,
		});

		const services = new Map<string, { traces: number; errorTraces: number; spans: number }>();
		for (const row of result.rows) {
			for (const svc of row.services) {
				const entry = services.get(svc) ?? { traces: 0, errorTraces: 0, spans: 0 };
				entry.traces += 1;
				entry.spans += row.spanCount;
				if (row.errorCount > 0) {
					entry.errorTraces += 1;
				}
				services.set(svc, entry);
			}
		}

		return {
			windowMinutes: sinceMinutes,
			services: [...services.entries()]
				.map(([name, stats]) => ({ name, ...stats }))
				.sort((a, b) => b.traces - a.traces),
		};
	},
};
