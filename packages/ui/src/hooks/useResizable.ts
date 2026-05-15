/**
 * `useResizable` — pointer/keyboard driven width state for a splitter.
 *
 * Owns the current width (in px) of one pane in a horizontal split.
 * Returns the value to apply (caller decides where: inline `style` on
 * the pane, or a CSS variable like `--otelux-list-w` on a parent) and
 * the handler props for the splitter handle.
 *
 * Persistence is opt-in via `storageKey`; pass it to remember the size
 * across reloads. The hook reads once on mount and writes on commit
 * (pointer-up / keyboard release), not on every move, to keep
 * `localStorage` quiet during drags.
 *
 * Min and max are evaluated on every drag step so the caller can
 * shrink the max when the container resizes — pass live numbers, not
 * stale ones.
 */

import {
	type KeyboardEvent,
	type PointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

export interface UseResizableOptions {
	/** Starting width if no persisted value exists. */
	initial: number;
	/** Minimum allowed width. */
	min: number;
	/** Maximum allowed width. */
	max: number;
	/** Keyboard nudge step. Defaults to 8 (matches the spacing grid). */
	step?: number;
	/** localStorage key. Omit to disable persistence. */
	storageKey?: string;
}

export interface UseResizableResult {
	width: number;
	setWidth: (next: number) => void;
	onPointerDown: (e: PointerEvent<HTMLElement>) => void;
	onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/** Pure clamp helper. Exported so tests can target the math directly. */
export function clampWidth(next: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, next));
}

function readPersisted(key: string | undefined): number | undefined {
	if (!key || typeof localStorage === 'undefined') {
		return undefined;
	}
	const raw = localStorage.getItem(key);
	if (!raw) {
		return undefined;
	}
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) ? n : undefined;
}

function writePersisted(key: string | undefined, value: number): void {
	if (!key || typeof localStorage === 'undefined') {
		return;
	}
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Quota / privacy mode: swallow. Persistence is best-effort.
	}
}

export function useResizable(options: UseResizableOptions): UseResizableResult {
	const { initial, min, max, step = 8, storageKey } = options;

	const [width, setWidthState] = useState<number>(() => {
		const persisted = readPersisted(storageKey);
		return clampWidth(persisted ?? initial, min, max);
	});

	// Live refs for min/max so handlers attached to window during a drag
	// see the latest constraints without needing to re-subscribe.
	const minRef = useRef(min);
	const maxRef = useRef(max);
	useEffect(() => {
		minRef.current = min;
		maxRef.current = max;
	}, [min, max]);

	const setWidth = useCallback((next: number): void => {
		const clamped = clampWidth(next, minRef.current, maxRef.current);
		setWidthState(clamped);
	}, []);

	// Commit (= persist) on pointer up / keyboard release; drag itself
	// just updates state so React renders smoothly.
	const commit = useCallback(
		(value: number): void => {
			writePersisted(storageKey, value);
		},
		[storageKey],
	);

	const onPointerDown = useCallback(
		(e: PointerEvent<HTMLElement>): void => {
			// Only the primary button (mouse left / first touch / stylus tip).
			if (e.button !== 0) {
				return;
			}
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = width;
			const handle = e.currentTarget;
			handle.setPointerCapture(e.pointerId);

			const onMove = (ev: globalThis.PointerEvent): void => {
				const next = clampWidth(startWidth + (ev.clientX - startX), minRef.current, maxRef.current);
				setWidthState(next);
			};

			const onUp = (ev: globalThis.PointerEvent): void => {
				handle.releasePointerCapture(ev.pointerId);
				handle.removeEventListener('pointermove', onMove);
				handle.removeEventListener('pointerup', onUp);
				handle.removeEventListener('pointercancel', onUp);
				// Use the freshest committed width by reading the closure
				// of the most recent move. setState may have batched; rely
				// on the next render to persist via effect would over-fire.
				// Instead, recompute the final clamped value from the
				// pointer-up coordinates so commit is exact.
				const finalNext = clampWidth(
					startWidth + (ev.clientX - startX),
					minRef.current,
					maxRef.current,
				);
				commit(finalNext);
			};

			handle.addEventListener('pointermove', onMove);
			handle.addEventListener('pointerup', onUp);
			handle.addEventListener('pointercancel', onUp);
		},
		[width, commit],
	);

	const onKeyDown = useCallback(
		(e: KeyboardEvent<HTMLElement>): void => {
			// Standard aria-separator keyboard interactions:
			//   Left/Right: nudge by step
			//   Shift+Left/Right: nudge by step*4 (faster)
			//   Home: jump to min
			//   End: jump to max
			const big = step * 4;
			let next: number | undefined;
			switch (e.key) {
				case 'ArrowLeft':
					next = width - (e.shiftKey ? big : step);
					break;
				case 'ArrowRight':
					next = width + (e.shiftKey ? big : step);
					break;
				case 'Home':
					next = minRef.current;
					break;
				case 'End':
					next = maxRef.current;
					break;
				default:
					return;
			}
			e.preventDefault();
			const clamped = clampWidth(next, minRef.current, maxRef.current);
			setWidthState(clamped);
			commit(clamped);
		},
		[width, step, commit],
	);

	return { width, setWidth, onPointerDown, onKeyDown };
}
