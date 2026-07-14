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
	/**
	 * Maximum accepted request body size in bytes. Bodies larger than this
	 * are rejected with `413` before JSON-RPC parsing, so a hostile client
	 * cannot exhaust memory on the loopback listener. Defaults to 1 MiB,
	 * which is far above any real MCP request.
	 */
	readonly maxBodyBytes?: number;
}

const DEFAULT_MCP_MAX_BODY_BYTES = 1024 * 1024;

export function httpRouter(options: HttpRouterOptions): Hono {
	const { server } = options;
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MCP_MAX_BODY_BYTES;
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
		const read = await readBodyWithLimit(c.req.raw, maxBodyBytes);
		if (!read.ok) {
			return c.json(payloadTooLarge() as unknown as Record<string, unknown>, 413);
		}
		let body: unknown;
		try {
			body = JSON.parse(read.text);
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

type LimitedBody = { ok: true; text: string } | { ok: false };

/**
 * Read a request body as text while enforcing a hard byte cap.
 *
 * Fast path rejects on a declared `Content-Length` above the cap; slow
 * path counts bytes as they stream so a chunked body that omits or lies
 * about `Content-Length` still cannot exhaust memory. A body of exactly
 * `maxBytes` is accepted; only strictly larger bodies are rejected.
 */
async function readBodyWithLimit(req: Request, maxBytes: number): Promise<LimitedBody> {
	const declared = req.headers.get('content-length');
	if (declared !== null) {
		const n = Number(declared);
		if (Number.isFinite(n) && n > maxBytes) {
			return { ok: false };
		}
	}

	const body = req.body;
	if (body === null) {
		return { ok: true, text: '' };
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (value) {
				total += value.byteLength;
				if (total > maxBytes) {
					await reader.cancel();
					return { ok: false };
				}
				chunks.push(value);
			}
		}
	} finally {
		reader.releaseLock();
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { ok: true, text: new TextDecoder().decode(out) };
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

function payloadTooLarge(): JsonRpcError {
	// JSON-RPC has no dedicated size-limit code; the 413 status is the
	// meaningful signal. INVALID_REQUEST reflects that an over-limit body
	// is refused before it is ever treated as a valid request.
	return {
		jsonrpc: JSON_RPC_VERSION,
		id: null,
		error: { code: ERROR_CODES.INVALID_REQUEST, message: 'request body too large' },
	};
}
