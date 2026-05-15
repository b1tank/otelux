import { type JSX, type ReactNode, useEffect, useState } from 'react';
import { useResizable } from '../hooks/useResizable.js';
import { Splitter } from './Splitter.js';

/**
 * Two-pane horizontal split container used inside `AppShell`'s main
 * column. The left pane (typically TraceList) is resizable; the right
 * pane (typically Waterfall) takes the remaining space.
 *
 * Either pane may be collapsed via {@link leftCollapsed} /
 * {@link rightCollapsed}. When one pane is collapsed the other fills
 * the available space and the splitter is hidden — these flags are a
 * design invariant: they must never both be true (see
 * `usePaneCollapse` which enforces this on the consumer side).
 *
 * The Workbench owns the resizable state via `useResizable`. The
 * width is persisted under `widthStorageKey` so the layout survives
 * reloads. Min/max widths come from CSS tokens by default but can be
 * overridden for tests.
 */
export interface WorkbenchProps {
	left: ReactNode;
	right: ReactNode;
	leftCollapsed?: boolean;
	rightCollapsed?: boolean;
	/** Initial left-pane width in CSS px. Default: 360. */
	initialLeftWidth?: number;
	/** Min width of the left pane. Default: 240 (--otelux-list-min-w). */
	minLeftWidth?: number;
	/** Max width of the left pane, computed from container width by default. */
	maxLeftWidth?: number;
	/** Min width the right pane must keep after a resize. Default: 480. */
	minRightWidth?: number;
	/** localStorage key for the persisted width. */
	widthStorageKey?: string;
	/** Localized label for the splitter handle. */
	splitterLabel?: string;
}

const DEFAULT_INITIAL_LEFT = 360;
const DEFAULT_MIN_LEFT = 240;
const DEFAULT_MIN_RIGHT = 480;
const DEFAULT_MAX_LEFT = 1600;

export function Workbench(props: WorkbenchProps): JSX.Element {
	const {
		left,
		right,
		leftCollapsed = false,
		rightCollapsed = false,
		initialLeftWidth = DEFAULT_INITIAL_LEFT,
		minLeftWidth = DEFAULT_MIN_LEFT,
		maxLeftWidth,
		minRightWidth = DEFAULT_MIN_RIGHT,
		widthStorageKey,
		splitterLabel = 'Resize panes',
	} = props;

	// The effective max for the left pane depends on the container's
	// own width (we want minRightWidth left over for the right pane).
	// Until we measure, fall back to maxLeftWidth or a generous cap.
	const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);
	const computedMax =
		maxLeftWidth ??
		(containerWidth !== undefined
			? Math.max(minLeftWidth, containerWidth - minRightWidth)
			: DEFAULT_MAX_LEFT);

	const resizableOptions =
		widthStorageKey === undefined
			? { initial: initialLeftWidth, min: minLeftWidth, max: computedMax }
			: {
					initial: initialLeftWidth,
					min: minLeftWidth,
					max: computedMax,
					storageKey: widthStorageKey,
				};
	const { width, onPointerDown, onKeyDown } = useResizable(resizableOptions);

	// Measure the container so the left pane never grows large enough
	// to push the right pane below its own min width.
	const setContainerRef = (el: HTMLDivElement | null): void => {
		if (!el) {
			return;
		}
		setContainerWidth(el.clientWidth);
	};
	useEffect(() => {
		// We could subscribe to ResizeObserver here for window resizes; the
		// hook's clamp on next pointerdown handles that lazily for now.
	}, []);

	const showSplitter = !leftCollapsed && !rightCollapsed;
	const leftStyle = leftCollapsed
		? { display: 'none' as const }
		: rightCollapsed
			? { flex: '1 1 auto' as const, width: 'auto' as const }
			: { flex: `0 0 ${width}px` as const, width: `${width}px` as const };
	const rightStyle = rightCollapsed
		? { display: 'none' as const }
		: { flex: '1 1 auto' as const, minWidth: `${minRightWidth}px` as const };

	return (
		<div ref={setContainerRef} className="otelux-workbench">
			<div className="otelux-workbench__pane otelux-workbench__pane--left" style={leftStyle}>
				{left}
			</div>
			{showSplitter && (
				<Splitter
					value={width}
					min={minLeftWidth}
					max={computedMax}
					aria-label={splitterLabel}
					onPointerDown={onPointerDown}
					onKeyDown={onKeyDown}
				/>
			)}
			<div className="otelux-workbench__pane otelux-workbench__pane--right" style={rightStyle}>
				{right}
			</div>
		</div>
	);
}
