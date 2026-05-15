/**
 * `Drawer` — controlled, right-side slide-in overlay used to host
 * detail surfaces (span details, value viewers, ad-hoc tools) without
 * permanently consuming horizontal space in the workbench.
 *
 * Controlled: the consumer owns `open`. The drawer raises `onClose`
 * on Escape, on backdrop click, and on the close button. The consumer
 * is free to ignore the request.
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
	/** Raised on Escape, backdrop click, and close button. */
	onClose: () => void;
	/** Optional header title. When omitted, `ariaLabel` should be provided. */
	title?: ReactNode;
	/** Accessible label for the dialog. Required when `title` is omitted. */
	ariaLabel?: string;
	/** Body content. */
	children: ReactNode;
}

export function Drawer(props: DrawerProps): JSX.Element | null {
	const { open, onClose, title, ariaLabel, children } = props;
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
			<button
				type="button"
				className="otelux-drawer__backdrop"
				aria-label="Close drawer"
				onClick={onClose}
				tabIndex={-1}
			/>
			<div
				ref={panelRef}
				className="otelux-drawer__panel"
				// biome-ignore lint/a11y/useSemanticElements: HTML <dialog> is not used here because we render an always-mounted overlay manually with backdrop semantics; role=dialog + aria-modal is the documented WAI-ARIA escape.
				role="dialog"
				aria-modal="true"
				{...labelProps}
			>
				<header className="otelux-drawer__header">
					{title !== undefined ? (
						<h2 className="otelux-drawer__title" id={titleId}>
							{title}
						</h2>
					) : (
						<span className="otelux-drawer__title" aria-hidden="true" />
					)}
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
