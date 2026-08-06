import { describe, expect, it, vi } from 'vitest';
import { createHttpDataSource } from './index.js';

const rpcResponse = (id: string, result: unknown): Response =>
	new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});

describe('HTTP adapter boundary safety', () => {
	it.each([
		'https://example.com',
		'http://192.168.1.2:4321',
		'http://user:pass@127.0.0.1:4321',
		'http://127.0.0.1:4321/path',
		'http://127.0.0.1:4321/#token',
	])('rejects non-loopback or decorated base URL %s', (baseUrl) => {
		expect(() => createHttpDataSource({ baseUrl, token: 'secret' })).toThrow(
			'Runtime baseUrl must be an uncredentialed loopback origin',
		);
	});

	it('aborts a hung RPC at its deadline', async () => {
		const fetch = vi.fn(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError')),
					);
				}),
		);
		const client = createHttpDataSource({
			baseUrl: 'http://127.0.0.1:4321',
			token: 'secret',
			fetch,
			rpcTimeoutMs: 10,
		});
		await expect(client.getStatus()).rejects.toMatchObject({ name: 'AbortError' });
		client.close();
	});

	it('rejects a declared oversized response before reading it', async () => {
		const fetch = vi.fn(
			async () => new Response('x', { status: 200, headers: { 'content-length': '1000' } }),
		);
		const client = createHttpDataSource({
			baseUrl: 'http://localhost:4321',
			token: 'secret',
			fetch,
			maxResponseBytes: 100,
		});
		await expect(client.initialize()).rejects.toThrow('Runtime response exceeds 100 bytes');
		client.close();
	});

	it('rejects malformed method-specific results', async () => {
		const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const request = JSON.parse(String(init?.body)) as { id: string; method: string };
			if (request.method === 'runtime/initialize') {
				return rpcResponse(request.id, {
					protocolVersion: '2.0.0',
					runtime: { name: 'otelux-runtime', version: 'test' },
					capabilities: {
						queries: true,
						settings: true,
						sampleData: true,
						clearData: true,
						events: true,
					},
					limits: { traces: 200, logs: 500, metrics: 500, metricPoints: 1_000 },
				});
			}
			return rpcResponse(request.id, { rows: [], totalCount: -1 });
		});
		const client = createHttpDataSource({
			baseUrl: 'http://127.0.0.1:4321',
			token: 'secret',
			fetch,
		});
		await expect(client.listTraces({})).rejects.toThrow('$.result.totalCount: must be between 0');
		client.close();
	});

	it('does not permanently cache a failed initialization', async () => {
		let call = 0;
		const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			call++;
			if (call === 1) return new Response('failed', { status: 503 });
			const request = JSON.parse(String(init?.body)) as { id: string; method: string };
			if (request.method === 'runtime/initialize') {
				return rpcResponse(request.id, {
					protocolVersion: '2.0.0',
					runtime: { name: 'otelux-runtime', version: 'test' },
					capabilities: {
						queries: true,
						settings: true,
						sampleData: true,
						clearData: true,
						events: true,
					},
					limits: { traces: 200, logs: 500, metrics: 500, metricPoints: 1_000 },
				});
			}
			return rpcResponse(request.id, {
				runtimeVersion: 'test',
				protocolVersion: '2.0.0',
				instanceId: 'test-instance',
				pid: 123,
				startedAt: '2026-08-06T00:00:00.000Z',
				dataDirectory: '/tmp/otelux-test',
				databasePath: '/tmp/otelux-test/otelux.db',
				receiver: { kind: 'starting' },
				mcp: { kind: 'disabled' },
			});
		});
		const client = createHttpDataSource({
			baseUrl: 'http://127.0.0.1:4321',
			token: 'secret',
			fetch,
		});
		await expect(client.getStatus()).rejects.toThrow('Runtime HTTP 503');
		await expect(client.getStatus()).resolves.toMatchObject({ runtimeVersion: 'test' });
		expect(fetch).toHaveBeenCalledTimes(3);
		client.close();
	});
});
