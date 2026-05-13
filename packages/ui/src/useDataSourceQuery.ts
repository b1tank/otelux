/**
 * Subscribe to a DataSource and keep a query result in sync.
 *
 * Refetches when the DataSource notifies (`subscribe`) and when the
 * query dependency string changes. Returns the latest result plus a
 * `loading` flag for first-fetch UI states.
 */

import type { DataSource } from '@otelux/protocol';
import { useEffect, useRef, useState } from 'react';

export function useDataSourceQuery<T>(
	dataSource: DataSource,
	fetcher: (ds: DataSource) => Promise<T>,
	depsKey: string,
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
		latestKey.current = depsKey;
		setLoading(true);

		async function run(): Promise<void> {
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
				if (!cancelled && latestKey.current === depsKey) {
					setLoading(false);
				}
			}
		}

		void run();

		const sub = dataSource.subscribe(() => {
			void run();
		});

		return () => {
			cancelled = true;
			sub.dispose();
		};
	}, [dataSource, depsKey]);

	return { value, loading, error };
}
