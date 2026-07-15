import { type JSX, useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
	readonly open: boolean;
	readonly title: string;
	readonly message: string;
	/** Label for the confirm button. Defaults to "Confirm". */
	readonly confirmLabel?: string;
	/** Label for the cancel button. Defaults to "Cancel". */
	readonly cancelLabel?: string;
	/** Style the confirm button as a destructive action. */
	readonly destructive?: boolean;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

/**
 * Minimal modal confirmation for consequential (often destructive) actions.
 * Presentation-only — the host owns the effect that runs on confirm. Escape and
 * a backdrop click cancel; the confirm button is focused on open so keyboard
 * users can act (or Tab to Cancel) without reaching for the mouse.
 */
export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null {
	const {
		open,
		title,
		message,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		destructive = false,
		onConfirm,
		onCancel,
	} = props;
	const confirmRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (open) {
			confirmRef.current?.focus();
		}
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') {
				onCancel();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onCancel]);

	if (!open) {
		return null;
	}

	return (
		<div className="otelux-confirm-backdrop">
			<button
				type="button"
				className="otelux-confirm-backdrop__hit"
				aria-label="Cancel"
				tabIndex={-1}
				onClick={onCancel}
			/>
			<div
				className="otelux-confirm"
				role="dialog"
				aria-modal="true"
				aria-labelledby="otelux-confirm-title"
			>
				<h2 id="otelux-confirm-title" className="otelux-confirm__title">
					{title}
				</h2>
				<p className="otelux-confirm__message">{message}</p>
				<div className="otelux-confirm__actions">
					<button type="button" className="otelux-confirm__cancel" onClick={onCancel}>
						{cancelLabel}
					</button>
					<button
						ref={confirmRef}
						type="button"
						className={`otelux-confirm__confirm${
							destructive ? ' otelux-confirm__confirm--destructive' : ''
						}`}
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
