import { request as httpRequest } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeApiHost } from './runtimeApiHost.js';
import { createRuntimeEventProjector } from './runtimeEvents.js';

function host(
	options: { maxBodyBytes?: number; maxResponseBytes?: number; maxSseClients?: number } = {},
) {
	const events = createRuntimeEventProjector();
	const dispatcher = {
		handle: vi.fn(async (input: unknown) => {
			const request = input as { id?: string | number | null; method?: string };
			return request.id === undefined
				? undefined
				: {
						jsonrpc: '2.0' as const,
						id: request.id ?? null,
						result:
							request.method === 'huge' ? { payload: 'x'.repeat(2_000) } : { method: request.method },
					};
		}),
	};
	const api = new RuntimeApiHost({
		dispatcher,
		events,
		token: 'test-token',
		...options,
	});
	return { api, events, dispatcher };
}

async function started(
	options: { maxBodyBytes?: number; maxResponseBytes?: number; maxSseClients?: number } = {},
) {
	const value = host(options);
	const status = await value.api.start(0);
	if (status.kind !== 'running') throw new Error(`API failed to start: ${status.kind}`);
	return { ...value, status, base: `http://${status.host}:${status.port}` };
}

const authorization = { authorization: 'Bearer test-token' };

async function statusWithHost(url: string, host: string): Promise<number> {
	return await new Promise((resolve, reject) => {
		const request = httpRequest(url, { headers: { host } }, (response) => {
			response.resume();
			response.once('end', () => resolve(response.statusCode ?? 0));
		});
		request.once('error', reject);
		request.end();
	});
}

describe('Runtime API host', () => {
	it('serves open health and authenticated JSON-RPC', async () => {
		const value = await started();
		try {
			const health = await fetch(`${value.base}/healthz`);
			expect(health.status).toBe(200);
			expect(await health.json()).toEqual({ service: 'otelux-runtime', status: 'ok' });
			const response = await fetch(`${value.base}/api/v1/rpc`, {
				method: 'POST',
				headers: { ...authorization, 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'runtime/getStatus' }),
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				jsonrpc: '2.0',
				id: 7,
				result: { method: 'runtime/getStatus' },
			});
			const batch = await fetch(`${value.base}/api/v1/rpc`, {
				method: 'POST',
				headers: { ...authorization, 'content-type': 'application/json' },
				body: JSON.stringify([
					{ jsonrpc: '2.0', id: 8, method: 'runtime/getStatus' },
					{ jsonrpc: '2.0', method: 'runtime/getStatus' },
				]),
			});
			expect(await batch.json()).toEqual([
				{ jsonrpc: '2.0', id: 8, result: { method: 'runtime/getStatus' } },
			]);
		} finally {
			await value.api.stop();
		}
	});

	it('enforces auth, content type, origin, method, host, and body limits', async () => {
		const value = await started({ maxBodyBytes: 64 });
		try {
			expect((await fetch(`${value.base}/api/v1/rpc`, { method: 'POST' })).status).toBe(401);
			expect(
				(
					await fetch(`${value.base}/api/v1/rpc`, {
						method: 'POST',
						headers: authorization,
					})
				).status,
			).toBe(415);
			expect(
				(
					await fetch(`${value.base}/api/v1/rpc`, {
						method: 'POST',
						headers: {
							...authorization,
							'content-type': 'application/json',
							origin: 'https://evil.test',
						},
						body: '{}',
					})
				).status,
			).toBe(403);
			expect((await fetch(`${value.base}/api/v1/rpc`, { headers: authorization })).status).toBe(405);
			expect(
				(
					await fetch(`${value.base}/api/v1/rpc`, {
						method: 'POST',
						headers: { ...authorization, 'content-type': 'application/json' },
						body: JSON.stringify({ payload: 'x'.repeat(100) }),
					})
				).status,
			).toBe(413);
			expect(await statusWithHost(`${value.base}/healthz`, 'evil.test')).toBe(400);
		} finally {
			await value.api.stop();
		}
	});

	it('maps malformed JSON to JSON-RPC parse error and notifications to 204', async () => {
		const value = await started();
		try {
			const malformed = await fetch(`${value.base}/api/v1/rpc`, {
				method: 'POST',
				headers: { ...authorization, 'content-type': 'application/json' },
				body: '{',
			});
			expect(await malformed.json()).toMatchObject({ error: { code: -32700 } });
			const notification = await fetch(`${value.base}/api/v1/rpc`, {
				method: 'POST',
				headers: { ...authorization, 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', method: 'runtime/getStatus' }),
			});
			expect(notification.status).toBe(204);
		} finally {
			await value.api.stop();
		}
	});

	it('bounds batch width and encoded response size', async () => {
		const value = await started({ maxResponseBytes: 1_024 });
		try {
			const call = async (body: unknown) =>
				await fetch(`${value.base}/api/v1/rpc`, {
					method: 'POST',
					headers: { ...authorization, 'content-type': 'application/json' },
					body: JSON.stringify(body),
				});
			const oversized = await call({ jsonrpc: '2.0', id: 1, method: 'huge' });
			expect(await oversized.json()).toMatchObject({ error: { code: -32005 } });
			const wide = await call(
				Array.from({ length: 11 }, (_, index) => ({
					jsonrpc: '2.0',
					id: index,
					method: 'runtime/getStatus',
				})),
			);
			expect(await wide.json()).toMatchObject({ error: { code: -32600 } });
		} finally {
			await value.api.stop();
		}
	});

	it('streams revisioned SSE events and enforces client bounds', async () => {
		const value = await started({ maxSseClients: 1 });
		const controller = new AbortController();
		try {
			const first = await fetch(`${value.base}/api/v1/events`, {
				headers: authorization,
				signal: controller.signal,
			});
			expect(first.status).toBe(200);
			expect(first.headers.get('content-type')).toContain('text/event-stream');
			const second = await fetch(`${value.base}/api/v1/events`, { headers: authorization });
			expect(second.status).toBe(503);
			value.events.accept({ kind: 'logsChanged', count: 1 });
			await new Promise<void>((resolve) => queueMicrotask(resolve));
			const reader = first.body?.getReader();
			const decoder = new TextDecoder();
			let text = '';
			for (let index = 0; index < 3 && !text.includes('telemetry.changed'); index++) {
				const chunk = await reader?.read();
				if (chunk?.value) text += decoder.decode(chunk.value);
			}
			expect(text).toContain('event: telemetry.changed');
			expect(text).toContain('"signals":["logs"]');
			await reader?.cancel();
		} finally {
			controller.abort();
			await value.api.stop();
		}
	});
});
