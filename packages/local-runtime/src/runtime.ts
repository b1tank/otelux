import { join, resolve } from 'node:path';
import { createEngine } from '@otelux/engine';
import type {
	DataSource,
	Disposable,
	LoadSampleDataResult,
	McpStatus,
	PartialSettings,
	ReceiverStatus,
	RuntimeApiStatus,
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
import { loadOrCreateMcpToken, loadOrCreateToken } from './mcpToken.js';
import { type LegacyMigrationResult, prepareDataDirectory } from './migration.js';
import { ReceiverHost } from './receiverHost.js';
import { RuntimeApiHost } from './runtimeApiHost.js';
import { createRuntimeEventProjector } from './runtimeEvents.js';
import { createRuntimeRpcDispatcher } from './runtimeRpc.js';
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
import { type WorkerSqliteStorage, createWorkerSqliteStorage } from './workerStorage.js';

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
	/** One-shot Runtime API bind override. `0` asks the OS for a free port. */
	readonly apiPortOverride?: number;
	readonly apiMaxBodyBytes?: number;
	readonly logger?: RuntimeLogger;
}

export interface LocalRuntime extends DataSource {
	readonly dataDirectory: string;
	readonly mcpTokenFile: string;
	readonly runtimeTokenFile: string;
	readonly migration: LegacyMigrationResult;
	getSettings(): Settings;
	getReceiverStatus(): ReceiverStatus;
	getMcpStatus(): McpStatus;
	getApiStatus(): RuntimeApiStatus;
	getStoragePath(): StoragePathInfo;
	getStorageUsage(): Promise<StorageUsageInfo>;
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
	const runtimeTokenFile = join(dataDirectory, 'runtime-token');
	const startedAt = new Date().toISOString();
	const eventListeners = new Set<(event: RuntimeEvent) => void>();
	const projectedEvents = createRuntimeEventProjector();
	let statePublishingEnabled = false;
	let stateWriteQueue = Promise.resolve();
	let mutationQueue = Promise.resolve();
	let closed = false;

	const settings = await SettingsStore.open(settingsFile);
	const mcpToken = await loadOrCreateMcpToken(mcpTokenFile);
	const runtimeToken = await loadOrCreateToken(runtimeTokenFile);
	const configuredDbPath = settings.get().storage.dbPath;
	const opened = await openStorage(
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
	let apiHost: RuntimeApiHost;
	let offApi = (): void => {};

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
		runtimeTokenFile,
		receiver: receiverHost.status,
		mcp: mcpHost.status,
		api: apiHost.status,
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
		projectedEvents.accept(event);
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
		void storage
			.applyRetention(next.retention)
			.catch((error) =>
				logger.error(
					`[otelux] retention update failed: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
		emit({ kind: 'settings-changed', settings: next });
		scheduleStateWrite();
	});

	const loadSampleData = async (): Promise<LoadSampleDataResult> => {
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
	};

	const serializeMutation = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = mutationQueue.then(operation, operation);
		mutationQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};

	const runtime: LocalRuntime = {
		kind: 'otelux/datasource',
		dataDirectory,
		mcpTokenFile,
		runtimeTokenFile,
		migration,
		listTraces: (query) => engine.listTraces(query),
		getTrace: (query) => engine.getTrace(query),
		getTraceWaterfall: (query) => engine.getTraceWaterfall(query),
		getSpanDetails: (query) => engine.getSpanDetails(query),
		listLogs: (query) => engine.listLogs(query),
		getLogDetails: (query) => engine.getLogDetails(query),
		listMetrics: (query) => engine.listMetrics(query),
		listResourceFacets: (query) => engine.listResourceFacets(query),
		subscribe: (handler) => engine.subscribe(handler),
		getSettings: () => settings.get(),
		getReceiverStatus: () => receiverHost.status,
		getMcpStatus: () => mcpHost.status,
		getApiStatus: () => apiHost.status,
		getStoragePath: () => ({ activePath: activeDbPath, defaultPath: defaultDbPath }),
		getStorageUsage: () => storage.getStorageUsage(),
		getRuntimeState: runtimeState,
		updateSettings: (patch) =>
			serializeMutation(() => updateSettings(settings, receiverHost, mcpHost, patch)),
		loadSampleData,
		clearData: () => serializeMutation(() => engine.clear()),
		onEvent(listener): Disposable {
			eventListeners.add(listener);
			return { dispose: () => eventListeners.delete(listener) };
		},
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			statePublishingEnabled = false;
			offEngine.dispose();
			offReceiver();
			offMcp();
			offApi();
			offSettings();
			projectedEvents.close();
			eventListeners.clear();
			await mutationQueue;
			await stateWriteQueue;
			const failure = await stopResources();
			try {
				await removeRuntimeState(dataDirectory, owner.instanceId);
			} finally {
				await releaseOwnership();
			}
			if (failure) throw failure;
		},
	};
	apiHost = new RuntimeApiHost({
		dispatcher: createRuntimeRpcDispatcher(runtime),
		events: projectedEvents,
		token: runtimeToken,
		host,
		...(options.apiMaxBodyBytes !== undefined ? { maxBodyBytes: options.apiMaxBodyBytes } : {}),
	});
	offApi = apiHost.onChange((status) => {
		emit({ kind: 'api-status-changed', status });
		scheduleStateWrite();
	});

	const stopResources = async (): Promise<unknown> => {
		let failure: unknown;
		for (const operation of [
			() => apiHost.stop(),
			() => receiverHost.stop(),
			() => mcpHost.stop(),
			() => engine.close(),
		]) {
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

		const apiStatus = await apiHost.start(options.apiPortOverride ?? 4321);
		if (apiStatus.kind === 'running') {
			logger.info(
				`[otelux] Runtime API listening on http://${apiStatus.host}:${apiStatus.port}/api/v1/rpc`,
			);
			logger.info(`[otelux] Runtime API token is stored at ${runtimeTokenFile}`);
		} else if (apiStatus.kind === 'error') {
			logger.error(
				`[otelux] Runtime API failed to bind on ${apiStatus.host}:${apiStatus.port}: ${apiStatus.message}`,
			);
		}
		await writeRuntimeState(dataDirectory, runtimeState());
		statePublishingEnabled = true;
	} catch (error) {
		statePublishingEnabled = false;
		offEngine.dispose();
		offReceiver();
		offMcp();
		offApi();
		offSettings();
		projectedEvents.close();
		eventListeners.clear();
		await stateWriteQueue;
		await stopResources();
		await removeRuntimeState(dataDirectory, owner.instanceId);
		throw error;
	}

	return runtime;
}

async function openStorage(
	preferredPath: string,
	defaultPath: string,
	retention: Settings['retention'],
	logger: RuntimeLogger,
): Promise<{ storage: WorkerSqliteStorage; activeDbPath: string }> {
	try {
		return {
			storage: await createWorkerSqliteStorage({ path: preferredPath, retention }),
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
			storage: await createWorkerSqliteStorage({ path: defaultPath, retention }),
			activeDbPath: defaultPath,
		};
	}
}
