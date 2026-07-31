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
): { value: T | undefined; loading: boolean; error: Error | undefined } {
	const [value, setValue] = useState<T | undefined>(undefined);
	const [error, setError] = useState<Error | undefined>(undefined);
	const [loading, setLoading] = useState(true);
	// Hold the latest fetcher in a ref so the effect only re-runs when
	// `depsKey` changes — callers control invalidation explicitly.
	const fetcherRef = useRef(fetcher);
	fetcherRef.current = fetcher;
	// Track the latest dep key so out-of-order fetch resolutions are dropped.
	const latestKey = useRef(depsKey);

	useEffect(() => {
		let cancelled = false;
		let running = false;
		let trailingRefresh = false;
		latestKey.current = depsKey;
		setLoading(true);

		async function run(): Promise<void> {
			// Live exporters can notify faster than IPC/storage can answer. Never
			// fan those hints out into concurrent copies of the same query: retain
			// one trailing refresh so the settled value still catches up.
			if (running) {
				trailingRefresh = true;
				return;
			}
			running = true;
			do {
				trailingRefresh = false;
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
				}
			} while (!cancelled && trailingRefresh);
			running = false;
			if (!cancelled && latestKey.current === depsKey) {
				setLoading(false);
			}
		}

		// Initial fetch on mount, on filter change, and once on resume (this
		// effect re-runs when `paused` flips, so a resume catches up).
		void run();

		const sub = dataSource.subscribe((event) => {
			// Frozen: ignore live notifications until the view is resumed. Signal
			// scoping also prevents log/metric traffic from re-running trace SQL.
			if (paused || (refreshKind !== undefined && event.kind !== refreshKind)) {
				return;
			}
			void run();
		});

		return () => {
			cancelled = true;
			sub.dispose();
		};
	}, [dataSource, depsKey, paused, refreshKind]);

	return { value, loading, error };
}
