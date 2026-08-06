import {
	MAX_PORT,
	MAX_RETENTION_AGE_HOURS,
	MAX_RETENTION_SIZE_MB,
	MIN_PORT,
} from '@otelux/protocol';
import { ActivityIcon, CopyButton, DatabaseIcon, XIcon } from '@otelux/ui';
import { type JSX, useEffect, useRef, useState } from 'react';
import type {
	McpStatus,
	PartialSettings,
	Settings,
	StoragePathInfo,
	StorageUsageInfo,
	UpdateSettingsResult,
} from '../../shared/ipc.js';
import { StorageBudgetMeter } from './StorageBudgetMeter.js';

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
	readonly storageUsage?: StorageUsageInfo;
	readonly onSave: (
		patch: PartialSettings,
		expectedRevision: number,
	) => Promise<UpdateSettingsResult>;
	readonly onClose: () => void;
}

type SettingsCategory = 'connections' | 'storage';
type SettingsField = 'otlpPort' | 'mcpPort' | 'retentionAge' | 'retentionSize' | 'databasePath';

interface SettingsInput {
	readonly otlpPort: string;
	readonly mcpEnabled: boolean;
	readonly mcpPort: string;
	readonly retentionAge: string;
	readonly retentionSize: string;
	readonly databasePath: string;
}

type SettingsValidationResult =
	| { readonly ok: true; readonly patch: PartialSettings }
	| {
			readonly ok: false;
			readonly category: SettingsCategory;
			readonly field: SettingsField;
			readonly error: string;
	  };

/**
 * Edit runtime settings as one atomic form, split into task-based categories.
 * Validation reveals the category that owns the invalid value before focusing
 * it, while bind and persistence errors from the main process stay visible in
 * the persistent footer.
 */
