import { createEngine, createMemoryStorage } from '@otelux/engine';
import type { Span } from '@otelux/types';
import { SpanKind, SpanStatusCode } from '@otelux/types';
import { describe, expect, it } from 'vitest';
import { JSON_RPC_VERSION, MCP_PROTOCOL_VERSIONS } from './protocol.js';
import { createMcpServer } from './server.js';
import { httpRouter } from './transports/http.js';

/**
 * Build a small engine pre-loaded with one OK + one ERROR span across
 * two services so every default tool has something to return.
 */
async function fixtureServer() {
	const engine = createEngine({ storage: createMemoryStorage() });
	const baseTs = BigInt(Date.UTC(2026, 4, 26, 12, 0, 0)) * 1_000_000n;
	const spans: Span[] = [
		{
			traceId: 'a'.repeat(32) as never,
			spanId: '1'.repeat(16) as never,
			name: 'GET /ok',
			kind: SpanKind.Server,
			startTimeUnixNano: baseTs,
			endTimeUnixNano: baseTs + 5_000_000n,
			status: { code: SpanStatusCode.Ok },
			attributes: {},
			resource: { attributes: { 'service.name': 'frontend' } },
			scope: { name: 'http' },
		},
		{
			traceId: 'b'.repeat(32) as never,
			spanId: '2'.repeat(16) as never,
			name: 'POST /broken',
			kind: SpanKind.Server,
			startTimeUnixNano: baseTs,
			endTimeUnixNano: baseTs + 50_000_000n,
			status: { code: SpanStatusCode.Error, message: 'boom' },
			attributes: {},
			resource: { attributes: { 'service.name': 'api' } },
			scope: { name: 'http' },
		},
	];
	await engine.ingestSpans(spans);
	// One structured log carrying agent content in an attribute, mirroring
	// the way Codex logs ride prompts on the logs pipeline.
	await engine.ingestLogs([
		{
			timeUnixNano: baseTs,
			severityNumber: 9,
			severityText: 'INFO',
			eventName: 'codex.user_prompt',
			attributes: { prompt: 'find the otelux-needle' },
			resource: { attributes: { 'service.name': 'codex_exec' } },
			scope: { name: 'codex_otel.log_only' },
		},
	]);
	return createMcpServer({ engine });
}

function parseToolResult<T>(response: unknown): T {
	const content = (response as { result: { content: Array<{ text: string }> } }).result.content;
	expect(content).toHaveLength(1);
	const item = content.at(0);
	if (!item) {
		throw new Error('Expected one MCP tool result content item.');
	}
	return JSON.parse(item.text) as T;
}

describe('createMcpServer', () => {
	it('negotiates the newest mutually-supported protocol version on initialize', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 1,
			method: 'initialize',
			params: { protocolVersion: MCP_PROTOCOL_VERSIONS[1], clientInfo: { name: 'test' } },
		});
		expect(response).toMatchObject({
			id: 1,
			result: {
				protocolVersion: MCP_PROTOCOL_VERSIONS[1],
				serverInfo: { name: '@otelux/mcp-server' },
				capabilities: { tools: {} },
			},
		});
	});

	it('lists the 7 default read-only tools', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 2,
			method: 'tools/list',
		});
		const result = (response as { result: { tools: Array<{ name: string }> } }).result;
		expect(result.tools.map((t) => t.name)).toEqual([
			'otel_find_recent_errors',
			'otel_get_slowest_spans',
			'otel_search_logs',
			'otel_correlate_agent_run',
			'otel_get_trace',
			'otel_get_span_details',
			'otel_get_service_overview',
		]);
	});

	it('annotates every bundled tool as read-only, closed-world, and non-destructive', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 2,
			method: 'tools/list',
		});
		const tools = (
			response as {
				result: {
					tools: Array<{
						annotations?: Record<string, boolean>;
					}>;
				};
			}
		).result.tools;
		expect(tools.map((tool) => tool.annotations)).toEqual(
			tools.map(() => ({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			})),
		);
	});

	it('marks the unimplemented tool experimental in tools/list', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 2,
			method: 'tools/list',
		});
		const tools = (response as { result: { tools: Array<{ name: string; experimental?: boolean }> } })
			.result.tools;
		const correlate = tools.find((t) => t.name === 'otel_correlate_agent_run');
		const errors = tools.find((t) => t.name === 'otel_find_recent_errors');
		expect(correlate?.experimental).toBe(true);
		// Functional tools carry no experimental flag.
		expect(errors?.experimental).toBeUndefined();
	});

	it('returns engine-backed results for tools/call', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 3,
			method: 'tools/call',
			params: { name: 'otel_get_slowest_spans', arguments: { limit: 5 } },
		});
		const payload = parseToolResult<{ slowestTraces: Array<{ rootName: string }> }>(response);
		expect(payload.slowestTraces.map((trace) => trace.rootName)).toEqual(['POST /broken', 'GET /ok']);
	});

	it('requires traceId and spanId for span detail', async () => {
		const server = await fixtureServer();
		const listed = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 30,
			method: 'tools/list',
		});
		const tools = (listed as { result: { tools: Array<{ name: string; inputSchema: unknown }> } })
			.result.tools;
		expect(tools.find((tool) => tool.name === 'otel_get_span_details')?.inputSchema).toMatchObject({
			required: ['traceId', 'spanId'],
		});

		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 31,
			method: 'tools/call',
			params: {
				name: 'otel_get_span_details',
				arguments: { traceId: 'b'.repeat(32), spanId: '2'.repeat(16) },
			},
		});
		const payload = parseToolResult<{ span: Span }>(response);
		expect(payload.span).toMatchObject({ traceId: 'b'.repeat(32), name: 'POST /broken' });
	});

	it('reports stub tools as supported:false rather than throwing', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 4,
			method: 'tools/call',
			params: { name: 'otel_correlate_agent_run', arguments: { runId: 'foo' } },
		});
		const payload = parseToolResult<{ supported: boolean }>(response);
		expect(payload).toMatchObject({ supported: false });
	});

	it('searches structured logs by free text, including attribute values', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 6,
			method: 'tools/call',
			params: { name: 'otel_search_logs', arguments: { query: 'otelux-needle' } },
		});
		const payload = parseToolResult<{
			supported: boolean;
			totalCount: number;
			logs: Array<{ service: string; attributes: Record<string, string> }>;
		}>(response);
		expect(payload.supported).toBe(true);
		expect(payload.totalCount).toBe(1);
		expect(
			payload.logs.map((log) => ({ service: log.service, prompt: log.attributes.prompt })),
		).toEqual([{ service: 'codex_exec', prompt: 'find the otelux-needle' }]);
	});

	it('returns method-not-found for unknown JSON-RPC methods', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			id: 5,
			method: 'mystery',
		});
		expect(response).toMatchObject({ id: 5, error: { code: -32601 } });
	});

	it('returns undefined for notifications', async () => {
		const server = await fixtureServer();
		const response = await server.handle({
			jsonrpc: JSON_RPC_VERSION,
			method: 'notifications/initialized',
		});
		expect(response).toBeUndefined();
	});
});

