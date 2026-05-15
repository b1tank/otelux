import { type JSX, useEffect, useRef, useState } from 'react';
import { MAX_PORT, MIN_PORT, type Settings, type UpdateSettingsResult } from '../../shared/ipc.js';

interface SettingsModalProps {
	readonly settings: Settings;
	/**
	 * Port the receiver is actually bound to right now. When provided
	 * this is the value the field is prefilled with, so users see — and
	 * edit — what is actively in effect rather than the persisted
	 * setting (which can drift from the live port when an env override
	 * like `OTELUX_OTLP_PORT` is in play, or when a bind retry picked a
	 * different port). Falls back to `settings.otlp.port` when the
	 * receiver has not reported a port yet.
	 */
	readonly currentPort?: number;
	readonly onSave: (port: number) => Promise<UpdateSettingsResult>;
	readonly onClose: () => void;
}

/**
 * Edit user-controllable settings. Right now that's just the OTLP/HTTP
 * port; the component is structured so adding more fields is a matter
 * of more rows, not a redesign. Validation happens on submit and bind
 * errors from the main process surface inline rather than as toasts.
 */
export function SettingsModal(props: SettingsModalProps): JSX.Element {
	const { settings, currentPort, onSave, onClose } = props;
	const [portInput, setPortInput] = useState(String(currentPort ?? settings.otlp.port));
	const [error, setError] = useState<string | undefined>(undefined);
	const [saving, setSaving] = useState(false);
	const portInputRef = useRef<HTMLInputElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		// Focus the first field on mount. Doing this in an effect avoids
		// Biome's `noAutofocus` lint while still giving us a usable modal.
		portInputRef.current?.focus();
		portInputRef.current?.select();
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape' && !saving) {
				onClose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose, saving]);

	/**
	 * Trap Tab inside the dialog so focus cannot escape to the underlying
	 * page, where it would land on the backdrop hit-button or workbench
	 * controls. Native <dialog> does this automatically when shown with
	 * `.showModal()`, but we render with the `open` attribute (so React
	 * stays in control of mount/unmount) which leaves focus management
	 * to us.
	 */
	const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>): void => {
		if (e.key !== 'Tab') {
			return;
		}
		const root = dialogRef.current;
		if (!root) {
			return;
		}
		const focusables = Array.from(
			root.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		);
		if (focusables.length === 0) {
			return;
		}
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (!first || !last) {
			return;
		}
		const active = document.activeElement as HTMLElement | null;
		if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	};

	const onSubmit = async (e: React.FormEvent): Promise<void> => {
		e.preventDefault();
		const parsed = Number.parseInt(portInput, 10);
		if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
			setError(`Port must be an integer between ${MIN_PORT} and ${MAX_PORT}.`);
			return;
		}
		setError(undefined);
		setSaving(true);
		const result = await onSave(parsed);
		setSaving(false);
		if (result.ok) {
			onClose();
		} else {
			setError(result.error);
		}
	};

	const onBackdropClick = (): void => {
		if (!saving) {
			onClose();
		}
	};

	return (
		<div className="modal-backdrop">
			{/* Transparent button covering the backdrop. Using a real <button>
			    gives us keyboard-accessible "click outside to close" without
			    tripping Biome's a11y rules for clickable <div>s. */}
			<button
				type="button"
				className="modal-backdrop__hit"
				onClick={onBackdropClick}
				disabled={saving}
				aria-label="Close settings"
				tabIndex={-1}
			/>
			<dialog
				ref={dialogRef}
				className="modal"
				aria-modal="true"
				aria-labelledby="settings-title"
				open
				onKeyDown={onDialogKeyDown}
			>
				<header className="modal__header">
					<h2 id="settings-title">Settings</h2>
					<button
						type="button"
						className="modal__close"
						onClick={onClose}
						aria-label="Close"
						disabled={saving}
					>
						✕
					</button>
				</header>
				<form className="modal__body" onSubmit={onSubmit}>
					<label className="field">
						<span className="field__label">OTLP/HTTP port</span>
						<input
							ref={portInputRef}
							type="number"
							min={MIN_PORT}
							max={MAX_PORT}
							step={1}
							value={portInput}
							onChange={(e) => setPortInput(e.target.value)}
							disabled={saving}
						/>
						<span className="field__hint">
							The OTLP/HTTP receiver listens on <code>127.0.0.1:&lt;port&gt;/v1/traces</code>. Changing it
							restarts the receiver immediately.
						</span>
					</label>
					{error ? <p className="modal__error">{error}</p> : null}
					<div className="modal__actions">
						<button type="button" onClick={onClose} disabled={saving}>
							Cancel
						</button>
						<button type="submit" className="primary" disabled={saving}>
							{saving ? 'Saving…' : 'Save'}
						</button>
					</div>
				</form>
			</dialog>
		</div>
	);
}
