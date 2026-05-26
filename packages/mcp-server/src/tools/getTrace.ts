import type { TraceId, SpanId } from '@otelux/types';
import type { ToolDefinition } from '../server.js';

export const getTraceTool: ToolDefinition = {
	name: 'otel_get_trace',
	description:
		'Return the full span tree for a given traceId. Drill-down primitive used after find/list tools surface candidate traces.',
	inputSchema: {
		type: 'object',
		properties: {
			traceId: { type: 'string' },
		},
		required: ['traceId'],
	},
	handler: async (raw, { engine }) => {
		const input = (raw ?? {}) as { traceId?: string };
		if (!input.traceId) {
			throw new Error('otel_get_trace: missing traceId');
		}
		const trace = await engine.getTrace({ traceId: input.traceId as TraceId });
		return {
			traceId: trace.traceId,
			services: trace.services,
			spanCount: trace.spanCount,
			errorCount: trace.errorCount,
			durationMillis: Number(trace.durationNanos / 1_000_000n),
			startTime: new Date(Number(trace.startTimeUnixNano / 1_000_000n)).toISOString(),
			endTime: new Date(Number(trace.endTimeUnixNano / 1_000_000n)).toISOString(),
			spans: trace.spans.map((s) => ({
				spanId: s.spanId,
				parentSpanId: s.parentSpanId,
				name: s.name,
				kind: s.kind,
				// `service.name` lives on the resource attribute bag per OTel
				// resource conventions: https://opentelemetry.io/docs/specs/semconv/resource/.
				service:
					typeof s.resource.attributes['service.name'] === 'string'
						? s.resource.attributes['service.name']
						: undefined,
				durationMillis: Number((s.endTimeUnixNano - s.startTimeUnixNano) / 1_000_000n),
				status: s.status.code,
			})),
		};
	},
};

export const getSpanDetailsTool: ToolDefinition = {
	name: 'otel_get_span_details',
	description:
		'Return the full attributes, events, links, and resource for a single span. Drill-down primitive paired with otel_get_trace.',
	inputSchema: {
		type: 'object',
		properties: {
			spanId: { type: 'string' },
		},
		required: ['spanId'],
	},
	handler: async (raw, { engine }) => {
		const input = (raw ?? {}) as { spanId?: string };
		if (!input.spanId) {
			throw new Error('otel_get_span_details: missing spanId');
		}
		const span = await engine.getSpanDetails({ spanId: input.spanId as SpanId });
		// BigInt fields get downgraded to strings by the dispatcher's
		// JSON replacer, so we can pass the span through directly.
		return { span };
	},
};
