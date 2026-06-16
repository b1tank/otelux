import { SeverityNumber } from '@otelux/types';
import type { ToolDefinition } from '../server.js';

/**
 * Free-text + severity search over structured logs (Phase 2 in
 * `docs/plan.md`). The content that matters for agent workloads — user
 * prompts, tool I/O — rides the logs pipeline in record attributes, not
 * traces, so the engine matches against the body, event name, severity
 * text, and every attribute key/value.
 */
const SEVERITY_FLOOR: Record<string, number> = {
	TRACE: SeverityNumber.Trace,
	DEBUG: SeverityNumber.Debug,
	INFO: SeverityNumber.Info,
	WARN: SeverityNumber.Warn,
	ERROR: SeverityNumber.Error,
	FATAL: SeverityNumber.Fatal,
};

export const searchLogsTool: ToolDefinition = {
	name: 'otel_search_logs',
	description:
		'Free-text + severity search over structured logs. Answers "why did this log fire?" and surfaces agent content (prompts, tool output) carried in log attributes.',
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
	handler: async (raw, { engine }) => {
		const input = (raw ?? {}) as {
			query?: string;
			severity?: string;
			service?: string;
			limit?: number;
		};
		if (!input.query) {
			throw new Error('otel_search_logs: missing query');
		}

		// Build the query with conditional spreads: exactOptionalPropertyTypes
		// forbids passing an explicit `undefined` for optional fields.
		const minSeverity = input.severity ? SEVERITY_FLOOR[input.severity] : undefined;
		const result = await engine.listLogs({
			search: input.query,
			...(minSeverity !== undefined ? { minSeverity } : {}),
			...(input.service ? { services: [input.service] } : {}),
			limit: input.limit ?? 50,
			sortBy: 'time',
			sortDirection: 'desc',
		});

		return {
			supported: true,
			totalCount: result.totalCount,
			logs: result.rows.map((log) => ({
				time: new Date(Number(log.timeUnixNano / 1_000_000n)).toISOString(),
				severityNumber: log.severityNumber,
				severityText: log.severityText,
				eventName: log.eventName,
				body: log.body,
				// `service.name` lives on the resource attribute bag per OTel
				// resource conventions: https://opentelemetry.io/docs/specs/semconv/resource/.
				service:
					typeof log.resource.attributes['service.name'] === 'string'
						? log.resource.attributes['service.name']
						: undefined,
				traceId: log.traceId,
				spanId: log.spanId,
				attributes: log.attributes,
			})),
		};
	},
};
