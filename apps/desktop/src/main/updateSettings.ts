import type {
	McpStatus,
	PartialSettings,
	ReceiverStatus,
	Settings,
	UpdateSettingsResult,
} from '../shared/ipc.js';

/**
 * Minimal control surfaces `updateSettings` needs. `ReceiverHost`,
 * `McpHost`, and `SettingsStore` satisfy these structurally; declaring
 * them here keeps the two-phase update logic free of Electron and file
 * I/O so it can be unit-tested with plain fakes.
 */
export interface ReceiverController {
	readonly status: ReceiverStatus;
	start(port: number): Promise<ReceiverStatus>;
}

export interface McpController {
	readonly status: McpStatus;
	start(port: number): Promise<McpStatus>;
	disable(): Promise<void>;
}

export interface SettingsWriter {
	preview(patch: PartialSettings): Settings;
	commit(next: Settings): Promise<Settings>;
}

/**
 * Two-phase settings update: validate, try to rebind, only then persist.
 *
 * The old "persist first, then bind" order corrupted `settings.json`
 * whenever the new port could not be acquired (EACCES on privileged
 * ports, EADDRINUSE on contended ones) — the bad value survived restarts
 * and bricked the app until the user wiped their user-data directory.
 * Binding first means any failure — a bad port or a failed write — leaves
 * both disk state and the running listeners on the previous values, and
 * the renderer just shows the error inline.
 *
 * Every path that has already mutated a listener rolls it back to its
 * previous shape before returning an error, including the case where the
 * listeners rebound successfully but persisting the new settings failed.
 */
export async function updateSettings(
	store: SettingsWriter,
	receiverHost: ReceiverController,
	mcpHost: McpController,
	patch: PartialSettings,
): Promise<UpdateSettingsResult> {
	let next: Settings;
	try {
		next = store.preview(patch);
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}

	const previousReceiverStatus = receiverHost.status;
	const previousMcpStatus = mcpHost.status;
	const currentReceiverPort =
		previousReceiverStatus.kind === 'running' ? previousReceiverStatus.port : undefined;
	const currentMcpEnabled = previousMcpStatus.kind === 'running';
	const currentMcpPort = previousMcpStatus.kind === 'running' ? previousMcpStatus.port : undefined;

	// Track which listeners we actually touched so rollback restores only
	// those, never dropping an unrelated healthy listener.
	let receiverMutated = false;
	let mcpMutated = false;

	const rollback = async (): Promise<void> => {
		if (mcpMutated) {
			if (currentMcpEnabled && currentMcpPort !== undefined) {
				await mcpHost.start(currentMcpPort);
			} else {
				await mcpHost.disable();
			}
		}
		if (receiverMutated && previousReceiverStatus.kind === 'running') {
			await receiverHost.start(previousReceiverStatus.port);
		}
	};

	// Receiver: only rebind if the port actually changes. Avoids a
	// pointless drop in OTLP ingest when the user toggles MCP.
	let status = previousReceiverStatus;
	if (currentReceiverPort !== next.otlp.port) {
		status = await receiverHost.start(next.otlp.port);
		receiverMutated = true;
		if (status.kind === 'error') {
			await rollback();
			return { ok: false, error: status.message };
		}
	}

	// MCP: enable/disable + restart on port change. Rollback on failure
	// returns the user to exactly the MCP state they had before the edit,
	// so a busted toggle never leaves orphaned listeners.
	let mcpStatus: McpStatus = mcpHost.status;
	const wantMcp = next.mcp.enabled;
	const portChanged = currentMcpPort !== next.mcp.port;
	if (!wantMcp) {
		if (currentMcpEnabled) {
			await mcpHost.disable();
			mcpMutated = true;
		}
		mcpStatus = mcpHost.status;
	} else if (!currentMcpEnabled || portChanged) {
		mcpStatus = await mcpHost.start(next.mcp.port);
		mcpMutated = true;
		if (mcpStatus.kind === 'error') {
			await rollback();
			return { ok: false, error: mcpStatus.message };
		}
	}

	// Persist last. If the write fails, roll the listeners back so the
	// running state matches the settings still on disk rather than
	// silently diverging from them.
	try {
		await store.commit(next);
	} catch (err) {
		await rollback();
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	return { ok: true, settings: next, status, mcpStatus };
}
