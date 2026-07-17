import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type RuntimeEvent } from '@otelux/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LocalRuntime, createLocalRuntime } from './runtime.js';

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
			logger: silentLogger,
		});
		const status = runtime.getReceiverStatus();
		expect(status.kind).toBe('running');
		if (status.kind === 'running') {
			expect(status.port).toBeGreaterThan(0);
			const response = await fetch(`http://${status.host}:${status.port}/healthz`);
			expect(response.ok).toBe(true);
		}
		expect(runtime.getMcpStatus()).toEqual({ kind: 'disabled' });

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
	});
});
