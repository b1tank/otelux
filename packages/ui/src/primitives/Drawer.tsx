/**
 * `Drawer` — controlled, right-side slide-in overlay used to host
 * detail surfaces (span details, value viewers, ad-hoc tools) without
 * permanently consuming horizontal space in the workbench.
 *
 * Controlled: the consumer owns `open`. The drawer raises `onClose`
 * on Escape and on the close button. There is no dim backdrop — the
 * design (see redesign-mockup.html `.drawer`) keeps the rest of the
 * workbench fully visible and clickable so users can drive the trace
 * list / waterfall without first dismissing the drawer.
 *
 * Layered import discipline: this file lives in `src/primitives/` and
 * MUST NOT import from `layout/` or `domain/`. Inputs are plain
 * `ReactNode`s.
 */

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { IconButton } from './IconButton.js';
import { XIcon } from './icons.js';

export interface DrawerProps {
	/** Controlled open state. */
	open: boolean;
	/** Raised on Escape and on the close button. */
	onClose: () => void;
	/** Optional header title. When omitted, `ariaLabel` should be provided. */
	title?: ReactNode;
	/**
	 * Optional CSS color (e.g. `var(--otelux-svc-3)`) for the small 8px
	 * status dot rendered before the title. Used by the span-detail drawer
	 * to surface the span's service color in the header.
	 */
	accentVar?: string;
	/**
	 * Optional uppercase pill rendered after the title (e.g. "Client",
	 * "Server"). Matches mockup `.drawer__tag`.
	 */
	kindLabel?: ReactNode;
	/** Accessible label for the dialog. Required when `title` is omitted. */
	ariaLabel?: string;
	/** Body content. */
	children: ReactNode;
}

export function Drawer(props: DrawerProps): JSX.Element | null {
	const { open, onClose, title, accentVar, kindLabel, ariaLabel, children } = props;
	const panelRef = useRef<HTMLDivElement>(null);
	const closeBtnRef = useRef<HTMLButtonElement>(null);
	const previouslyFocused = useRef<HTMLElement | null>(null);
	const titleId = useId();

	// Escape closes. Listener only while open to keep the count tight.
	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape') {
				return;
			}
			e.stopPropagation();
			onClose();
		};
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('keydown', onKey);
		};
	}, [open, onClose]);

	// Move focus into the panel on open, restore on close. We intentionally
	// keep this lightweight: no focus trap. Apps that need a full trap should
	// pin focus via their own logic. Without restoration, tab focus drifts
	// to the document body after Escape.
	useEffect(() => {
		if (!open) {
			return;
		}
		previouslyFocused.current = document.activeElement as HTMLElement | null;
		// Defer to next tick so the panel is mounted and visible.
		const t = window.setTimeout(() => {
			closeBtnRef.current?.focus();
		}, 0);
		return () => {
			window.clearTimeout(t);
			previouslyFocused.current?.focus?.();
		};
	}, [open]);

	if (!open) {
		return null;
	}

	const labelProps =
		title !== undefined ? { 'aria-labelledby': titleId } : { 'aria-label': ariaLabel ?? 'Drawer' };

	return (
		<div className="otelux-drawer" role="presentation">
			<div
				ref={panelRef}
				className="otelux-drawer__panel"
				// biome-ignore lint/a11y/useSemanticElements: HTML <dialog> is not used here because we render an always-mounted overlay manually; role=dialog + aria-modal is the documented WAI-ARIA escape.
				role="dialog"
				aria-modal="true"
				{...labelProps}
			>
				<header className="otelux-drawer__header">
					{accentVar !== undefined && (
						<span className="otelux-drawer__dot" style={{ background: accentVar }} aria-hidden="true" />
					)}
					{title !== undefined ? (
						<h2 className="otelux-drawer__title" id={titleId}>
							{title}
						</h2>
					) : (
						<span className="otelux-drawer__title" aria-hidden="true" />
					)}
					{kindLabel !== undefined && <span className="otelux-drawer__tag">{kindLabel}</span>}
					<IconButton
						ref={closeBtnRef}
						aria-label="Close"
						title="Close"
						onClick={onClose}
						className="otelux-drawer__close"
					>
						<XIcon />
					</IconButton>
				</header>
				<div className="otelux-drawer__body">{children}</div>
			</div>
		</div>
	);
}
