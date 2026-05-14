import { type JSX, useEffect, useRef, useState } from 'react';
import { MAX_PORT, MIN_PORT, type Settings, type UpdateSettingsResult } from '../../shared/ipc.js';

interface SettingsModalProps {
	readonly settings: Settings;
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
	const { settings, onSave, onClose } = props;
	const [portInput, setPortInput] = useState(String(settings.otlp.port));
	const [error, setError] = useState<string | undefined>(undefined);
	const [saving, setSaving] = useState(false);
	const portInputRef = useRef<HTMLInputElement>(null);

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
			<dialog className="modal" aria-modal="true" aria-labelledby="settings-title" open>
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
