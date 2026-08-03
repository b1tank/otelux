import {
	type RefObject,
	type UIEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

export interface FixedVirtualRow {
	readonly index: number;
	readonly start: number;
}

export interface FixedVirtualRows {
	readonly scrollRef: RefObject<HTMLDivElement>;
	readonly rows: readonly FixedVirtualRow[];
	readonly totalHeight: number;
	readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
	readonly scrollToIndex: (index: number) => void;
}

/**
 * Small fixed-height virtualizer for dense telemetry rows. The only effect
 * synchronizes a ResizeObserver; visible indices are derived during render.
 */
export function useFixedVirtualRows(
	count: number,
	rowHeight: number,
	enabled: boolean,
	overscan = 8,
): FixedVirtualRows {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const [viewportHeight, setViewportHeight] = useState(0);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const update = (): void => setViewportHeight(element.clientHeight);
		update();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const rows = useMemo(() => {
		if (!enabled) {
			return Array.from({ length: count }, (_, index) => ({ index, start: index * rowHeight }));
		}
		const visible = Math.max(1, Math.ceil(viewportHeight / rowHeight));
		const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
		const end = Math.min(count, first + visible + overscan * 2);
		return Array.from({ length: Math.max(0, end - first) }, (_, offset) => {
			const index = first + offset;
			return { index, start: index * rowHeight };
		});
	}, [count, enabled, overscan, rowHeight, scrollTop, viewportHeight]);

	const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
		setScrollTop(event.currentTarget.scrollTop);
	}, []);
	const scrollToIndex = useCallback(
		(index: number) => {
			const element = scrollRef.current;
			if (!element || index < 0 || index >= count) return;
			const start = index * rowHeight;
			const end = start + rowHeight;
			if (start < element.scrollTop) element.scrollTop = start;
			else if (end > element.scrollTop + element.clientHeight) {
				element.scrollTop = end - element.clientHeight;
			}
		},
		[count, rowHeight],
	);

	return { scrollRef, rows, totalHeight: count * rowHeight, onScroll, scrollToIndex };
}
