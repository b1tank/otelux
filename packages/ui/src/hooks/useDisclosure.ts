/**
 * `useDisclosure` — minimal open/close state for menus, drawers, modals.
 *
 * Encapsulates the boring stuff every dropdown / dialog / drawer
 * repeats: an open flag, toggle/open/close handlers, Escape to close,
 * click-outside to close, and ARIA props for the trigger.
 *
 * The hook does **not** own the trigger or content elements — callers
 * spread the returned props onto their own DOM. This keeps the hook
 * usable with arbitrary markup (a button + a popover, a chip + a menu,
 * an icon + a dialog) without a forced shape.
 *
 * `onCloseRequest` (Escape, outside click) is suppressed when the focus
 * is inside the content. Callers using portals should pass
 * `contentRef` for the click-outside detection to work.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface UseDisclosureOptions {
	/** Initial open state. Defaults to closed. */
	initialOpen?: boolean;
	/** Disable Escape-to-close. Use when the consumer handles Escape itself. */
	disableEscape?: boolean;
	/** Disable outside-click-to-close. */
	disableOutsideClick?: boolean;
	/** Called whenever the disclosure transitions to closed. */
	onClose?: () => void;
}

export interface UseDisclosureResult<TTrigger extends HTMLElement, TContent extends HTMLElement> {
	open: boolean;
	onOpen: () => void;
	onClose: () => void;
	onToggle: () => void;
	/** Element id of the content, for `aria-controls`. */
	contentId: string;
	/** Spread on the trigger element. */
	triggerProps: {
		'aria-expanded': boolean;
		'aria-controls': string;
		ref: React.RefObject<TTrigger>;
	};
	/** Spread on the content root. */
	contentProps: {
		id: string;
		ref: React.RefObject<TContent>;
	};
}

export function useDisclosure<
	TTrigger extends HTMLElement = HTMLElement,
	TContent extends HTMLElement = HTMLElement,
>(options: UseDisclosureOptions = {}): UseDisclosureResult<TTrigger, TContent> {
	const {
		initialOpen = false,
		disableEscape = false,
		disableOutsideClick = false,
		onClose,
	} = options;
	const [open, setOpen] = useState(initialOpen);
	const triggerRef = useRef<TTrigger>(null);
	const contentRef = useRef<TContent>(null);
	const contentId = useId();

	const close = useCallback(() => {
		setOpen((prev) => {
			if (prev) {
				onClose?.();
			}
			return false;
		});
	}, [onClose]);

	const openFn = useCallback(() => {
		setOpen(true);
	}, []);

	const toggle = useCallback(() => {
		setOpen((prev) => {
			if (prev) {
				onClose?.();
			}
			return !prev;
		});
	}, [onClose]);

	// Escape and outside-click are global listeners, so only attach
	// while open to keep the listener count tight.
	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (e: KeyboardEvent): void => {
			if (disableEscape || e.key !== 'Escape') {
				return;
			}
			e.stopPropagation();
			close();
		};
		const onClick = (e: MouseEvent): void => {
			if (disableOutsideClick) {
				return;
			}
			const target = e.target as Node | null;
			if (!target) {
				return;
			}
			// Click inside trigger or content does not close. Anywhere else
			// does. This is the common dropdown-with-toggle behavior:
			// clicking the trigger again routes to `toggle`, not close.
			if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) {
				return;
			}
			close();
		};
		document.addEventListener('keydown', onKey);
		// `mousedown` fires before focus changes, which lets us close
		// before any other handler runs (e.g. a select on the new target).
		document.addEventListener('mousedown', onClick);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('mousedown', onClick);
		};
	}, [open, disableEscape, disableOutsideClick, close]);

	return {
		open,
		onOpen: openFn,
		onClose: close,
		onToggle: toggle,
		contentId,
		triggerProps: {
			'aria-expanded': open,
			'aria-controls': contentId,
			ref: triggerRef,
		},
		contentProps: {
			id: contentId,
			ref: contentRef,
		},
	};
}
