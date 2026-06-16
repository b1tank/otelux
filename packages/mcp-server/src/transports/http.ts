/**
 * HTTP transport for {@link McpServer} as a mountable Hono router.
 *
 * Streamable HTTP transport per MCP 2025-06-18:
 * https://modelcontextprotocol.io/specification/draft/basic/transports#streamable-http
 *
 * Single endpoint that accepts `POST` JSON-RPC requests and returns a
 * synchronous JSON-RPC response. Notifications (`id` missing) receive a
 * `204 No Content` per spec. Streaming responses (SSE) are intentionally
 * not implemented yet — every current OTelux tool is fast and synchronous,
 * so there is nothing to stream.
 */

import { Hono } from 'hono';
import type { JsonRpcError, JsonRpcRequest } from '../protocol.js';
import { ERROR_CODES, JSON_RPC_VERSION } from '../protocol.js';
import type { McpServer } from '../server.js';

export interface HttpRouterOptions {
	readonly server: McpServer;
}

export function httpRouter(options: HttpRouterOptions): Hono {
	const { server } = options;
	const app = new Hono();

	app.get('/', (c) =>
		c.json({
			name: server.serverInfo.name,
			version: server.serverInfo.version,
			transport: 'streamable-http',
			tools: server.tools.length,
		}),
	);

	app.post('/', async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json(parseError() as unknown as Record<string, unknown>, 400);
		}
		if (!isJsonRpcRequest(body)) {
			return c.json(invalidRequest() as unknown as Record<string, unknown>, 400);
		}

		const response = await server.handle(body);
		if (response === undefined) {
			// Notifications get no body. 204 is the spec-required status.
			return c.body(null, 204);
		}
		return c.json(response as unknown as Record<string, unknown>);
	});

	return app;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const v = value as Partial<JsonRpcRequest>;
	return v.jsonrpc === JSON_RPC_VERSION && typeof v.method === 'string';
}

function parseError(): JsonRpcError {
	return {
		jsonrpc: JSON_RPC_VERSION,
		id: null,
		error: { code: ERROR_CODES.PARSE_ERROR, message: 'invalid JSON' },
	};
}

function invalidRequest(): JsonRpcError {
	return {
		jsonrpc: JSON_RPC_VERSION,
		id: null,
		error: { code: ERROR_CODES.INVALID_REQUEST, message: 'not a JSON-RPC 2.0 request' },
	};
}
