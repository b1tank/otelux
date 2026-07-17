import {
	MAX_PORT,
	MAX_RETENTION_AGE_HOURS,
	MAX_RETENTION_SIZE_MB,
	MIN_PORT,
} from '@otelux/protocol';
import { type JSX, useEffect, useRef, useState } from 'react';
import type {
	McpStatus,
	PartialSettings,
	Settings,
	StoragePathInfo,
	UpdateSettingsResult,
} from '../../shared/ipc.js';

interface SettingsModalProps {
	readonly settings: Settings;
	/**
	 * Port the OTLP receiver is actually bound to right now. Env overrides can
	 * make this differ from the persisted setting.
	 */
	readonly currentPort?: number;
	/**
	 * Live MCP status so the modal can show the actual bound endpoint
	 * inline below the toggle (no need to leave Settings to copy the
	 * MCP URL into an external agent config).
	 */
	readonly mcpStatus?: McpStatus;
	/**
	 * Resolved storage location. `activePath` is the database the running app has
	 * open; `defaultPath` is where it lives with no custom path. Used to show the
	 * current DB file and detect a pending restart after a path change.
	 */
	readonly storagePath?: StoragePathInfo;
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
	const { settings, currentPort, mcpStatus, storagePath, onSave, onClose } = props;
	const [portInput, setPortInput] = useState(String(currentPort ?? settings.otlp.port));
	const [mcpEnabled, setMcpEnabled] = useState(settings.mcp.enabled);
	const [mcpPortInput, setMcpPortInput] = useState(String(settings.mcp.port));
	const [ageInput, setAgeInput] = useState(String(settings.retention.maxAgeHours));
	const [sizeInput, setSizeInput] = useState(String(settings.retention.maxSizeMb));
	const [dbPathInput, setDbPathInput] = useState(settings.storage.dbPath);
	const [copiedPath, setCopiedPath] = useState(false);
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
		const parsedAge = Number.parseInt(ageInput, 10);
		if (!Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > MAX_RETENTION_AGE_HOURS) {
			setError(
				`Retention age must be between 0 and ${MAX_RETENTION_AGE_HOURS} hours (0 = unlimited).`,
			);
			return;
		}
		const parsedSize = Number.parseInt(sizeInput, 10);
		if (!Number.isInteger(parsedSize) || parsedSize < 0 || parsedSize > MAX_RETENTION_SIZE_MB) {
			setError(`Retention size must be between 0 and ${MAX_RETENTION_SIZE_MB} MB (0 = unlimited).`);
			return;
		}
		const trimmedDbPath = dbPathInput.trim();
		if (trimmedDbPath !== '' && !isAbsolutePath(trimmedDbPath)) {
			setError('Database path must be an absolute path, or blank for the default location.');
			return;
		}
		if (trimmedDbPath !== '' && /[\\/]$/.test(trimmedDbPath)) {
			setError('Database path must point at a file, not a directory.');
			return;
		}
		setError(undefined);
		setSaving(true);
		const patch: PartialSettings = {
			otlp: { port: parsedOtlp },
			mcp: { enabled: mcpEnabled, port: parsedMcp },
			retention: { maxAgeHours: parsedAge, maxSizeMb: parsedSize },
			storage: { dbPath: trimmedDbPath },
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

	// The DB path only takes effect on restart, so warn when the edited path
	// resolves to something other than the database currently open. A blank
	// custom path resolves to the default location.
	const resolvedDesiredPath =
		dbPathInput.trim() === '' ? (storagePath?.defaultPath ?? '') : dbPathInput.trim();
	const restartPending = storagePath !== undefined && resolvedDesiredPath !== storagePath.activePath;

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
							The OTLP/HTTP receiver listens on{' '}
							<code>127.0.0.1:&lt;port&gt;/v1/&#123;traces,logs,metrics&#125;</code>. Changing it restarts
							the receiver immediately.
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

					<fieldset className="fieldset">
						<legend>Data retention</legend>
						<span className="field__hint">
							Telemetry is stored on disk and pruned when either limit is reached, whichever comes first.
							Set a value to <code>0</code> to disable that limit.
						</span>
						<label className="field">
							<span className="field__label">Keep for (hours)</span>
							<input
								type="number"
								min={0}
								max={MAX_RETENTION_AGE_HOURS}
								step={1}
								value={ageInput}
								onChange={(e) => setAgeInput(e.target.value)}
								disabled={saving}
							/>
							<span className="field__hint">
								Drop telemetry older than this. Default 72 (3 days). <code>0</code> = keep forever.
							</span>
						</label>
						<label className="field">
							<span className="field__label">Max database size (MB)</span>
							<input
								type="number"
								min={0}
								max={MAX_RETENTION_SIZE_MB}
								step={1}
								value={sizeInput}
								onChange={(e) => setSizeInput(e.target.value)}
								disabled={saving}
							/>
							<span className="field__hint">
								Prune oldest telemetry once the store passes this size. Default 512 MB. <code>0</code> = no
								size limit.
							</span>
						</label>
					</fieldset>

					<fieldset className="fieldset">
						<legend>Database location</legend>
						{storagePath ? (
							<div className="field">
								<span className="field__label">Active database file</span>
								<span className="field__inline-row">
									<code className="field__path">{storagePath.activePath}</code>
									<button
										type="button"
										className="field__copy"
										onClick={() => {
											void navigator.clipboard.writeText(storagePath.activePath).then(() => {
												setCopiedPath(true);
												window.setTimeout(() => setCopiedPath(false), 1500);
											});
										}}
									>
										{copiedPath ? 'Copied' : 'Copy'}
									</button>
								</span>
							</div>
						) : null}
						<label className="field">
							<span className="field__label">Custom database path</span>
							<input
								type="text"
								spellCheck={false}
								placeholder={storagePath?.defaultPath ?? 'Default location'}
								value={dbPathInput}
								onChange={(e) => setDbPathInput(e.target.value)}
								disabled={saving}
							/>
							<span className="field__hint">
								Absolute path to the SQLite file. Leave blank to use the default location. Changes take
								effect after you restart OTelux; the current database is not moved.
								{restartPending ? (
									<em className="field__status field__status--error">
										{' '}
										Restart required to switch to this path.
									</em>
								) : null}
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

/**
 * Cross-platform absolute-path check for the renderer, which cannot import
 * `node:path`. Accepts POSIX (`/…`), Windows drive (`C:\…` / `C:/…`), and UNC
 * (`\\host\…`) roots. The authoritative validation still runs in the main
 * process via `node:path.isAbsolute`; this only fails fast in the modal.
 */
function isAbsolutePath(value: string): boolean {
	return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}
