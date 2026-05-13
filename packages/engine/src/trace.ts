import type { Span, Trace, TraceId } from '@otelux/types';
import { SpanStatusCode } from '@otelux/types';

/**
 * Compose a {@link Trace} view from a set of spans sharing the same
 * `traceId`. Returns `undefined` for an empty set so callers can map a
 * missing trace cleanly. The root is the span whose `parentSpanId` is
 * absent from the set (handles cross-process roots correctly); if none
 * exists, the earliest-starting span is used.
 */
export function traceFromSpans(traceId: TraceId, spans: readonly Span[]): Trace | undefined {
	const first = spans[0];
	if (!first) {
		return undefined;
	}

	const idSet = new Set(spans.map((s) => s.spanId));
	const roots = spans.filter((s) => !s.parentSpanId || !idSet.has(s.parentSpanId));
	let rootSpan: Span = roots[0] ?? first;
	if (roots.length === 0) {
		// No clean root (broken parent chain). Pick earliest by start time.
		let earliest = first;
		for (let i = 1; i < spans.length; i++) {
			const s = spans[i];
			if (s && s.startTimeUnixNano < earliest.startTimeUnixNano) {
				earliest = s;
			}
		}
		rootSpan = earliest;
	}

	let startTimeUnixNano = first.startTimeUnixNano;
	let endTimeUnixNano = first.endTimeUnixNano;
	const services = new Set<string>();
	let errorCount = 0;

	for (const s of spans) {
		if (s.startTimeUnixNano < startTimeUnixNano) {
			startTimeUnixNano = s.startTimeUnixNano;
		}
		if (s.endTimeUnixNano > endTimeUnixNano) {
			endTimeUnixNano = s.endTimeUnixNano;
		}
		const svc = s.resource.attributes['service.name'];
		if (typeof svc === 'string') {
			services.add(svc);
		}
		if (s.status.code === SpanStatusCode.Error) {
			errorCount++;
		}
	}

	return {
		traceId,
		rootSpan,
		spans,
		startTimeUnixNano,
		endTimeUnixNano,
		durationNanos: endTimeUnixNano - startTimeUnixNano,
		services: [...services],
		spanCount: spans.length,
		errorCount,
	};
}
