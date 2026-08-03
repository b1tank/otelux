import type { ToolDefinition } from '../server.js';

/** Cross-signal service health rollups from the engine's bounded query path. */
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
		const services = await engine.getServiceOverview(sinceMinutes);
		return {
			windowMinutes: sinceMinutes,
			services: services.map((service) => ({
				...service,
				p50DurationNanos: service.p50DurationNanos.toString(),
				p95DurationNanos: service.p95DurationNanos.toString(),
			})),
		};
	},
};
