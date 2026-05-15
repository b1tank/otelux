import type { JSX, KeyboardEvent, PointerEvent } from 'react';

/**
 * Vertical drag handle (6px) used to resize the two workbench panes.
 *
 * Splitter is intentionally dumb: it does not own any width state.
 * The parent's `useResizable` hook owns the width, and the parent
 * threads the handler functions plus current value into this
 * component. That keeps the splitter trivially testable and lets the
 * same component drive horizontal panes elsewhere.
 *
 * ARIA: a `separator` with orientation="vertical" plus the standard
 * aria-valuenow/min/max so screen readers announce the current size.
 */
export interface SplitterProps {
	/** Current width of the left pane in CSS px (used for aria-valuenow). */
	value: number;
	min: number;
	max: number;
	/** Localized label, e.g. "Resize trace list". */
	'aria-label': string;
	onPointerDown(e: PointerEvent<HTMLDivElement>): void;
	onKeyDown(e: KeyboardEvent<HTMLDivElement>): void;
}

export function Splitter(props: SplitterProps): JSX.Element {
	return (
		<div
			className="otelux-splitter"
			// biome-ignore lint/a11y/useSemanticElements: WAI-ARIA window/pane separator pattern; there is no native HTML element for a draggable pane resizer.
			role="separator"
			aria-orientation="vertical"
			aria-valuenow={Math.round(props.value)}
			aria-valuemin={Math.round(props.min)}
			aria-valuemax={Math.round(props.max)}
			aria-label={props['aria-label']}
			tabIndex={0}
			onPointerDown={props.onPointerDown}
			onKeyDown={props.onKeyDown}
		>
			<div className="otelux-splitter__grip" aria-hidden />
		</div>
	);
}
