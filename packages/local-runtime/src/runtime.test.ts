import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type RuntimeEvent } from '@otelux/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LocalRuntime, RuntimeAlreadyRunningError, createLocalRuntime } from './runtime.js';
import {
	RUNTIME_LOCK_FILE,
	RUNTIME_STATE_FILE,
	claimRuntimeOwnership,
	readRuntimeState,
} from './runtimeState.js';

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
		expect((await runtime.listMetricInstruments({})).totalCount).toBe(3);
		expect(events.map((event) => event.kind)).toEqual([
			'tracesChanged',
			'logsChanged',
			'metricsChanged',
		]);

		await runtime.clearData();
		expect((await runtime.listTraces({})).totalCount).toBe(0);
		expect((await runtime.listLogs({})).totalCount).toBe(0);
		expect((await runtime.listMetricInstruments({})).totalCount).toBe(0);
		subscription.dispose();
	});

	it('publishes a nonfatal receiver port conflict while control stays available', async () => {
		const blocker = createServer();
		await new Promise<void>((resolve, reject) => {
			blocker.once('error', reject);
			blocker.listen(0, '127.0.0.1', resolve);
		});
		const address = blocker.address();
		if (!address || typeof address === 'string') throw new Error('port missing');
		try {
			runtime = await createLocalRuntime({
				dataDirectory: directory,
				otlpPortOverride: address.port,
				apiPortOverride: 0,
				logger: silentLogger,
			});
			expect(runtime.getReceiverStatus()).toMatchObject({
				kind: 'error',
				port: address.port,
			});
			expect(runtime.getApiStatus().kind).toBe('running');
			expect(await readRuntimeState(directory)).toMatchObject({
				receiver: { kind: 'error', port: address.port },
				api: { kind: 'running' },
			});
		} finally {
			await new Promise<void>((resolve, reject) =>
				blocker.close((error) => (error ? reject(error) : resolve())),
			);
		}
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

	it('serializes concurrent control mutations and rejects the stale revision', async () => {
		runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			apiPortOverride: 0,
			logger: silentLogger,
		});
		const changes: number[] = [];
		const subscription = runtime.onEvent((event) => {
			if (event.kind === 'settings-changed') changes.push(event.settings.retention.maxAgeHours);
		});
		const receiver = runtime.getReceiverStatus();
		if (receiver.kind !== 'running') throw new Error('receiver missing');
		const revision = runtime.getSettings().revision;
		const [first, second] = await Promise.all([
			runtime.updateSettings(
				{ otlp: { port: receiver.port }, retention: { maxAgeHours: 1 } },
				revision,
			),
			runtime.updateSettings(
				{ otlp: { port: receiver.port }, retention: { maxAgeHours: 2 } },
				revision,
			),
		]);
		if (!first.ok) throw new Error(first.error);
		expect(second).toMatchObject({ ok: false, conflict: true });
		expect(runtime.getSettings()).toMatchObject({
			revision: revision + 1,
			retention: { maxAgeHours: 1 },
		});
		expect(changes).toEqual([1]);
		const persisted = JSON.parse(await fs.readFile(join(directory, 'settings.json'), 'utf8')) as {
			revision: number;
		};
		expect(persisted.revision).toBe(revision + 1);
		if (process.platform !== 'win32') {
			expect((await fs.stat(join(directory, 'settings.json'))).mode & 0o777).toBe(0o600);
		}
		subscription.dispose();
	});

	it('loads legacy revisionless settings at revision zero', async () => {
		await fs.writeFile(
			join(directory, 'settings.json'),
			`${JSON.stringify({
				version: 1,
				otlp: { port: 4319 },
				mcp: { enabled: false, port: 4320 },
				retention: { maxAgeHours: 72, maxSizeMb: 512 },
				storage: { dbPath: '' },
			})}\n`,
		);
		runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			apiPortOverride: 0,
			logger: silentLogger,
		});
		expect(runtime.getSettings().revision).toBe(0);
		const receiver = runtime.getReceiverStatus();
		if (receiver.kind !== 'running') throw new Error('receiver missing');
		const result = await runtime.updateSettings({ otlp: { port: receiver.port } }, 0);
		expect(result).toMatchObject({ ok: true, settings: { revision: 1 } });
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

	it('does not migrate legacy files when another process owns startup', async () => {
		const target = join(directory, 'contended');
		const legacy = join(directory, 'legacy-contended');
		await fs.mkdir(legacy);
		await fs.writeFile(join(legacy, 'otelux.db'), 'legacy-data');
		const ownership = await claimRuntimeOwnership({ dataDirectory: target });
		expect(ownership.role).toBe('owner');
		if (ownership.role !== 'owner') return;
		try {
			await expect(
				createLocalRuntime({
					dataDirectory: target,
					legacyDataDirectories: [legacy],
					otlpPortOverride: 0,
					logger: silentLogger,
				}),
			).rejects.toBeInstanceOf(RuntimeAlreadyRunningError);
			await expect(fs.access(join(target, 'otelux.db'))).rejects.toThrow();
			await expect(fs.access(join(target, '.legacy-migration.json'))).rejects.toThrow();
		} finally {
			await ownership.release();
		}
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
