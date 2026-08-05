import { StaleReferenceError } from '@otelux/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { LocalRuntime } from './runtime.js';
import { createRuntimeRpcDispatcher } from './runtimeRpc.js';

const traceId = '0123456789abcdef0123456789abcdef';

function runtime(): LocalRuntime {
	return {
		getRuntimeState: () => ({
			version: 1,
			runtimeVersion: '0.2.0-beta.1',
			protocolVersion: '0.6.0',
			instanceId: 'instance',
			pid: 123,
			startedAt: '2026-08-04T00:00:00.000Z',
			dataDirectory: '/data/otelux',
			databasePath: '/data/otelux/otelux.db',
			mcpTokenFile: '/data/otelux/mcp-token',
			runtimeTokenFile: '/data/otelux/runtime-token',
			receiver: { kind: 'running', host: '127.0.0.1', port: 4319 },
			mcp: { kind: 'running', host: '127.0.0.1', port: 4320 },
			api: { kind: 'running', host: '127.0.0.1', port: 4321 },
		}),
		getSettings: vi.fn(() => ({
			version: 1,
			otlp: { port: 4319 },
			mcp: { enabled: true, port: 4320 },
			retention: { maxAgeHours: 72, maxSizeMb: 512 },
			storage: { dbPath: '' },
		})),
		listTraces: vi.fn(async () => ({ rows: [], totalCount: 0 })),
		getTrace: vi.fn(async () => ({ traceId, spans: [] })),
		getTraceWaterfall: vi.fn(async () => ({ traceId, spans: [] })),
		getSpanDetails: vi.fn(),
		listLogs: vi.fn(async () => ({ rows: [], totalCount: 0 })),
		getLogDetails: vi.fn(async () => ({
			timeUnixNano: 1n,
			severityNumber: 9,
			attributes: {},
			resource: { attributes: {} },
			scope: { name: 'test' },
		})),
		listMetricInstruments: vi.fn(async () => ({ rows: [], totalCount: 0 })),
		getMetricPoints: vi.fn(),
		listResourceFacets: vi.fn(async () => ({ rows: [] })),
		updateSettings: vi.fn(),
		loadSampleData: vi.fn(async () => ({ traces: 1, logs: 1, metrics: 1 })),
		clearData: vi.fn(async () => {}),
	} as unknown as LocalRuntime;
}

const request = (method: string, params?: unknown, id: number | string = 1) => ({
	jsonrpc: '2.0',
	id,
	method,
	...(params !== undefined ? { params } : {}),
});

describe('Runtime RPC dispatcher', () => {
	it('negotiates and exposes capabilities and limits', async () => {
		const dispatcher = createRuntimeRpcDispatcher(runtime());
		const response = await dispatcher.handle(
			request('runtime/initialize', {
				protocolVersion: '2.7.0',
				client: { name: 'test', version: '1.0.0' },
			}),
		);
		expect(response).toMatchObject({
			result: {
				protocolVersion: '2.0.0',
				runtime: { name: 'otelux-runtime', version: '0.2.0-beta.1' },
				capabilities: { events: true },
				limits: { traces: 200, logs: 500 },
			},
		});
	});

	it('returns sanitized status without token paths', async () => {
		const response = await createRuntimeRpcDispatcher(runtime()).handle(request('runtime/getStatus'));
		expect(response).toMatchObject({
			result: { dataDirectory: '/data/otelux', api: { port: 4321 } },
		});
		expect(JSON.stringify(response)).not.toContain('token');
	});

	it('dispatches bounded telemetry queries', async () => {
		const local = runtime();
		const response = await createRuntimeRpcDispatcher(local).handle(
			request('telemetry/listTraces', { limit: 10 }),
		);
		expect(response).toMatchObject({ result: { rows: [], totalCount: 0 } });
		expect(local.listTraces).toHaveBeenCalledWith({ limit: 10 });
	});

	it('maps validation, method, protocol, and internal errors', async () => {
		const local = runtime();
		vi.mocked(local.listTraces).mockRejectedValueOnce(new Error('SQL secret'));
		const dispatcher = createRuntimeRpcDispatcher(local);
		expect(await dispatcher.handle(request('telemetry/listTraces', { limit: 999 }))).toMatchObject({
			error: { code: -32602, message: 'Invalid params', data: { path: '$.params.limit' } },
		});
		expect(await dispatcher.handle(request('runtime/nope'))).toMatchObject({
			error: { code: -32601, message: 'Method not found' },
		});
		expect(
			await dispatcher.handle(
				request('runtime/initialize', {
					protocolVersion: '1.0.0',
					client: { name: 'test', version: '1' },
				}),
			),
		).toMatchObject({ error: { code: -32001, data: { supportedVersions: ['2.0.0'] } } });
		vi.mocked(local.getMetricPoints).mockRejectedValueOnce(new StaleReferenceError('metric'));
		expect(
			await dispatcher.handle(request('telemetry/getMetricPoints', { instrumentId: '1', limit: 10 })),
		).toMatchObject({
			error: {
				code: -32006,
				message: 'Stale reference',
				data: { referenceKind: 'metric' },
			},
		});
		const internal = await dispatcher.handle(request('telemetry/listTraces', {}));
		expect(internal).toMatchObject({ error: { code: -32603, message: 'Internal error' } });
		expect(JSON.stringify(internal)).not.toContain('SQL secret');
	});

	it('executes valid clear only with confirmation and suppresses notification replies', async () => {
		const local = runtime();
		const dispatcher = createRuntimeRpcDispatcher(local);
		expect(
			await dispatcher.handle(request('runtime/clearData', { confirmation: 'clear' })),
		).toMatchObject({ result: null });
		expect(local.clearData).toHaveBeenCalledOnce();
		expect(await dispatcher.handle({ jsonrpc: '2.0', method: 'runtime/getStatus' })).toBeUndefined();
	});
});
