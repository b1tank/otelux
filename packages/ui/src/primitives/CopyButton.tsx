/**
 * CopyButton — icon-only / icon+label clipboard button.
 *
 * A single shared widget that copies `value` to the clipboard and morphs
 * its trailing icon from CopyIcon -> CheckIcon (green) for ~1.2s on
 * success. Both icons render at the same 14x14 size so the row width
 * is byte-identical across idle/copied/idle and never reflows.
 *
 * Used in two places today:
 *   • EndpointBar copies the OTLP URL (icon + URL label)
 *   • TraceList copies the full trace id (icon-only, sits next to the
 *     short id)
 *
 * The component intentionally accepts `children` as the visible label
 * so each call site controls its own text styling — the shared piece
 * is the click handler, the state machine, the timer cleanup, and the
 * morph itself.
 */

import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { writeClipboardText } from './clipboard.js';
import { CheckIcon, CopyIcon } from './icons.js';

export interface CopyButtonProps {
	/** Text written to `navigator.clipboard` on click. */
	readonly value: string;
	/** Optional visible label rendered before the icon slot. */
	readonly children?: ReactNode;
	/** Tooltip text in idle state. Defaults to "Click to copy". */
	readonly title?: string;
	/** Accessible label override (defaults to title). */
	readonly ariaLabel?: string;
	/** Extra class on the root <button>. */
	readonly className?: string;
	/** Icon pixel size. Defaults to 14. */
	readonly iconSize?: number;
}

export function CopyButton(props: CopyButtonProps): JSX.Element {
	const { value, children, title = 'Click to copy', ariaLabel, className, iconSize = 14 } = props;
	const [copied, setCopied] = useState(false);
	// Hold the timer in a ref so unmount + rapid re-clicks don't leak
	// a stale setTimeout firing into a destroyed component.
	const timerRef = useRef<number | null>(null);
	useEffect(() => {
		return () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
			}
		};
	}, []);
	const onClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
		// Stop bubbling: in nested contexts (e.g. the trace card body is
		// itself a role="button"), we don't want a copy click to also
		// trigger the surrounding row's select handler.
		e.stopPropagation();
		void writeClipboardText(value).then(() => {
			setCopied(true);
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
			}
			timerRef.current = window.setTimeout(() => setCopied(false), 1200);
		});
	};
	const liveTitle = copied ? 'Copied' : title;
	const liveAria = ariaLabel ?? liveTitle;
	return (
		<button
			type="button"
			className={`otelux-copy-button${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}
			onClick={onClick}
			// Prevent the outer card's mousedown-based selection logic
			// from firing when the user reaches for the copy affordance.
			onMouseDown={(e) => e.stopPropagation()}
			title={liveTitle}
			aria-label={liveAria}
			aria-live="polite"
		>
			{children}
			<span className="otelux-copy-button__icon" aria-hidden="true">
				{copied ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
			</span>
		</button>
	);
}
