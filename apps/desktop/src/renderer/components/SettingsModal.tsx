import { type JSX, useEffect, useRef, useState } from 'react';
import {
	MAX_PORT,
	MIN_PORT,
	type McpStatus,
	type PartialSettings,
	type Settings,
	type UpdateSettingsResult,
} from '../../shared/ipc.js';

interface SettingsModalProps {
	readonly settings: Settings;
	/**
	 * Port the OTLP receiver is actually bound to right now. See the
	 * Phase 0 note on env overrides — same reasoning applies here.
	 */
	readonly currentPort?: number;
	/**
	 * Live MCP status so the modal can show the actual bound endpoint
	 * inline below the toggle (no need to leave Settings to copy the
	 * MCP URL into an external agent config).
	 */
	readonly mcpStatus?: McpStatus;
	readonly onSave: (patch: PartialSettings) => Promise<UpdateSettingsResult>;
	readonly onClose: () => void;
}

/**
 * Edit user-controllable settings. Two sections:
 * 1. OTLP/HTTP receiver port (existing).
 * 2. MCP server (new) — on/off toggle + port. When MCP is on we also
 *    show the live `http://...` endpoint so the user can copy it into
 *    Codex CLI / Claude Code / Cursor without rummaging through logs.
 *
 * Validation runs on submit; bind errors from the main process surface
 * inline rather than as toasts. We send a single combined patch so the
 * two-phase update in `main/index.ts` can roll back atomically.
 */
export function SettingsModal(props: SettingsModalProps): JSX.Element {
	const { settings, currentPort, mcpStatus, onSave, onClose } = props;
	const [portInput, setPortInput] = useState(String(currentPort ?? settings.otlp.port));
	const [mcpEnabled, setMcpEnabled] = useState(settings.mcp.enabled);
	const [mcpPortInput, setMcpPortInput] = useState(String(settings.mcp.port));
	const [error, setError] = useState<string | undefined>(undefined);
	const [saving, setSaving] = useState(false);
	const portInputRef = useRef<HTMLInputElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
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
		const parsedOtlp = Number.parseInt(portInput, 10);
		if (!Number.isInteger(parsedOtlp) || parsedOtlp < MIN_PORT || parsedOtlp > MAX_PORT) {
			setError(`OTLP port must be an integer between ${MIN_PORT} and ${MAX_PORT}.`);
			return;
		}
		const parsedMcp = Number.parseInt(mcpPortInput, 10);
		if (!Number.isInteger(parsedMcp) || parsedMcp < MIN_PORT || parsedMcp > MAX_PORT) {
			setError(`MCP port must be an integer between ${MIN_PORT} and ${MAX_PORT}.`);
			return;
		}
		if (mcpEnabled && parsedMcp === parsedOtlp) {
			setError('MCP port must differ from OTLP port.');
			return;
		}
		setError(undefined);
		setSaving(true);
		const patch: PartialSettings = {
			otlp: { port: parsedOtlp },
			mcp: { enabled: mcpEnabled, port: parsedMcp },
		};
		const result = await onSave(patch);
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
							The OTLP/HTTP receiver listens on <code>127.0.0.1:&lt;port&gt;/v1/traces</code>. Changing
							it restarts the receiver immediately.
						</span>
					</label>

					<fieldset className="fieldset">
						<legend>MCP server (for GitHub Copilot, Codex, Claude, Cursor)</legend>
						<label className="field field--inline">
							<input
								type="checkbox"
								checked={mcpEnabled}
								onChange={(e) => setMcpEnabled(e.target.checked)}
								disabled={saving}
							/>
							<span>Run a local MCP server so external AI agents can query OTelux</span>
						</label>
						<label className="field">
							<span className="field__label">MCP port</span>
							<input
								type="number"
								min={MIN_PORT}
								max={MAX_PORT}
								step={1}
								value={mcpPortInput}
								onChange={(e) => setMcpPortInput(e.target.value)}
								disabled={saving || !mcpEnabled}
							/>
							<span className="field__hint">
								{mcpEnabled ? (
									<>
										Point your AI tool at{' '}
										<code>
											http://127.0.0.1:
											{mcpStatus?.kind === 'running' ? mcpStatus.port : mcpPortInput}/
										</code>
										. {mcpStatus ? <McpStatusHint status={mcpStatus} /> : null}
									</>
								) : (
									<>MCP server is off. OTLP ingest is unaffected.</>
								)}
							</span>
						</label>
					</fieldset>

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

function McpStatusHint({ status }: { status: McpStatus }): JSX.Element | null {
	switch (status.kind) {
		case 'running':
			return <em className="field__status field__status--ok">running</em>;
		case 'starting':
			return <em className="field__status">starting…</em>;
		case 'disabled':
			return null;
		case 'error':
			return <em className="field__status field__status--error">error: {status.message}</em>;
	}
}
