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

import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
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
	/**
	 * Browser origins permitted to call this listener. Empty by default,
	 * which rejects every request carrying an `Origin` header with `403` so
	 * a malicious web page cannot reach the local MCP tools. MCP clients are
	 * not browsers and omit `Origin`, so they are unaffected.
	 */
	readonly allowedOrigins?: readonly string[];
	/**
	 * Per-install credential required on every JSON-RPC `POST` as
	 * `Authorization: Bearer <token>`. When set, a request without a
	 * matching token is rejected with `401` before any tool runs, so
	 * another local process cannot read telemetry just by reaching the
	 * loopback port. When omitted the listener is unauthenticated (used by
	 * tests and embedders that supply their own gate).
	 */
	readonly authToken?: string;
}

const DEFAULT_MCP_MAX_BODY_BYTES = 1024 * 1024;

export function httpRouter(options: HttpRouterOptions): Hono {
	const { server, authToken } = options;
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MCP_MAX_BODY_BYTES;
	const allowedOrigins = new Set(options.allowedOrigins ?? []);
	const app = new Hono();

	// Reject browser origins and non-JSON POSTs before any dispatch.
	app.use('*', (c, next) => enforceRequestPolicy(c, next, allowedOrigins));

	app.get('/', (c) =>
		c.json({
			name: server.serverInfo.name,
			version: server.serverInfo.version,
			transport: 'streamable-http',
			tools: server.tools.length,
		}),
	);

	app.post('/', async (c) => {
		// Authenticate before reading the body so an unauthorized caller
		// cannot even stream a payload at us.
		if (authToken !== undefined && !hasValidBearerToken(c.req.header('authorization'), authToken)) {
			return c.json(unauthorized() as unknown as Record<string, unknown>, 401);
		}
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

/**
 * Reject requests the loopback MCP listener should never serve:
 *  - Any request carrying an `Origin` outside `allowedOrigins` gets
 *    `403`. MCP clients are not browsers and omit `Origin`, so a
 *    malicious web page is blocked while real clients are unaffected.
 *  - `OPTIONS` preflight for an approved (or non-browser) request returns
 *    `204` with the minimal CORS headers a browser needs.
 *  - `POST` bodies must be `application/json`; anything else is `415`
 *    before the body is read.
 */
async function enforceRequestPolicy(
	c: Context,
	next: Next,
	allowedOrigins: ReadonlySet<string>,
): Promise<Response | undefined> {
	const origin = c.req.header('origin');
	if (origin !== undefined) {
		if (!allowedOrigins.has(origin)) {
			return c.json({ error: 'forbidden_origin' }, 403);
		}
		c.header('Access-Control-Allow-Origin', origin);
		c.header('Vary', 'Origin');
	}
	if (c.req.method === 'OPTIONS') {
		c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
		c.header('Access-Control-Allow-Headers', 'content-type');
		return c.body(null, 204);
	}
	if (c.req.method === 'POST' && !isJsonMediaType(c.req.header('content-type'))) {
		return c.json({ error: 'unsupported_media_type' }, 415);
	}
	await next();
	return undefined;
}

function isJsonMediaType(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	// Ignore parameters: "application/json; charset=utf-8" -> "application/json".
	const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
	return mediaType === 'application/json';
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

function unauthorized(): JsonRpcError {
	// The 401 status carries the auth signal; JSON-RPC has no auth code, so
	// INVALID_REQUEST marks the request as refused before processing.
	return {
		jsonrpc: JSON_RPC_VERSION,
		id: null,
		error: { code: ERROR_CODES.INVALID_REQUEST, message: 'unauthorized' },
	};
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header
 * against the expected token. The comparison is length-guarded and uses
 * `timingSafeEqual` so a caller cannot recover the token byte-by-byte
 * from response timing.
 */
function hasValidBearerToken(header: string | undefined, expected: string): boolean {
	const prefix = 'Bearer ';
	if (header === undefined || !header.startsWith(prefix)) {
		return false;
	}
	const provided = Buffer.from(header.slice(prefix.length));
	const want = Buffer.from(expected);
	if (provided.length !== want.length) {
		return false;
	}
	return timingSafeEqual(provided, want);
}
