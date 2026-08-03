import { useCallback, useEffect, useState } from 'react';

interface CursorPage<T> {
	readonly rows: readonly T[];
	readonly nextCursor?: string;
}

export function useCursorPages<T>(
	initial: CursorPage<T> | undefined,
	load: (cursor: string) => Promise<CursorPage<T>>,
	key: string,
): {
	readonly rows: readonly T[];
	readonly nextCursor: string | undefined;
	readonly loadingMore: boolean;
	readonly loadMore: () => void;
} {
	const [rows, setRows] = useState<readonly T[]>([]);
	const [nextCursor, setNextCursor] = useState<string>();
	const [loadingMore, setLoadingMore] = useState(false);

	useEffect(() => {
		void key;
		setRows(initial?.rows ?? []);
		setNextCursor(initial?.nextCursor);
		setLoadingMore(false);
	}, [initial, key]);

	const loadMore = useCallback(() => {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		void load(nextCursor)
			.then((page) => {
				setRows((current) => [...current, ...page.rows]);
				setNextCursor(page.nextCursor);
			})
			.finally(() => setLoadingMore(false));
	}, [load, loadingMore, nextCursor]);

	return { rows, nextCursor, loadingMore, loadMore };
}
