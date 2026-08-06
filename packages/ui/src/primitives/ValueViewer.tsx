/**
 * `ValueViewer` — modal overlay for inspecting a single value (string,
 * number, boolean, bigint, array, or object). Renders as plain text
 * for primitives and pretty-printed JSON for compound shapes. The
 * format selector lets the user override the auto-detected kind to
 * inspect a JSON-encoded string as text, or to render a string as
 * Markdown source.
 *
 * Layout (mockup parity, see redesign-mockup.html `.viewer`):
 *   ┌─────────────────────────────────────────┐
 *   │ title          format ▾           close │ 48px
 *   ├─────────────────────────────────────────┤
 *   │ 1 │ value rendered                      │
 *   │ 2 │ across multiple                     │ 1fr
 *   │ 3 │ lines with a gutter                 │
 *   ├─────────────────────────────────────────┤
 *   │                       Download    Copy  │ 44px
 *   └─────────────────────────────────────────┘
 *
 * Controlled like `Drawer` — the consumer owns `open` and reacts to
 * `onClose`. Esc, backdrop click, and the explicit close button each
 * raise the request.
 *
 * Layered import discipline: primitive — accepts `value: unknown` and
 * does no domain-specific decoding so it has no `@otelux/types`
 * dependency.
 */

import { type JSX, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dropdown } from './Dropdown.js';
import { IconButton } from './IconButton.js';
import { writeClipboardText } from './clipboard.js';
import { CheckIcon, CopyIcon, DownloadIcon, XIcon } from './icons.js';

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

type ViewKind = 'text' | 'json' | 'markdown';

const FORMAT_OPTIONS = [
	{ value: 'text', label: 'Text' },
	{ value: 'json', label: 'JSON' },
	{ value: 'markdown', label: 'Markdown' },
] as const;

export function ValueViewer(props: ValueViewerProps): JSX.Element | null {
	const { open, onClose, title, value, filename } = props;
	const closeBtnRef = useRef<HTMLButtonElement>(null);
	const previouslyFocused = useRef<HTMLElement | null>(null);
	const titleId = useId();

	const inferred = useMemo(() => renderValue(value), [value]);
	const [kind, setKind] = useState<ViewKind>(inferred.kind);
	const [copied, setCopied] = useState(false);
	// Hold the morph timer in a ref so rapid re-clicks and modal close
	// don't leak a stale setTimeout firing into a destroyed component.
	const copyTimerRef = useRef<number | null>(null);
	useEffect(() => {
		return () => {
			if (copyTimerRef.current !== null) {
				window.clearTimeout(copyTimerRef.current);
			}
		};
	}, []);

	// Re-sync to the auto-detected kind when the value changes (e.g. user
	// opens a different attribute). We deliberately don't reset on every
	// re-render so the user's manual format choice sticks while the viewer
	// is open for the same value.
	useEffect(() => {
		setKind(inferred.kind);
	}, [inferred.kind]);

	// Text shown in the body. JSON is always derived from the original value
	// so toggling Text → JSON re-pretty-prints; Markdown reuses the raw text.
	const text = useMemo(() => {
		if (kind === 'json') {
			return inferred.kind === 'json' ? inferred.text : tryStringify(value);
		}
		return inferred.text;
	}, [kind, inferred, value]);

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
		void writeClipboardText(text)
			.then(() => {
				setCopied(true);
				if (copyTimerRef.current !== null) {
					window.clearTimeout(copyTimerRef.current);
				}
				copyTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
			})
			.catch(() => {
				// Keep the idle state when every clipboard route is rejected.
			});
	};
	const onDownload = (): void => {
		const ext = kind === 'json' ? '.json' : kind === 'markdown' ? '.md' : '.txt';
		const name = filename ?? `${(title ?? 'value').replace(/[^a-zA-Z0-9._-]+/g, '_')}${ext}`;
		const mime =
			kind === 'json' ? 'application/json' : kind === 'markdown' ? 'text/markdown' : 'text/plain';
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

	const lineCount = text.length === 0 ? 1 : text.split('\n').length;

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
					<Dropdown
						aria-label="Format"
						className="otelux-value-viewer__format"
						value={kind}
						onChange={(v) => setKind(v as ViewKind)}
						options={FORMAT_OPTIONS}
					/>
					<IconButton ref={closeBtnRef} aria-label="Close" title="Close" onClick={onClose}>
						<XIcon />
					</IconButton>
				</header>
				<div className={`otelux-value-viewer__body otelux-value-viewer__body--${kind}`}>
					<div className="otelux-value-viewer__gutter" aria-hidden="true">
						{Array.from({ length: lineCount }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: line numbers are positional and stable.
							<span key={i}>{i + 1}</span>
						))}
					</div>
					<pre className="otelux-value-viewer__code">{text}</pre>
				</div>
				<footer className="otelux-value-viewer__footer">
					<button
						type="button"
						className="otelux-value-viewer__btn otelux-value-viewer__btn--secondary"
						onClick={onDownload}
					>
						<DownloadIcon />
						<span>Download</span>
					</button>
					<button
						type="button"
						className={`otelux-value-viewer__btn otelux-value-viewer__btn--primary${copied ? ' is-copied' : ''}`}
						onClick={onCopy}
						aria-live="polite"
					>
						{copied ? <CheckIcon /> : <CopyIcon />}
						<span>{copied ? 'Copied' : 'Copy'}</span>
					</button>
				</footer>
			</div>
		</div>
	);
}

function tryStringify(value: unknown): string {
	try {
		return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);
	} catch {
		return String(value);
	}
}

function renderValue(value: unknown): { text: string; kind: ViewKind } {
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