export function SettingsModal(props: SettingsModalProps): JSX.Element {
	const { settings, currentPort, mcpStatus, storagePath, storageUsage, onSave, onClose } = props;
	const [activeCategory, setActiveCategory] = useState<SettingsCategory>('connections');
	const [baseRevision] = useState(settings.revision);
	const [portInput, setPortInput] = useState(String(currentPort ?? settings.otlp.port));
	const [mcpEnabled, setMcpEnabled] = useState(settings.mcp.enabled);
	const [mcpPortInput, setMcpPortInput] = useState(String(settings.mcp.port));
	const [ageInput, setAgeInput] = useState(String(settings.retention.maxAgeHours));
	const [sizeInput, setSizeInput] = useState(String(settings.retention.maxSizeMb));
	const [dbPathInput, setDbPathInput] = useState(settings.storage.dbPath);
	const [error, setError] = useState<string | undefined>(undefined);
	const [saving, setSaving] = useState(false);
	const portInputRef = useRef<HTMLInputElement>(null);
	const mcpPortInputRef = useRef<HTMLInputElement>(null);
	const ageInputRef = useRef<HTMLInputElement>(null);
	const sizeInputRef = useRef<HTMLInputElement>(null);
	const dbPathInputRef = useRef<HTMLInputElement>(null);
	const connectionsTabRef = useRef<HTMLButtonElement>(null);
	const storageTabRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		connectionsTabRef.current?.focus();
		return () => previouslyFocused?.focus();
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
		).filter((element) => element.tabIndex >= 0 && element.closest('[hidden]') === null);
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

	const focusCategoryTab = (category: SettingsCategory): void => {
		if (category === 'connections') {
			connectionsTabRef.current?.focus();
		} else {
			storageTabRef.current?.focus();
		}
	};

	const onCategoryKeyDown = (
		e: React.KeyboardEvent<HTMLButtonElement>,
		category: SettingsCategory,
	): void => {
		let nextCategory: SettingsCategory | undefined;
		switch (e.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				nextCategory = category === 'connections' ? 'storage' : 'connections';
				break;
			case 'Home':
				nextCategory = 'connections';
				break;
			case 'End':
				nextCategory = 'storage';
				break;
		}
		if (nextCategory === undefined) {
			return;
		}
		e.preventDefault();
		setActiveCategory(nextCategory);
		focusCategoryTab(nextCategory);
	};

	const focusValidationField = (field: SettingsField): void => {
		window.requestAnimationFrame(() => {
			switch (field) {
				case 'otlpPort':
					portInputRef.current?.focus();
					break;
				case 'mcpPort':
					mcpPortInputRef.current?.focus();
					break;
				case 'retentionAge':
					ageInputRef.current?.focus();
					break;
				case 'retentionSize':
					sizeInputRef.current?.focus();
					break;
				case 'databasePath':
					dbPathInputRef.current?.focus();
					break;
			}
		});
	};

	const onSubmit = async (e: React.FormEvent): Promise<void> => {
		e.preventDefault();
		const validation = validateSettingsInput({
			otlpPort: portInput,
			mcpEnabled,
			mcpPort: mcpPortInput,
			retentionAge: ageInput,
			retentionSize: sizeInput,
			databasePath: dbPathInput,
		});
		if (!validation.ok) {
			setActiveCategory(validation.category);
			setError(validation.error);
			focusValidationField(validation.field);
			return;
		}
		setError(undefined);
		setSaving(true);
		const result = await onSave(validation.patch, baseRevision);
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
	const previewAgeHours = parsePreviewLimit(ageInput, settings.retention.maxAgeHours);
	const previewSizeMb = parsePreviewLimit(sizeInput, settings.retention.maxSizeMb);

	return (
		<div className="modal-backdrop">
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: This pointer-only backdrop is hidden from accessibility APIs; Close, Cancel, and Escape provide keyboard paths. */}
			<div className="modal-backdrop__hit" onClick={onBackdropClick} aria-hidden="true" />
			<dialog
				ref={dialogRef}
				className="settings-modal"
				aria-modal="true"
				aria-labelledby="settings-title"
				open
				onKeyDown={onDialogKeyDown}
			>
				<aside className="settings-modal__sidebar">
					<div className="settings-modal__brand" id="settings-title">
						Settings
					</div>
					<span className="settings-modal__nav-label">Runtime</span>
					<div
						className="settings-modal__nav"
						role="tablist"
						aria-label="Settings categories"
						aria-orientation="vertical"
					>
						<button
							ref={connectionsTabRef}
							type="button"
							role="tab"
							id="settings-tab-connections"
							aria-controls="settings-panel-connections"
							aria-selected={activeCategory === 'connections'}
							tabIndex={activeCategory === 'connections' ? 0 : -1}
							onClick={() => setActiveCategory('connections')}
							onKeyDown={(e) => onCategoryKeyDown(e, 'connections')}
							disabled={saving}
						>
							<ActivityIcon size={16} />
							Connections
						</button>
						<button
							ref={storageTabRef}
							type="button"
							role="tab"
							id="settings-tab-storage"
							aria-controls="settings-panel-storage"
							aria-selected={activeCategory === 'storage'}
							tabIndex={activeCategory === 'storage' ? 0 : -1}
							onClick={() => setActiveCategory('storage')}
							onKeyDown={(e) => onCategoryKeyDown(e, 'storage')}
							disabled={saving}
						>
							<DatabaseIcon size={16} />
							Storage
						</button>
					</div>
				</aside>

				<form className="settings-modal__shell" onSubmit={onSubmit} noValidate>
					<header className="settings-modal__header">
						<h2>{activeCategory === 'connections' ? 'Connections' : 'Storage'}</h2>
						<button
							type="button"
							className="settings-modal__close"
							onClick={onClose}
							aria-label="Close settings"
							title="Close settings"
							disabled={saving}
						>
							<XIcon size={16} />
						</button>
					</header>

					<div className="settings-modal__body">
						<section
							className="settings-modal__panel"
							role="tabpanel"
							id="settings-panel-connections"
							aria-labelledby="settings-tab-connections"
							hidden={activeCategory !== 'connections'}
						>
							<p className="settings-modal__intro">
								Configure local endpoints used by OpenTelemetry exporters and AI clients.
							</p>
							<section className="settings-modal__section">
								<h3>OTLP receiver</h3>
								<p className="settings-modal__section-description">
									Receives traces, logs, and metrics over OTLP/HTTP.
								</p>
								<ConnectionTrustPosture
									label="OTLP receiver trust posture"
									items={[
										['Access', 'Local write-only · no authentication'],
										['Boundary', '127.0.0.1 · browser origins blocked'],
									]}
								/>
								<div className="settings-modal__row">
									<div className="settings-modal__row-copy">
										<label className="settings-modal__row-title" htmlFor="settings-otlp-port">
											Port
										</label>
										<div id="settings-otlp-port-hint" className="settings-modal__row-hint">
											Changes restart the receiver immediately.
										</div>
									</div>
									<div className="settings-modal__control">
										<input
											ref={portInputRef}
											id="settings-otlp-port"
											aria-label="OTLP receiver port"
											aria-describedby="settings-otlp-port-hint"
											type="number"
											min={MIN_PORT}
											max={MAX_PORT}
											step={1}
											value={portInput}
											onChange={(e) => setPortInput(e.target.value)}
											disabled={saving}
										/>
									</div>
								</div>
							</section>

							<section className="settings-modal__section">
								<h3>MCP server</h3>
								<p className="settings-modal__section-description">
									Lets authorized local AI tools query OTelux.
								</p>
								<ConnectionTrustPosture
									label="MCP server trust posture"
									items={[
										['Access', 'Authenticated · read-only tools'],
										['Credential', 'Per-install bearer token · owner-only file'],
									]}
								/>
								<div className="settings-modal__row">
									<div className="settings-modal__row-copy">
										<label className="settings-modal__row-title" htmlFor="settings-mcp-enabled">
											Enabled
										</label>
										<div id="settings-mcp-enabled-hint" className="settings-modal__row-hint">
											OTLP ingest is unaffected when MCP is off.
										</div>
									</div>
									<div className="settings-modal__control">
										<label className="settings-modal__switch" title="Enable MCP server">
											<input
												id="settings-mcp-enabled"
												type="checkbox"
												role="switch"
												aria-label="MCP server enabled"
												aria-describedby="settings-mcp-enabled-hint"
												aria-checked={mcpEnabled}
												checked={mcpEnabled}
												onChange={(e) => setMcpEnabled(e.target.checked)}
												disabled={saving}
											/>
											<span aria-hidden="true" />
										</label>
									</div>
								</div>
								<div className="settings-modal__row">
									<div className="settings-modal__row-copy">
										<label className="settings-modal__row-title" htmlFor="settings-mcp-port">
											Port
										</label>
										<div id="settings-mcp-port-hint" className="settings-modal__row-hint">
											{mcpEnabled ? (
												<>
													Currently at{' '}
													<code>
														http://127.0.0.1:
														{mcpStatus?.kind === 'running' ? mcpStatus.port : mcpPortInput}/
													</code>
													{mcpStatus ? <McpStatusHint status={mcpStatus} /> : null}
												</>
											) : (
												<>MCP server is off.</>
											)}
										</div>
									</div>
									<div className="settings-modal__control">
										<input
											ref={mcpPortInputRef}
											id="settings-mcp-port"
											aria-label="MCP server port"
											aria-describedby="settings-mcp-port-hint"
											type="number"
											min={MIN_PORT}
											max={MAX_PORT}
											step={1}
											value={mcpPortInput}
											onChange={(e) => setMcpPortInput(e.target.value)}
											disabled={saving}
										/>
									</div>
								</div>
							</section>
						</section>

						<section
							className="settings-modal__panel"
							role="tabpanel"
							id="settings-panel-storage"
							aria-labelledby="settings-tab-storage"
							hidden={activeCategory !== 'storage'}
						>
							<p className="settings-modal__intro">
								Control how long telemetry remains on disk and where SQLite stores it.
							</p>
							<section className="settings-modal__section">
								<h3>Retention</h3>
								<p className="settings-modal__section-description">
									Oldest telemetry is pruned when either limit is reached.
								</p>
								<StorageBudgetMeter
									{...(storageUsage !== undefined ? { usage: storageUsage } : {})}
									maxSizeMb={previewSizeMb}
									maxAgeHours={previewAgeHours}
								/>
								<div className="settings-modal__row">
									<div className="settings-modal__row-copy">
										<label className="settings-modal__row-title" htmlFor="settings-retention-age">
											Keep for
										</label>
										<div id="settings-retention-age-hint" className="settings-modal__row-hint">
											Hours; 0 keeps telemetry forever.
										</div>
									</div>
									<div className="settings-modal__control">
										<input
											ref={ageInputRef}
											id="settings-retention-age"
											aria-label="Retention age in hours"
											aria-describedby="settings-retention-age-hint"
											type="number"
											min={0}
											max={MAX_RETENTION_AGE_HOURS}
											step={1}
											value={ageInput}
											onChange={(e) => setAgeInput(e.target.value)}
											disabled={saving}
										/>
									</div>
								</div>
								<div className="settings-modal__row">
									<div className="settings-modal__row-copy">
										<label className="settings-modal__row-title" htmlFor="settings-retention-size">
											Maximum size
										</label>
										<div id="settings-retention-size-hint" className="settings-modal__row-hint">
											Megabytes; 0 disables the size limit.
										</div>
									</div>
									<div className="settings-modal__control">
										<input
											ref={sizeInputRef}
											id="settings-retention-size"
											aria-label="Maximum database size in megabytes"
											aria-describedby="settings-retention-size-hint"
											type="number"
											min={0}
											max={MAX_RETENTION_SIZE_MB}
											step={1}
											value={sizeInput}
											onChange={(e) => setSizeInput(e.target.value)}
											disabled={saving}
										/>
									</div>
								</div>
							</section>

							<section className="settings-modal__section">
								<h3>Database location</h3>
								<p className="settings-modal__section-description">
									Path changes take effect after restart; the current database is not moved.
								</p>
								{storagePath ? (
									<div className="settings-modal__row">
										<div className="settings-modal__row-copy">
											<div className="settings-modal__row-title">Active database file</div>
											<code className="settings-modal__path">{storagePath.activePath}</code>
										</div>
										<div className="settings-modal__control">
											<CopyButton
												value={storagePath.activePath}
												className="settings-modal__copy"
												title="Copy active database path"
											/>
										</div>
									</div>
								) : null}
								<div className="settings-modal__row">
									<div className="settings-modal__row-copy">
										<label className="settings-modal__row-title" htmlFor="settings-database-path">
											Custom path
										</label>
										<div id="settings-database-path-hint" className="settings-modal__row-hint">
											Leave blank to use the default location.
											{restartPending ? (
												<em className="settings-modal__status settings-modal__status--error">
													{' '}
													Restart required.
												</em>
											) : null}
										</div>
									</div>
									<div className="settings-modal__control">
										<input
											ref={dbPathInputRef}
											id="settings-database-path"
											aria-label="Custom database path"
											aria-describedby="settings-database-path-hint"
											type="text"
											spellCheck={false}
											placeholder={storagePath?.defaultPath ?? 'Default location'}
											value={dbPathInput}
											onChange={(e) => setDbPathInput(e.target.value)}
											disabled={saving}
										/>
									</div>
								</div>
							</section>
						</section>
					</div>

					<footer className="settings-modal__footer">
						{error ? (
							<p className="settings-modal__error" role="alert">
								{error}
							</p>
						) : (
							<span className="settings-modal__footer-spacer" />
						)}
						<div className="settings-modal__actions">
							<button type="button" onClick={onClose} disabled={saving}>
								Cancel
							</button>
							<button type="submit" className="primary" disabled={saving}>
								{saving ? 'Saving…' : 'Save'}
							</button>
						</div>
					</footer>
				</form>
			</dialog>
		</div>
	);
}

