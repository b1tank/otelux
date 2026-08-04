import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type RuntimeEvent } from '@otelux/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LocalRuntime, RuntimeAlreadyRunningError, createLocalRuntime } from './runtime.js';
import { RUNTIME_LOCK_FILE, RUNTIME_STATE_FILE, readRuntimeState } from './runtimeState.js';

const silentLogger = {
	info: (): void => {},
	error: (): void => {},
};

describe('createLocalRuntime', () => {
	let directory: string;
	let runtime: LocalRuntime | undefined;

	beforeEach(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'otelux-runtime-'));
		await fs.writeFile(
			join(directory, 'settings.json'),
			`${JSON.stringify({ ...DEFAULT_SETTINGS, mcp: { enabled: false, port: 4320 } })}\n`,
			'utf8',
		);
	});

	afterEach(async () => {
		await runtime?.close();
		await fs.rm(directory, { recursive: true, force: true });
	});

	it('owns ingest, queries, sample data, events, and clear operations', async () => {
		runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			apiPortOverride: 0,
			logger: silentLogger,
		});
		const status = runtime.getReceiverStatus();
		expect(status.kind).toBe('running');
		if (status.kind === 'running') {
			expect(status.port).toBeGreaterThan(0);
			const response = await fetch(`http://${status.host}:${status.port}/healthz`);
			expect(response.ok).toBe(true);
			expect(await readRuntimeState(directory)).toMatchObject({
				pid: process.pid,
				dataDirectory: directory,
				receiver: { kind: 'running', host: status.host, port: status.port },
				mcp: { kind: 'disabled' },
				api: { kind: 'running' },
				runtimeTokenFile: join(directory, 'runtime-token'),
			});
		}
		expect(runtime.getMcpStatus()).toEqual({ kind: 'disabled' });
		const api = runtime.getApiStatus();
		expect(api.kind).toBe('running');
		if (api.kind === 'running') {
			const token = (await fs.readFile(runtime.runtimeTokenFile, 'utf8')).trim();
			const tokenMode = (await fs.stat(runtime.runtimeTokenFile)).mode & 0o777;
			if (process.platform !== 'win32') expect(tokenMode).toBe(0o600);
			const rpc = await fetch(`http://${api.host}:${api.port}/api/v1/rpc`, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'runtime/getStatus' }),
			});
			expect(await rpc.json()).toMatchObject({ result: { api: { kind: 'running', port: api.port } } });
		}

		const events: RuntimeEvent[] = [];
		const subscription = runtime.onEvent((event) => events.push(event));
		expect(await runtime.loadSampleData()).toEqual({ traces: 2, logs: 5, metrics: 3 });
		expect((await runtime.listTraces({})).totalCount).toBe(2);
		expect((await runtime.listLogs({})).totalCount).toBe(5);
		expect((await runtime.listMetrics({})).totalCount).toBe(3);
		expect(events.map((event) => event.kind)).toEqual([
			'tracesChanged',
			'logsChanged',
			'metricsChanged',
		]);

		await runtime.clearData();
		expect((await runtime.listTraces({})).totalCount).toBe(0);
		expect((await runtime.listLogs({})).totalCount).toBe(0);
		expect((await runtime.listMetrics({})).totalCount).toBe(0);
		subscription.dispose();
	});

	it('rejects a second owner and removes its state and lock when closed', async () => {
		runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			logger: silentLogger,
		});

		await expect(
			createLocalRuntime({
				dataDirectory: directory,
				otlpPortOverride: 0,
				logger: silentLogger,
			}),
		).rejects.toMatchObject({
			name: RuntimeAlreadyRunningError.name,
			state: { instanceId: runtime.getRuntimeState().instanceId },
		});

		await runtime.close();
		runtime = undefined;
		await expect(fs.access(join(directory, RUNTIME_STATE_FILE))).rejects.toThrow();
		await expect(fs.access(join(directory, RUNTIME_LOCK_FILE))).rejects.toThrow();
	});

	it('reopens the same durable database', async () => {
		runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			logger: silentLogger,
		});
		await runtime.loadSampleData();
		await runtime.close();
		runtime = undefined;

		runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			logger: silentLogger,
		});
		expect((await runtime.listTraces({})).totalCount).toBe(2);
		expect(runtime.getStoragePath()).toEqual({
			activePath: join(directory, 'otelux.db'),
			defaultPath: join(directory, 'otelux.db'),
		});
		const usage = await runtime.getStorageUsage();
		expect(usage.activePath).toBe(join(directory, 'otelux.db'));
		expect(usage.retentionBytes).toBeGreaterThan(0);
		expect(usage.totalBytes).toBe(usage.databaseFileBytes + usage.walBytes + usage.sharedMemoryBytes);
	});

	it('copies a legacy runtime database into the canonical data directory', async () => {
		const legacyDirectory = join(directory, 'legacy');
		await fs.mkdir(legacyDirectory);
		await fs.writeFile(
			join(legacyDirectory, 'settings.json'),
			`${JSON.stringify({ ...DEFAULT_SETTINGS, mcp: { enabled: false, port: 4320 } })}\n`,
			'utf8',
		);
		let legacyRuntime: LocalRuntime | undefined;
		try {
			legacyRuntime = await createLocalRuntime({
				dataDirectory: legacyDirectory,
				otlpPortOverride: 0,
				logger: silentLogger,
			});
			await legacyRuntime.loadSampleData();
		} finally {
			await legacyRuntime?.close();
		}

		runtime = await createLocalRuntime({
			dataDirectory: directory,
			legacyDataDirectories: [legacyDirectory],
			otlpPortOverride: 0,
			logger: silentLogger,
		});

		expect(runtime.migration).toMatchObject({
			kind: 'migrated',
			sourceDirectory: legacyDirectory,
		});
		expect((await runtime.listTraces({})).totalCount).toBe(2);
		expect(await fs.readFile(join(legacyDirectory, 'otelux.db'))).not.toHaveLength(0);
	});
});
