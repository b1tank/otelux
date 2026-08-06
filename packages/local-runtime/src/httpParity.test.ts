import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeRpcError, createHttpDataSource } from '@otelux/adapter-http';
import { type ChangeEvent, DEFAULT_SETTINGS } from '@otelux/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LocalRuntime, createLocalRuntime } from './runtime.js';

const silentLogger = { info: (): void => {}, error: (): void => {} };

describe('direct and HTTP DataSource parity', () => {
	let directory: string;
	let runtime: LocalRuntime | undefined;

	beforeEach(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'otelux-http-parity-'));
		await fs.writeFile(
			join(directory, 'settings.json'),
			`${JSON.stringify({ ...DEFAULT_SETTINGS, mcp: { enabled: false, port: 4320 } })}\n`,
		);
		runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			apiPortOverride: 0,
			logger: silentLogger,
		});
	});

	afterEach(async () => {
		await runtime?.close();
		await fs.rm(directory, { recursive: true, force: true });
	});

	function client(token?: string) {
		if (!runtime) throw new Error('runtime missing');
		const api = runtime.getApiStatus();
		if (api.kind !== 'running') throw new Error(`API not running: ${api.kind}`);
		return createHttpDataSource({
			baseUrl: `http://${api.host}:${api.port}`,
			token: token ?? '',
			clientName: 'parity-test',
			clientVersion: '1.0.0',
			reconnectDelayMs: 10,
			maximumReconnectDelayMs: 20,
		});
	}

	async function authenticatedClient() {
		if (!runtime) throw new Error('runtime missing');
		return client((await fs.readFile(runtime.runtimeTokenFile, 'utf8')).trim());
	}

	it('matches every current query and preserves bigint values', async () => {
		if (!runtime) throw new Error('runtime missing');
		await runtime.loadSampleData();
		const http = await authenticatedClient();
		try {
			expect(await http.initialize()).toMatchObject({ protocolVersion: '2.0.0' });
			expect(await http.getStatus()).toMatchObject({
				databasePath: runtime.getStoragePath().activePath,
			});
			expect(await http.getSettings()).toEqual(runtime.getSettings());
			expect(await http.getStoragePath()).toEqual(runtime.getStoragePath());
			expect(await http.getStorageUsage()).toEqual(await runtime.getStorageUsage());

			const directTraces = await runtime.listTraces({ limit: 10 });
			const httpTraces = await http.listTraces({ limit: 10 });
			expect(httpTraces).toEqual(directTraces);
			expect(typeof httpTraces.rows[0]?.startTimeUnixNano).toBe('bigint');
			const traceId = directTraces.rows[0]?.traceId;
			if (!traceId) throw new Error('sample trace missing');
			expect(await http.getTrace({ traceId })).toEqual(await runtime.getTrace({ traceId }));
			if (!http.getTraceWaterfall) throw new Error('HTTP waterfall method missing');
			expect(await http.getTraceWaterfall({ traceId })).toEqual(
				await runtime.getTraceWaterfall?.({ traceId }),
			);
			const trace = await runtime.getTrace({ traceId });
			const spanId = trace.spans[0]?.spanId;
			if (!spanId) throw new Error('sample span missing');
			expect(await http.getSpanDetails({ traceId, spanId })).toEqual(
				await runtime.getSpanDetails({ traceId, spanId }),
			);
			const httpLogs = await http.listLogs({ limit: 50 });
			expect(httpLogs).toEqual(await runtime.listLogs({ limit: 50 }));
			const logId = httpLogs.rows[0]?.logId;
			if (!logId) throw new Error('sample log missing');
			expect(await http.getLogDetails({ logId })).toEqual(await runtime.getLogDetails({ logId }));
			const httpInstruments = await http.listMetricInstruments({ limit: 50 });
			expect(httpInstruments).toEqual(await runtime.listMetricInstruments({ limit: 50 }));
			expect(httpInstruments.rows.every((row) => !('dataPoints' in row))).toBe(true);
			expect(httpInstruments.rows.every((row) => !('resource' in row) && !('scope' in row))).toBe(
				true,
			);
			const instrumentId = httpInstruments.rows[0]?.instrumentId;
			if (!instrumentId) throw new Error('sample metric missing');
			const httpPoints = await http.getMetricPoints({ instrumentId, limit: 10 });
			expect(httpPoints).toEqual(await runtime.getMetricPoints({ instrumentId, limit: 10 }));
			expect(httpPoints.metric.dataPoints.length).toBeLessThanOrEqual(10);
			expect(await http.listResourceFacets({ signal: 'traces', facet: 'source' })).toEqual(
				await runtime.listResourceFacets({ signal: 'traces', facet: 'source' }),
			);
		} finally {
			http.close();
		}
	});

	it('projects SSE invalidations and disposes the shared connection', async () => {
		if (!runtime) throw new Error('runtime missing');
		const http = await authenticatedClient();
		const events: ChangeEvent[] = [];
		const received = new Promise<void>((resolve) => {
			const subscription = http.subscribe((event) => {
				events.push(event);
				if (events.some((value) => value.kind === 'metricsChanged')) {
					subscription.dispose();
					resolve();
				}
			});
		});
		await http.initialize();
		await new Promise((resolve) => setTimeout(resolve, 50));
		await runtime.loadSampleData();
		await Promise.race([
			received,
			new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 2_000)),
		]);
		expect(events.map((event) => event.kind)).toEqual([
			'tracesChanged',
			'logsChanged',
			'metricsChanged',
		]);
		http.close();
	});

	it('rejects bad authentication and supports confirmation-gated clear', async () => {
		if (!runtime) throw new Error('runtime missing');
		const unauthorized = client('wrong-token');
		await expect(unauthorized.getStatus()).rejects.toThrow('Runtime HTTP 401');
		unauthorized.close();

		await runtime.loadSampleData();
		const http = await authenticatedClient();
		await http.clearData();
		expect((await runtime.listTraces({})).totalCount).toBe(0);
		http.close();
	});

	it('enforces settings revisions over HTTP', async () => {
		if (!runtime) throw new Error('runtime missing');
		const http = await authenticatedClient();
		const current = await http.getSettings();
		expect(current.revision).toBe(0);
		const controlSignal = new Promise<readonly string[]>((resolve) => {
			const subscription = http.subscribeSignals((signals) => {
				if (signals.includes('settings')) {
					subscription.dispose();
					resolve(signals);
				}
			});
		});
		await new Promise((resolve) => setTimeout(resolve, 25));
		const receiver = runtime.getReceiverStatus();
		if (receiver.kind !== 'running') throw new Error('receiver missing');
		const updated = await http.updateSettings(
			{
				otlp: { port: receiver.port },
				retention: { maxAgeHours: current.retention.maxAgeHours - 1 },
			},
			current.revision,
		);
		expect(updated).toMatchObject({ ok: true, settings: { revision: 1 } });
		expect(await controlSignal).toContain('settings');
		await expect(
			http.updateSettings({ retention: { maxAgeHours: 12 } }, current.revision),
		).rejects.toMatchObject({
			name: RuntimeRpcError.name,
			code: -32004,
			data: { expectedRevision: 0, currentRevision: 1 },
		});
		http.close();
	});

	it('surfaces JSON-RPC errors without exposing server internals', async () => {
		const http = await authenticatedClient();
		await expect(http.listTraces({ limit: 999 })).rejects.toMatchObject({
			name: RuntimeRpcError.name,
			code: -32602,
		});
		http.close();
	});
});
