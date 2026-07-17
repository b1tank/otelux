import type {
	McpStatus,
	PartialSettings,
	ReceiverStatus,
	Settings,
	UpdateSettingsResult,
} from '@otelux/protocol';

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

export async function updateSettings(
	store: SettingsWriter,
	receiverHost: ReceiverController,
	mcpHost: McpController,
	patch: PartialSettings,
): Promise<UpdateSettingsResult> {
	let next: Settings;
	try {
		next = store.preview(patch);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	const previousReceiverStatus = receiverHost.status;
	const previousMcpStatus = mcpHost.status;
	const currentReceiverPort =
		previousReceiverStatus.kind === 'running' ? previousReceiverStatus.port : undefined;
	const currentMcpEnabled = previousMcpStatus.kind === 'running';
	const currentMcpPort = previousMcpStatus.kind === 'running' ? previousMcpStatus.port : undefined;
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

	let status = previousReceiverStatus;
	if (currentReceiverPort !== next.otlp.port) {
		status = await receiverHost.start(next.otlp.port);
		receiverMutated = true;
		if (status.kind === 'error') {
			await rollback();
			return { ok: false, error: status.message };
		}
	}

	let mcpStatus: McpStatus = mcpHost.status;
	const portChanged = currentMcpPort !== next.mcp.port;
	if (!next.mcp.enabled) {
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

	try {
		await store.commit(next);
	} catch (error) {
		await rollback();
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	return { ok: true, settings: next, status, mcpStatus };
}
