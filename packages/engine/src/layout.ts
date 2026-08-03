import type { Span, Trace } from '@otelux/types';

/**
 * One row in the rendered waterfall. The trace span tree is flattened to
 * a deterministic row order (DFS by start-time) so virtualization works
 * directly on row indices.
 *
 * Times are normalized to nanoseconds relative to the trace start, which
 * keeps downstream pixel math in plain numbers (the trace duration
 * comfortably fits in a JS number; per-span offsets do too).
 */
export interface WaterfallRow {
	span: Span;
	/** 0-based depth from the trace root. */
	depth: number;
	/** Nanoseconds from the trace start. */
	startOffsetNanos: bigint;
	/** Nanoseconds (always >= 0). */
	durationNanos: bigint;
	/** Index within the rows array. Stable across renders. */
	index: number;
	/** Whether this span has at least one descendant in the trace. */
	hasChildren: boolean;
}

export interface WaterfallLayout {
	rows: readonly WaterfallRow[];
	traceStartUnixNano: bigint;
	traceEndUnixNano: bigint;
	totalDurationNanos: bigint;
}

/**
 * Port of the depth-first waterfall layout used by the retired C++ core
 * (see archived `src/core/engine.cpp::append_layout_rows`). Builds an
 * adjacency map, picks the root span, and walks children sorted by start
 * time so siblings appear in chronological order — same behavior as
 * Jaeger and the Aspire dashboard for parity with what users expect.
 */
export function computeWaterfallLayout(trace: Trace): WaterfallLayout {
	const { spans, traceId } = trace;

	// Build parent → children adjacency. A span whose parent is not in the
	// span set is treated as a synthetic root.
	const idSet = new Set(spans.map((s) => s.spanId));
	const childrenByParent = new Map<string, Span[]>();
	const roots: Span[] = [];
	for (const span of spans) {
		const parent = span.parentSpanId && idSet.has(span.parentSpanId) ? span.parentSpanId : undefined;
		if (parent === undefined) {
			roots.push(span);
		} else {
			const list = childrenByParent.get(parent);
			if (list) {
				list.push(span);
			} else {
				childrenByParent.set(parent, [span]);
			}
		}
	}

	// If somehow zero roots and we have spans, treat the earliest-starting
	// span as the synthetic root. This matches `traceFromSpans` fallback.
	if (roots.length === 0 && spans.length > 0) {
		const first = spans[0];
		if (first) {
			let earliest = first;
			for (let i = 1; i < spans.length; i++) {
				const s = spans[i];
				if (s && s.startTimeUnixNano < earliest.startTimeUnixNano) {
					earliest = s;
				}
			}
			roots.push(earliest);
		}
	}

	// Sort roots and children by start time so the layout is deterministic
	// and visually chronological.
	const byStart = (a: Span, b: Span): number =>
		a.startTimeUnixNano < b.startTimeUnixNano
			? -1
			: a.startTimeUnixNano > b.startTimeUnixNano
				? 1
				: 0;
	roots.sort(byStart);
	for (const list of childrenByParent.values()) {
		list.sort(byStart);
	}

	const traceStart = trace.startTimeUnixNano;
	const rows: WaterfallRow[] = [];

	// Iterative DFS keeps layout O(n) without consuming one JavaScript stack
	// frame per ancestor. Agent traces can be thousands of spans deep; the
	// former recursive walk overflowed around depth 5,000.
	const stack: Array<{ span: Span; depth: number }> = [];
	for (let i = roots.length - 1; i >= 0; i--) {
		const root = roots[i];
		if (root) stack.push({ span: root, depth: 0 });
	}
	const visited = new Set<string>();
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || visited.has(current.span.spanId)) {
			continue;
		}
		visited.add(current.span.spanId);
		const children = childrenByParent.get(current.span.spanId) ?? [];
		const duration = current.span.endTimeUnixNano - current.span.startTimeUnixNano;
		rows.push({
			span: current.span,
			depth: current.depth,
			startOffsetNanos: current.span.startTimeUnixNano - traceStart,
			durationNanos: duration < 0n ? 0n : duration,
			index: rows.length,
			hasChildren: children.length > 0,
		});
		for (let i = children.length - 1; i >= 0; i--) {
			const child = children[i];
			if (child) stack.push({ span: child, depth: current.depth + 1 });
		}
	}

	// Defensive: any spans not reached by the walk (cycle? orphan?) are
	// appended at depth 0 so the layout never silently drops data.
	if (rows.length < spans.length) {
		const seen = new Set(rows.map((r) => r.span.spanId));
		for (const span of spans) {
			if (!seen.has(span.spanId)) {
				const duration = span.endTimeUnixNano - span.startTimeUnixNano;
				rows.push({
					span,
					depth: 0,
					startOffsetNanos: span.startTimeUnixNano - traceStart,
					durationNanos: duration < 0n ? 0n : duration,
					index: rows.length,
					hasChildren: false,
				});
			}
		}
	}

	// Trace.traceId is the canonical identifier; ensure the layout is
	// consistent with it so downstream consumers can sanity-check.
	void traceId;

	return {
		rows,
		traceStartUnixNano: trace.startTimeUnixNano,
		traceEndUnixNano: trace.endTimeUnixNano,
		totalDurationNanos: trace.durationNanos,
	};
}
