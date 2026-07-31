/**
 * Subscribe to a DataSource and keep a query result in sync.
 *
 * Refetches when the DataSource notifies (`subscribe`) and when the
 * query dependency string changes. Callers scope notifications with
 * `refreshKind`; bursts are coalesced to one active plus one trailing fetch.
 * Returns the latest result plus a `loading` flag for first-fetch UI states.
 *
 * When `paused` is true the live subscription no longer triggers refetches,
 * so the view freezes on its current result set (a "pause live tail"). An
 * explicit dependency change (`depsKey`, e.g. the user editing a filter) still
 * refetches — pausing suppresses only the streaming updates, not deliberate
 * requeries — and resuming refetches once to catch up on what arrived while
 * frozen. Ingest is unaffected; only the view stops following it.
 */

import type { ChangeEvent, DataSource } from '@otelux/protocol';
import { useEffect, useRef, useState } from 'react';

export function useDataSourceQuery<T>(
	dataSource: DataSource,
	fetcher: (ds: DataSource) => Promise<T>,
	depsKey: string,
	paused = false,
	refreshKind?: ChangeEvent['kind'],
	enabled = true,
	refreshWhen?: (event: ChangeEvent) => boolean,
	minRefreshIntervalMs = 0,
): { value: T | undefined; loading: boolean; error: Error | undefined } {
	const [value, setValue] = useState<T | undefined>(undefined);
	const [error, setError] = useState<Error | undefined>(undefined);
	const [loading, setLoading] = useState(true);
	// Hold the latest fetcher in a ref so the effect only re-runs when
	// `depsKey` changes — callers control invalidation explicitly.
	const fetcherRef = useRef(fetcher);
	fetcherRef.current = fetcher;
	const refreshWhenRef = useRef(refreshWhen);
	refreshWhenRef.current = refreshWhen;
	// Track the latest dep key so out-of-order fetch resolutions are dropped.
	const latestKey = useRef(depsKey);

	useEffect(() => {
		let cancelled = false;
		let running = false;
		let trailingRefresh = false;
		let refreshTimer: ReturnType<typeof setTimeout> | undefined;
		let lastStartedAt = Number.NEGATIVE_INFINITY;
		latestKey.current = depsKey;
		if (!enabled) {
			setLoading(false);
			return;
		}
		setLoading(true);

		function schedule(): void {
			if (running) {
				trailingRefresh = true;
				return;
			}
			if (refreshTimer !== undefined) return;
			const elapsed = performance.now() - lastStartedAt;
			const delay = Math.max(0, minRefreshIntervalMs - elapsed);
			if (delay === 0) {
				void run();
				return;
			}
			refreshTimer = setTimeout(() => {
				refreshTimer = undefined;
				void run();
			}, delay);
		}

		async function run(): Promise<void> {
			// Live exporters can notify faster than IPC/storage can answer. Never
			// fan those hints out into concurrent copies of the same query.
			if (running) {
				trailingRefresh = true;
				return;
			}
			running = true;
			trailingRefresh = false;
			lastStartedAt = performance.now();
			try {
				const result = await fetcherRef.current(dataSource);
				if (!cancelled && latestKey.current === depsKey) {
					setValue(result);
					setError(undefined);
				}
			} catch (err) {
				if (!cancelled && latestKey.current === depsKey) {
					setError(err instanceof Error ? err : new Error(String(err)));
				}
			} finally {
				running = false;
				if (!cancelled && trailingRefresh) schedule();
				else if (!cancelled && latestKey.current === depsKey) setLoading(false);
			}
		}

		// Initial fetch on mount, on filter change, and once on resume (this
		// effect re-runs when `paused` flips, so a resume catches up).
		void run();

		const sub = dataSource.subscribe((event) => {
			// Frozen: ignore live notifications until the view is resumed. Signal
			// scoping also prevents log/metric traffic from re-running trace SQL.
			if (
				paused ||
				(refreshKind !== undefined && event.kind !== refreshKind) ||
				(refreshWhenRef.current !== undefined && !refreshWhenRef.current(event))
			) {
				return;
			}
			schedule();
		});

		return () => {
			cancelled = true;
			if (refreshTimer !== undefined) clearTimeout(refreshTimer);
			sub.dispose();
		};
	}, [dataSource, depsKey, paused, refreshKind, enabled, minRefreshIntervalMs]);

	return { value, loading, error };
}
