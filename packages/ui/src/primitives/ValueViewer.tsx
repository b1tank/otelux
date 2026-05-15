/**
 * `ValueViewer` — modal overlay for inspecting a single value (string,
 * number, boolean, bigint, array, or object). Renders as plain text
 * for primitives and pretty-printed JSON for compound shapes. Provides
 * Copy and Download actions so a value can be lifted out of the
 * workbench without manual selection.
 *
 * Controlled like `Drawer` — the consumer owns `open` and reacts to
 * `onClose`. Esc, backdrop click, and the explicit close button each
 * raise the request.
 *
 * Layered import discipline: primitive — accepts `value: unknown` and
 * does no domain-specific decoding so it has no `@otelux/types`
 * dependency.
 */

import { type JSX, useEffect, useId, useMemo, useRef } from 'react';
import { IconButton } from './IconButton.js';
import { CopyIcon, DownloadIcon, XIcon } from './icons.js';

export interface ValueViewerProps {
	/** Controlled open flag. */
	open: boolean;
	/** Raised on Escape, backdrop click, and the close button. */
	onClose: () => void;
	/** Optional dialog title; typically the attribute key being inspected. */
	title?: string;
	/** Value to render. Strings/primitives display as text; everything else is JSON.stringify'd. */
	value: unknown;
	/** Download filename. Falls back to the title with an inferred extension. */
	filename?: string;
}

export function ValueViewer(props: ValueViewerProps): JSX.Element | null {
	const { open, onClose, title, value, filename } = props;
	const closeBtnRef = useRef<HTMLButtonElement>(null);
	const previouslyFocused = useRef<HTMLElement | null>(null);
	const titleId = useId();

	const { text, kind } = useMemo(() => renderValue(value), [value]);

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

	useEffect(() => {
		if (!open) {
			return;
		}
		previouslyFocused.current = document.activeElement as HTMLElement | null;
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

	const headerTitle = title ?? 'Value';
	const onCopy = (): void => {
		// navigator.clipboard is unavailable in some sandboxes; degrade silently.
		void navigator.clipboard?.writeText(text);
	};
	const onDownload = (): void => {
		const ext = kind === 'json' ? '.json' : '.txt';
		const name = filename ?? `${(title ?? 'value').replace(/[^a-zA-Z0-9._-]+/g, '_')}${ext}`;
		const mime = kind === 'json' ? 'application/json' : 'text/plain';
		const blob = new Blob([text], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		// Revoke on the next tick so the download has a chance to start in
		// Chromium-based environments. Releasing immediately can cancel the
		// download on some platforms.
		setTimeout(() => URL.revokeObjectURL(url), 0);
	};

	return (
		<div className="otelux-value-viewer" role="presentation">
			<button
				type="button"
				className="otelux-value-viewer__backdrop"
				aria-label="Close value viewer"
				onClick={onClose}
				tabIndex={-1}
			/>
			<div
				className="otelux-value-viewer__panel"
				// biome-ignore lint/a11y/useSemanticElements: HTML <dialog> is not used here because we manage open state and focus restore manually; role=dialog + aria-modal is the WAI-ARIA equivalent.
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<header className="otelux-value-viewer__header">
					<h2 className="otelux-value-viewer__title" id={titleId}>
						{headerTitle}
					</h2>
					<div className="otelux-value-viewer__actions">
						<IconButton aria-label="Copy" title="Copy" onClick={onCopy}>
							<CopyIcon />
						</IconButton>
						<IconButton aria-label="Download" title="Download" onClick={onDownload}>
							<DownloadIcon />
						</IconButton>
						<IconButton ref={closeBtnRef} aria-label="Close" title="Close" onClick={onClose}>
							<XIcon />
						</IconButton>
					</div>
				</header>
				<pre className={`otelux-value-viewer__body otelux-value-viewer__body--${kind}`}>{text}</pre>
			</div>
		</div>
	);
}

function renderValue(value: unknown): { text: string; kind: 'text' | 'json' } {
	if (typeof value === 'string') {
		return { text: value, kind: 'text' };
	}
	if (typeof value === 'bigint') {
		return { text: value.toString(), kind: 'text' };
	}
	if (value === null || value === undefined) {
		return { text: String(value), kind: 'text' };
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return { text: String(value), kind: 'text' };
	}
	// Arrays + objects render as JSON with bigint coerced to string so that
	// JSON.stringify does not throw on telemetry counters.
	try {
		const text = JSON.stringify(
			value,
			(_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
			2,
		);
		return { text, kind: 'json' };
	} catch {
		return { text: String(value), kind: 'text' };
	}
}
