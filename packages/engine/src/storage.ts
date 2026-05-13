import type {
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListTracesQuery,
	ListTracesResult,
} from '@otelux/protocol';
import type { Span, SpanId, TraceId } from '@otelux/types';

/**
 * Pluggable storage backend. The engine is the only consumer; engine
 * users compose `createEngine({ storage: ... })`.
 *
 * Methods may return either sync or async. The engine adapts both.
 *
 * SQLite-backed implementations push filtering and sorting down to SQL;
 * the in-memory implementation walks an array. Either way, the engine
 * itself only orchestrates and notifies subscribers.
 */
export interface Storage {
	readonly kind: 'otelux/storage';
	writeSpans(spans: readonly Span[]): Promise<void> | void;
	listTraces(query: ListTracesQuery): Promise<ListTracesResult> | ListTracesResult;
	getTraceSpans(traceId: TraceId): Promise<readonly Span[]> | readonly Span[];
	getSpan(spanId: SpanId): Promise<Span | undefined> | Span | undefined;
	close(): Promise<void> | void;
}

/**
 * In-memory storage. Used for tests and for the desktop app's transient
 * data before the persistent SQLite store lands. Sorting and filtering
 * are O(n) walks — acceptable for fixtures and small datasets; the
 * production backend is `@otelux/engine-node`.
 */
export function createMemoryStorage(): Storage {
	// Index by traceId for fast getTrace and fast list rollups.
	const byTrace = new Map<TraceId, Span[]>();
	// Index by spanId for direct span detail lookup.
	const bySpan = new Map<SpanId, Span>();

	function rowFromTrace(spans: readonly Span[]):
		| {
				traceId: TraceId;
				rootName: string;
				startTimeUnixNano: bigint;
				durationNanos: bigint;
				services: readonly string[];
				spanCount: number;
				errorCount: number;
		  }
		| undefined {
		if (spans.length === 0) {
			return undefined;
		}
		const first = spans[0];
		if (!first) {
			return undefined;
		}
		// Root span: parent missing from the trace span set. Fallback to
		// the earliest span if no clear root (broken parent chain).
		const idSet = new Set(spans.map((s) => s.spanId));
		const roots = spans.filter((s) => !s.parentSpanId || !idSet.has(s.parentSpanId));
		let root: Span = roots[0] ?? first;
		if (roots.length === 0) {
			let earliest = first;
			for (let i = 1; i < spans.length; i++) {
				const s = spans[i];
				if (s && s.startTimeUnixNano < earliest.startTimeUnixNano) {
					earliest = s;
				}
			}
			root = earliest;
		}
		let start = first.startTimeUnixNano;
		let end = first.endTimeUnixNano;
		const services = new Set<string>();
		let errorCount = 0;
		for (const s of spans) {
			if (s.startTimeUnixNano < start) {
				start = s.startTimeUnixNano;
			}
			if (s.endTimeUnixNano > end) {
				end = s.endTimeUnixNano;
			}
			const svc = s.resource.attributes['service.name'];
			if (typeof svc === 'string') {
				services.add(svc);
			}
			if (s.status.code === 2 /* Error */) {
				errorCount++;
			}
		}
		return {
			traceId: root.traceId,
			rootName: root.name,
			startTimeUnixNano: start,
			durationNanos: end - start,
			services: [...services],
			spanCount: spans.length,
			errorCount,
		};
	}

	return {
		kind: 'otelux/storage',

		writeSpans(spans: readonly Span[]): void {
			for (const span of spans) {
				const list = byTrace.get(span.traceId);
				if (list) {
					list.push(span);
				} else {
					byTrace.set(span.traceId, [span]);
				}
				bySpan.set(span.spanId, span);
			}
		},

		listTraces(query: ListTracesQuery): ListTracesResult {
			const rows: NonNullable<ReturnType<typeof rowFromTrace>>[] = [];
			for (const spans of byTrace.values()) {
				const row = rowFromTrace(spans);
				if (row) {
					rows.push(row);
				}
			}

			// Filters.
			const filtered = rows.filter((row) => {
				if (query.timeFromUnixNano !== undefined && row.startTimeUnixNano < query.timeFromUnixNano) {
					return false;
				}
				if (query.timeToUnixNano !== undefined && row.startTimeUnixNano >= query.timeToUnixNano) {
					return false;
				}
				if (query.hasError === true && row.errorCount === 0) {
					return false;
				}
				if (query.hasError === false && row.errorCount > 0) {
					return false;
				}
				if (query.services && query.services.length > 0) {
					const set = new Set(query.services);
					if (!row.services.some((s) => set.has(s))) {
						return false;
					}
				}
				if (query.search) {
					const needle = query.search.toLowerCase();
					const haystack = `${row.rootName} ${row.services.join(' ')}`.toLowerCase();
					if (!haystack.includes(needle)) {
						return false;
					}
				}
				return true;
			});

			// Sort. Default: startTime desc (most recent first).
			const sortBy = query.sortBy ?? 'startTime';
			const direction = query.sortDirection ?? (sortBy === 'startTime' ? 'desc' : 'asc');
			const cmpDir = direction === 'asc' ? 1 : -1;
			filtered.sort((a, b) => {
				let cmp = 0;
				switch (sortBy) {
					case 'startTime':
						cmp =
							a.startTimeUnixNano < b.startTimeUnixNano
								? -1
								: a.startTimeUnixNano > b.startTimeUnixNano
									? 1
									: 0;
						break;
					case 'duration':
						cmp = a.durationNanos < b.durationNanos ? -1 : a.durationNanos > b.durationNanos ? 1 : 0;
						break;
					case 'name':
						cmp = a.rootName.localeCompare(b.rootName);
						break;
					case 'spanCount':
						cmp = a.spanCount - b.spanCount;
						break;
					case 'errorCount':
						cmp = a.errorCount - b.errorCount;
						break;
				}
				return cmp * cmpDir;
			});

			const totalCount = filtered.length;
			const offset = query.offset ?? 0;
			const limit = query.limit ?? 100;
			const page = filtered.slice(offset, offset + limit);

			return { rows: page, totalCount };
		},

		getTraceSpans(traceId: TraceId): readonly Span[] {
			return byTrace.get(traceId) ?? [];
		},

		getSpan(spanId: SpanId): Span | undefined {
			return bySpan.get(spanId);
		},

		close(): void {
			byTrace.clear();
			bySpan.clear();
		},
	};
}

// Re-export for query helpers — not part of the public API.
export type { GetSpanDetailsQuery, GetTraceQuery };
