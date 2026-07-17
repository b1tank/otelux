import { join } from 'node:path';
import { createEngine } from '@otelux/engine';
import { type NodeSqliteStorage, createNodeSqliteStorage } from '@otelux/engine-node';
import type {
	DataSource,
	Disposable,
	LoadSampleDataResult,
	McpStatus,
	PartialSettings,
	ReceiverStatus,
	RuntimeEvent,
	Settings,
	StoragePathInfo,
	UpdateSettingsResult,
} from '@otelux/protocol';
import { createDemoTelemetry } from './demoData.js';
import { McpHost } from './mcpHost.js';
import { loadOrCreateMcpToken } from './mcpToken.js';
import { ReceiverHost } from './receiverHost.js';
import { SettingsStore } from './settings.js';
import { updateSettings } from './updateSettings.js';

export interface RuntimeLogger {
	info(message: string): void;
	error(message: string): void;
}

export interface CreateLocalRuntimeOptions {
	/** Product-level per-user directory containing settings, token, and default database. */
	readonly dataDirectory: string;
	readonly host?: string;
	/** One-shot bind override. `0` asks the OS for a free port and is intended for tests. */
	readonly otlpPortOverride?: number;
	readonly otlpMaxBodyBytes?: number;
	readonly mcpMaxBodyBytes?: number;
	readonly logger?: RuntimeLogger;
}

export interface LocalRuntime extends DataSource {
	readonly dataDirectory: string;
	readonly mcpTokenFile: string;
	getSettings(): Settings;
	getReceiverStatus(): ReceiverStatus;
	getMcpStatus(): McpStatus;
	getStoragePath(): StoragePathInfo;
	updateSettings(patch: PartialSettings): Promise<UpdateSettingsResult>;
	loadSampleData(): Promise<LoadSampleDataResult>;
	clearData(): Promise<void>;
	onEvent(listener: (event: RuntimeEvent) => void): Disposable;
	close(): Promise<void>;
}

export async function createLocalRuntime(
	options: CreateLocalRuntimeOptions,
): Promise<LocalRuntime> {
	const host = options.host ?? '127.0.0.1';
	const logger = options.logger ?? console;
	const settingsFile = join(options.dataDirectory, 'settings.json');
	const defaultDbPath = join(options.dataDirectory, 'otelux.db');
	const mcpTokenFile = join(options.dataDirectory, 'mcp-token');
	const settings = await SettingsStore.open(settingsFile);
	const mcpToken = await loadOrCreateMcpToken(mcpTokenFile);
	const configuredDbPath = settings.get().storage.dbPath;
	const { storage, activeDbPath } = openStorage(
		configuredDbPath !== '' ? configuredDbPath : defaultDbPath,
		defaultDbPath,
		settings.get().retention,
		logger,
	);
	const engine = createEngine({ storage });
	const receiverHost = new ReceiverHost(engine, host, options.otlpMaxBodyBytes);
	const mcpHost = new McpHost(engine, host, options.mcpMaxBodyBytes, mcpToken);
	const eventListeners = new Set<(event: RuntimeEvent) => void>();
	let closed = false;

	const emit = (event: RuntimeEvent): void => {
		for (const listener of eventListeners) {
			try {
				listener(event);
			} catch {
				// A client event handler must not break ingest or runtime control.
			}
		}
	};

	const offEngine = engine.subscribe(emit);
	const offReceiver = receiverHost.onChange((status) => {
		emit({ kind: 'receiver-status-changed', status });
	});
	const offMcp = mcpHost.onChange((status) => {
		emit({ kind: 'mcp-status-changed', status });
	});
	const offSettings = settings.onChange((next) => {
		storage.applyRetention(next.retention);
		emit({ kind: 'settings-changed', settings: next });
	});

	const initialPort = options.otlpPortOverride ?? settings.get().otlp.port;
	const receiverStatus = await receiverHost.start(initialPort);
	if (receiverStatus.kind === 'running') {
		logger.info(
			`[otelux] OTLP/HTTP receiver listening on http://${receiverStatus.host}:${receiverStatus.port}/v1/{traces,logs,metrics}`,
		);
	} else if (receiverStatus.kind === 'error') {
		logger.error(
			`[otelux] OTLP/HTTP receiver failed to bind on ${receiverStatus.host}:${receiverStatus.port}: ${receiverStatus.message}`,
		);
	}

	const current = settings.get();
	if (current.mcp.enabled) {
		const mcpStatus = await mcpHost.start(current.mcp.port);
		if (mcpStatus.kind === 'running') {
			logger.info(`[otelux] MCP server listening on http://${mcpStatus.host}:${mcpStatus.port}/`);
			logger.info(
				`[otelux] MCP requires an Authorization: Bearer token; read it from ${mcpTokenFile}`,
			);
		} else if (mcpStatus.kind === 'error') {
			logger.error(
				`[otelux] MCP server failed to bind on ${mcpStatus.host}:${mcpStatus.port}: ${mcpStatus.message}`,
			);
		}
	} else {
		await mcpHost.disable();
	}

	return {
		kind: 'otelux/datasource',
		dataDirectory: options.dataDirectory,
		mcpTokenFile,
		listTraces: (query) => engine.listTraces(query),
		getTrace: (query) => engine.getTrace(query),
		getSpanDetails: (query) => engine.getSpanDetails(query),
		listLogs: (query) => engine.listLogs(query),
		listMetrics: (query) => engine.listMetrics(query),
		subscribe: (handler) => engine.subscribe(handler),
		getSettings: () => settings.get(),
		getReceiverStatus: () => receiverHost.status,
		getMcpStatus: () => mcpHost.status,
		getStoragePath: () => ({ activePath: activeDbPath, defaultPath: defaultDbPath }),
		updateSettings: (patch) => updateSettings(settings, receiverHost, mcpHost, patch),
		async loadSampleData(): Promise<LoadSampleDataResult> {
			const status = receiverHost.status;
			const demo = createDemoTelemetry(status.kind === 'running' ? { otlpPort: status.port } : {});
			await engine.ingestSpans(demo.spans);
			await engine.ingestLogs(demo.logs);
			await engine.ingestMetrics(demo.metrics);
			return {
				traces: new Set(demo.spans.map((span) => span.traceId)).size,
				logs: demo.logs.length,
				metrics: demo.metrics.length,
			};
		},
		clearData: () => engine.clear(),
		onEvent(listener): Disposable {
			eventListeners.add(listener);
			return {
				dispose: () => {
					eventListeners.delete(listener);
				},
			};
		},
		async close(): Promise<void> {
			if (closed) {
				return;
			}
			closed = true;
			offEngine.dispose();
			offReceiver();
			offMcp();
			offSettings();
			eventListeners.clear();
			await receiverHost.stop();
			await mcpHost.stop();
			await engine.close();
		},
	};
}

function openStorage(
	preferredPath: string,
	defaultPath: string,
	retention: Settings['retention'],
	logger: RuntimeLogger,
): { storage: NodeSqliteStorage; activeDbPath: string } {
	try {
		return {
			storage: createNodeSqliteStorage({ path: preferredPath, retention }),
			activeDbPath: preferredPath,
		};
	} catch (error) {
		if (preferredPath === defaultPath) {
			throw error;
		}
		logger.error(
			`[otelux] failed to open database at ${preferredPath}; falling back to ${defaultPath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return {
			storage: createNodeSqliteStorage({ path: defaultPath, retention }),
			activeDbPath: defaultPath,
		};
	}
}