describe('httpRouter', () => {
	it('responds to GET / with server identity', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server });
		const response = await app.request('/');
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			name: '@otelux/mcp-server',
			transport: 'streamable-http',
		});
	});

	it('round-trips a JSON-RPC tools/list POST', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server });
		const response = await app.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 1, method: 'tools/list' }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { result?: { tools?: unknown[] } };
		expect(body.result?.tools).toBeDefined();
	});

	it('returns 204 for notifications', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server });
		const response = await app.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, method: 'notifications/initialized' }),
		});
		expect(response.status).toBe(204);
	});

	it('returns 400 with a JSON-RPC parse error for non-JSON bodies', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server });
		const response = await app.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: 'not json',
		});
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error?: { code?: number } };
		expect(body.error?.code).toBe(-32700);
	});

	it('rejects an over-limit body with 413 before dispatch', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server, maxBodyBytes: 1024 });
		const response = await app.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: JSON_RPC_VERSION,
				id: 1,
				method: 'tools/list',
				padding: 'x'.repeat(1025),
			}),
		});
		expect(response.status).toBe(413);
		const body = (await response.json()) as { error?: { code?: number } };
		expect(body.error?.code).toBe(-32600);
	});

	it('returns 415 for a non-JSON content type', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server });
		const response = await app.request('/', {
			method: 'POST',
			headers: { 'content-type': 'text/plain' },
			body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 1, method: 'tools/list' }),
		});
		expect(response.status).toBe(415);
	});

	it('rejects a browser origin by default with 403', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server });
		const response = await app.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
			body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 1, method: 'tools/list' }),
		});
		expect(response.status).toBe(403);
	});

	it('rejects a POST without the bearer token when one is configured', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server, authToken: 'secret-token' });
		const response = await app.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 1, method: 'tools/list' }),
		});
		expect(response.status).toBe(401);
	});

	it('rejects a POST with a wrong bearer token', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server, authToken: 'secret-token' });
		const response = await app.request('/', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer wrong-token',
			},
			body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 1, method: 'tools/list' }),
		});
		expect(response.status).toBe(401);
	});

	it('accepts a POST carrying the correct bearer token', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server, authToken: 'secret-token' });
		const response = await app.request('/', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer secret-token',
			},
			body: JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id: 1, method: 'tools/list' }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { result?: { tools?: unknown[] } };
		expect(body.result?.tools).toBeDefined();
	});

	it('leaves the identity probe open even when a token is configured', async () => {
		const server = await fixtureServer();
		const app = httpRouter({ server, authToken: 'secret-token' });
		const response = await app.request('/');
		expect(response.status).toBe(200);
	});
});