function parsePreviewLimit(value: string, fallback: number): number {
	return parseRetentionLimit(value) ?? fallback;
}

export function parseRetentionLimit(value: string): number | undefined {
	return /^\d+$/.test(value) ? Number.parseInt(value, 10) : undefined;
}

function ConnectionTrustPosture(props: {
	readonly label: string;
	readonly items: ReadonlyArray<readonly [label: string, value: string]>;
}): JSX.Element {
	return (
		<div className="settings-modal__trust" aria-label={props.label}>
			{props.items.map(([label, value]) => (
				<div className="settings-modal__trust-item" key={label}>
					<div className="settings-modal__trust-label">{label}</div>
					<div className="settings-modal__trust-value">{value}</div>
				</div>
			))}
		</div>
	);
}

export function validateSettingsInput(input: SettingsInput): SettingsValidationResult {
	const parsedOtlp = parseRetentionLimit(input.otlpPort);
	if (parsedOtlp === undefined || parsedOtlp < MIN_PORT || parsedOtlp > MAX_PORT) {
		return {
			ok: false,
			category: 'connections',
			field: 'otlpPort',
			error: `OTLP port must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
		};
	}
	const parsedMcp = parseRetentionLimit(input.mcpPort);
	if (parsedMcp === undefined || parsedMcp < MIN_PORT || parsedMcp > MAX_PORT) {
		return {
			ok: false,
			category: 'connections',
			field: 'mcpPort',
			error: `MCP port must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
		};
	}
	if (input.mcpEnabled && parsedMcp === parsedOtlp) {
		return {
			ok: false,
			category: 'connections',
			field: 'mcpPort',
			error: 'MCP port must differ from OTLP port.',
		};
	}
	const parsedAge = parseRetentionLimit(input.retentionAge);
	if (parsedAge === undefined || parsedAge > MAX_RETENTION_AGE_HOURS) {
		return {
			ok: false,
			category: 'storage',
			field: 'retentionAge',
			error: `Retention age must be between 0 and ${MAX_RETENTION_AGE_HOURS} hours (0 = unlimited).`,
		};
	}
	const parsedSize = parseRetentionLimit(input.retentionSize);
	if (parsedSize === undefined || parsedSize > MAX_RETENTION_SIZE_MB) {
		return {
			ok: false,
			category: 'storage',
			field: 'retentionSize',
			error: `Retention size must be between 0 and ${MAX_RETENTION_SIZE_MB} MB (0 = unlimited).`,
		};
	}
	const trimmedDbPath = input.databasePath.trim();
	if (trimmedDbPath !== '' && !isAbsolutePath(trimmedDbPath)) {
		return {
			ok: false,
			category: 'storage',
			field: 'databasePath',
			error: 'Database path must be an absolute path, or blank for the default location.',
		};
	}
	if (trimmedDbPath !== '' && /[\\/]$/.test(trimmedDbPath)) {
		return {
			ok: false,
			category: 'storage',
			field: 'databasePath',
			error: 'Database path must point at a file, not a directory.',
		};
	}

	return {
		ok: true,
		patch: {
			otlp: { port: parsedOtlp },
			mcp: { enabled: input.mcpEnabled, port: parsedMcp },
			retention: { maxAgeHours: parsedAge, maxSizeMb: parsedSize },
			storage: { dbPath: trimmedDbPath },
		},
	};
}

function McpStatusHint({ status }: { status: McpStatus }): JSX.Element | null {
	switch (status.kind) {
		case 'running':
			return <em className="settings-modal__status settings-modal__status--ok"> running</em>;
		case 'starting':
			return <em className="settings-modal__status"> starting…</em>;
		case 'disabled':
			return null;
		case 'error':
			return (
				<em className="settings-modal__status settings-modal__status--error">
					{' '}
					error: {status.message}
				</em>
			);
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
