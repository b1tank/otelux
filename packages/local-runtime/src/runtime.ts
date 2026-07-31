import { join, resolve } from 'node:path';
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
	StorageUsageInfo,
	UpdateSettingsResult,
} from '@otelux/protocol';
import { OTELUX_PROTOCOL_VERSION } from '@otelux/protocol';
import { resolveOteluxDataDirectory } from './dataHome.js';
import { createDemoTelemetry } from './demoData.js';
import { McpHost } from './mcpHost.js';
import { loadOrCreateMcpToken } from './mcpToken.js';
import { type LegacyMigrationResult, prepareDataDirectory } from './migration.js';
import { ReceiverHost } from './receiverHost.js';
import {
	type RuntimeLockOwner,
	type RuntimeState,
	claimRuntimeOwnership,
	removeRuntimeState,
	writeRuntimeState,
} from './runtimeState.js';
import { SettingsStore } from './settings.js';
import { updateSettings } from './updateSettings.js';
import { OTELUX_LOCAL_RUNTIME_VERSION } from './version.js';

export interface RuntimeLogger {
	info(message: string): void;
	error(message: string): void;
}

export interface CreateLocalRuntimeOptions {
	/** Product-level per-user directory containing settings, token, and default database. */
	readonly dataDirectory?: string;
	/** Previous Desktop user-data directories considered for one-time migration. */
	readonly legacyDataDirectories?: readonly string[];
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
	readonly migration: LegacyMigrationResult;
	getSettings(): Settings;
	getReceiverStatus(): ReceiverStatus;
	getMcpStatus(): McpStatus;
	getStoragePath(): StoragePathInfo;
	getStorageUsage(): StorageUsageInfo;
	getRuntimeState(): RuntimeState;
	updateSettings(patch: PartialSettings): Promise<UpdateSettingsResult>;
	loadSampleData(): Promise<LoadSampleDataResult>;
	clearData(): Promise<void>;
	onEvent(listener: (event: RuntimeEvent) => void): Disposable;
	close(): Promise<void>;
}

export class RuntimeAlreadyRunningError extends Error {
	constructor(
		readonly owner: RuntimeLockOwner | undefined,
		readonly state: RuntimeState | undefined,
	) {
		super(
			state
				? `OTelux runtime is already running at ${state.dataDirectory} (PID ${state.pid})`
				: 'OTelux runtime ownership is already held by another process',
		);
		this.name = 'RuntimeAlreadyRunningError';
	}
}

export async function createLocalRuntime(
	options: CreateLocalRuntimeOptions,
): Promise<LocalRuntime> {
	const dataDirectory = options.dataDirectory
		? resolve(options.dataDirectory)
		: resolveOteluxDataDirectory();
	const host = options.host ?? '127.0.0.1';
	const logger = options.logger ?? console;
	const ownership = await claimRuntimeOwnership({ dataDirectory });
	if (ownership.role === 'client') {
		throw new RuntimeAlreadyRunningError(ownership.owner, ownership.state);
	}

	try {
		const migration = await prepareDataDirectory({
			dataDirectory,
			...(options.legacyDataDirectories !== undefined
				? { legacyDataDirectories: options.legacyDataDirectories }
				: {}),
			logger,
		});
		return await createOwnedRuntime({
			options,
			dataDirectory,
			host,
			logger,
			migration,
			owner: ownership.owner,
			releaseOwnership: ownership.release,
		});
	} catch (error) {
		await ownership.release();
		throw error;
	}
}

interface CreateOwnedRuntimeOptions {
	readonly options: CreateLocalRuntimeOptions;
	readonly dataDirectory: string;
	readonly host: string;
	readonly logger: RuntimeLogger;
	readonly migration: LegacyMigrationResult;
	readonly owner: RuntimeLockOwner;
	readonly releaseOwnership: () => Promise<void>;
}

