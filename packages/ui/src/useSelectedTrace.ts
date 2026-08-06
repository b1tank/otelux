import type { DataSource } from '@otelux/protocol';
import type { Trace, TraceId } from '@otelux/types';
import { useEffect, useRef, useState } from 'react';

const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_SPANS = 20_000;

interface CacheEntry {
	readonly trace: Trace;
	readonly spans: number;
}

export interface SelectedTraceState {
	readonly trace: Trace | undefined;
	readonly loading: boolean;
	readonly error: Error | undefined;
}

/** Latest-only selected trace loader with a bounded LRU cache. */
export function useSelectedTrace(
	dataSource: DataSource,
	traceId: TraceId | undefined,
	enabled: boolean,
): SelectedTraceState {
	const [trace, setTrace] = useState<Trace>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<Error>();
	const [revision, setRevision] = useState(0);
	const generation = useRef(0);
	const displayedTraceId = useRef<TraceId>();
	const cache = useRef(new Map<TraceId, CacheEntry>());
	const cacheSource = useRef(dataSource);
	if (cacheSource.current !== dataSource) {
		cacheSource.current = dataSource;
		cache.current.clear();
	}

	useEffect(() => {
		if (!enabled || traceId === undefined) return;
		return dataSource.subscribe((event) => {
			if (
				event.kind === 'tracesChanged' &&
				(event.traceIds.length === 0 || event.traceIds.includes(traceId))
			) {
				cache.current.delete(traceId);
				setRevision((value) => value + 1);
			}
		}).dispose;
	}, [dataSource, enabled, traceId]);

	useEffect(() => {
		void revision;
		const currentGeneration = ++generation.current;
		if (!enabled || traceId === undefined) {
			displayedTraceId.current = undefined;
			setTrace(undefined);
			setLoading(false);
			setError(undefined);
			return;
		}

		const hit = cache.current.get(traceId);
		if (hit) {
			cache.current.delete(traceId);
			cache.current.set(traceId, hit);
			displayedTraceId.current = traceId;
			setTrace(hit.trace);
			setLoading(false);
			setError(undefined);
			return;
		}

		// Keep the selected trace mounted while a live invalidation refreshes
		// that same identity. Clearing it here made the waterfall and drawer
		// flash on every ingest batch. A real trace switch still clears first.
		const refreshingDisplayedTrace = displayedTraceId.current === traceId;
		if (!refreshingDisplayedTrace) setTrace(undefined);
		setLoading(!refreshingDisplayedTrace);
		setError(undefined);
		// Same-turn selections coalesce because cleanup cancels this timer before
		// any IPC starts. Once started, generation prevents stale commits.
		const timer = setTimeout(() => {
			const load = dataSource.getTraceWaterfall ?? dataSource.getTrace;
			void load
				.call(dataSource, { traceId })
				.then((result) => {
					if (generation.current !== currentGeneration) return;
					insertCache(cache.current, traceId, result);
					displayedTraceId.current = traceId;
					setTrace(result);
					setLoading(false);
				})
				.catch((cause) => {
					if (generation.current !== currentGeneration) return;
					setError(cause instanceof Error ? cause : new Error(String(cause)));
					setLoading(false);
				});
		}, 0);
		return () => clearTimeout(timer);
	}, [dataSource, enabled, traceId, revision]);

	return { trace, loading, error };
}

function insertCache(cache: Map<TraceId, CacheEntry>, traceId: TraceId, trace: Trace): void {
	cache.set(traceId, { trace, spans: trace.spans.length });
	let totalSpans = 0;
	for (const entry of cache.values()) totalSpans += entry.spans;
	while (cache.size > MAX_CACHE_ENTRIES || totalSpans > MAX_CACHE_SPANS) {
		const oldest = cache.entries().next().value as [TraceId, CacheEntry] | undefined;
		if (!oldest) break;
		cache.delete(oldest[0]);
		totalSpans -= oldest[1].spans;
	}
}