async function createOwnedRuntime(input: CreateOwnedRuntimeOptions): Promise<LocalRuntime> {
	const { options, dataDirectory, host, logger, migration, owner, releaseOwnership } = input;
	const settingsFile = join(dataDirectory, 'settings.json');
	const defaultDbPath = join(dataDirectory, 'otelux.db');
	const mcpTokenFile = join(dataDirectory, 'mcp-token');
	const startedAt = new Date().toISOString();
	const eventListeners = new Set<(event: RuntimeEvent) => void>();
	let statePublishingEnabled = false;
	let stateWriteQueue = Promise.resolve();
	let closed = false;

	const settings = await SettingsStore.open(settingsFile);
	const mcpToken = await loadOrCreateMcpToken(mcpTokenFile);
	const configuredDbPath = settings.get().storage.dbPath;
	const opened = openStorage(
		configuredDbPath !== '' ? configuredDbPath : defaultDbPath,
		defaultDbPath,
		settings.get().retention,
		logger,
	);
	const storage = opened.storage;
	const activeDbPath = opened.activeDbPath;
	const engine = createEngine({ storage });
	const receiverHost = new ReceiverHost(engine, host, options.otlpMaxBodyBytes);
	const mcpHost = new McpHost(engine, host, options.mcpMaxBodyBytes, mcpToken);

	const runtimeState = (): RuntimeState => ({
		version: 1,
		runtimeVersion: OTELUX_LOCAL_RUNTIME_VERSION,
		protocolVersion: OTELUX_PROTOCOL_VERSION,
		instanceId: owner.instanceId,
		pid: owner.pid,
		startedAt,
		dataDirectory,
		databasePath: activeDbPath,
		mcpTokenFile,
		receiver: receiverHost.status,
		mcp: mcpHost.status,
	});

	const scheduleStateWrite = (): void => {
		if (!statePublishingEnabled) {
			return;
		}
		const snapshot = runtimeState();
		stateWriteQueue = stateWriteQueue
			.then(() => writeRuntimeState(dataDirectory, snapshot))
			.catch((error) => {
				logger.error(
					`[otelux] failed to update runtime state: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
	};

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
		scheduleStateWrite();
	});
	const offMcp = mcpHost.onChange((status) => {
		emit({ kind: 'mcp-status-changed', status });
		scheduleStateWrite();
	});
	const offSettings = settings.onChange((next) => {
		storage.applyRetention(next.retention);
		emit({ kind: 'settings-changed', settings: next });
		scheduleStateWrite();
	});

	const stopResources = async (): Promise<unknown> => {
		let failure: unknown;
		for (const operation of [() => receiverHost.stop(), () => mcpHost.stop(), () => engine.close()]) {
			try {
				await operation();
			} catch (error) {
				failure ??= error;
			}
		}
		return failure;
	};

	try {
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
		await writeRuntimeState(dataDirectory, runtimeState());
		statePublishingEnabled = true;
	} catch (error) {
		statePublishingEnabled = false;
		offEngine.dispose();
		offReceiver();
		offMcp();
		offSettings();
		eventListeners.clear();
		await stateWriteQueue;
		await stopResources();
		await removeRuntimeState(dataDirectory, owner.instanceId);
		throw error;
	}

	return {
		kind: 'otelux/datasource',
		dataDirectory,
		mcpTokenFile,
		migration,
		listTraces: (query) => engine.listTraces(query),
		getTrace: (query) => engine.getTrace(query),
		getSpanDetails: (query) => engine.getSpanDetails(query),
		listLogs: (query) => engine.listLogs(query),
		listMetrics: (query) => engine.listMetrics(query),
		listResourceFacets: (query) => engine.listResourceFacets(query),
		subscribe: (handler) => engine.subscribe(handler),
		getSettings: () => settings.get(),
		getReceiverStatus: () => receiverHost.status,
		getMcpStatus: () => mcpHost.status,
		getStoragePath: () => ({ activePath: activeDbPath, defaultPath: defaultDbPath }),
		getStorageUsage: () => storage.getStorageUsage(),
		getRuntimeState: runtimeState,
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
			statePublishingEnabled = false;
			offEngine.dispose();
			offReceiver();
			offMcp();
			offSettings();
			eventListeners.clear();
			await stateWriteQueue;
			const failure = await stopResources();
			try {
				await removeRuntimeState(dataDirectory, owner.instanceId);
			} finally {
				await releaseOwnership();
			}
			if (failure) {
				throw failure;
			}
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
