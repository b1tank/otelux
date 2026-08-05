/**
 * @otelux/receiver — OTLP/HTTP receiver wired to an @otelux/engine.
 *
 * We accept the OTLP/HTTP JSON and protobuf encodings. Spec:
 * https://opentelemetry.io/docs/specs/otlp/#otlphttp
 *
 * - POST /v1/traces  — `ExportTraceServiceRequest` (JSON or protobuf body).
 * - POST /v1/logs    — `ExportLogsServiceRequest` (JSON or protobuf body).
 * - POST /v1/metrics — `ExportMetricsServiceRequest` (JSON or protobuf body).
 * - GET /healthz — 200 OK probe used by the desktop app to know when the
 *   server is ready to accept connections.
 *
 * Encoding is selected by `Content-Type`: `application/json` for JSON, and
 * `application/x-protobuf` (or `application/protobuf`) for protobuf, which is
 * the default wire format for most OpenTelemetry SDK exporters. The success
 * response mirrors the request encoding.
 */

import { type ServerType, serve } from '@hono/node-server';
import type { Engine } from '@otelux/engine';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { type OtlpExportTraceServiceRequest, decodeExportTraceServiceRequest } from './otlp.js';
import { type OtlpExportLogsServiceRequest, decodeExportLogsServiceRequest } from './otlpLogs.js';
import {
	type OtlpExportMetricsServiceRequest,
	decodeExportMetricsServiceRequest,
} from './otlpMetrics.js';
import {
	decodeLogsRequestFromProtobuf,
	decodeMetricsRequestFromProtobuf,
	decodeTraceRequestFromProtobuf,
} from './otlpProtobuf.js';

export type { OtlpExportTraceServiceRequest } from './otlp.js';
export { decodeExportTraceServiceRequest } from './otlp.js';
export type { OtlpExportLogsServiceRequest } from './otlpLogs.js';
export { decodeExportLogsServiceRequest } from './otlpLogs.js';
export type { OtlpExportMetricsServiceRequest } from './otlpMetrics.js';
export { decodeExportMetricsServiceRequest } from './otlpMetrics.js';
export {
	decodeLogsRequestFromProtobuf,
	decodeMetricsRequestFromProtobuf,
	decodeTraceRequestFromProtobuf,
} from './otlpProtobuf.js';
export type {
	ClaimSingleInstanceOptions,
	SingleInstanceClaim,
	SingleInstanceEndpoint,
} from './singleInstance.js';
export { claimSingleInstance } from './singleInstance.js';

export interface ReceiverOptions {
	engine: Engine;
	/** Port to bind. OTLP/HTTP default is 4318. */
	port?: number;
	/** Host to bind. Defaults to `127.0.0.1` so a desktop install is not exposed on the LAN. */
	host?: string;
	/**
	 * Maximum accepted request body size in bytes. Bodies larger than this
	 * are rejected with `413` before decoding, bounding memory growth from
	 * a hostile or misconfigured sender. Defaults to 10 MiB, which is far
	 * above any real OTLP/HTTP export batch.
	 */
	maxBodyBytes?: number;
	/**
	 * Browser origins permitted to call this listener. Empty by default,
	 * which rejects every request that carries an `Origin` header with
	 * `403`. This blocks a malicious web page (or a DNS-rebinding attack)
	 * from POSTing to the loopback listener. Non-browser senders (OTel
	 * SDKs, CLIs) omit `Origin` and are always allowed; only hosts that
	 * intentionally accept browser clients need to populate this.
	 */
	allowedOrigins?: readonly string[];
	/** Maximum concurrently queued/active export requests. Defaults to 64. */
	maxPendingExports?: number;
	/** Called when an export is rejected before ingest because the queue is full. */
	onOverload?: (signal: 'traces' | 'logs' | 'metrics') => void;
}

export interface Receiver {
	readonly port: number;
	readonly host: string;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export function createReceiver(options: ReceiverOptions): Receiver {
	const requestedPort = options.port ?? 4318;
	const host = options.host ?? '127.0.0.1';
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_OTLP_MAX_BODY_BYTES;
	const allowedOrigins = new Set(options.allowedOrigins ?? []);
	const maxPendingExports = options.maxPendingExports ?? 64;
	let pendingExports = 0;
	const ingest = async <T>(
		signal: 'traces' | 'logs' | 'metrics',
		data: T,
		write: (value: T) => Promise<void>,
	): Promise<boolean> => {
		if (pendingExports >= maxPendingExports) {
			options.onOverload?.(signal);
			return false;
		}
		pendingExports++;
		try {
			await write(data);
			return true;
		} finally {
			pendingExports--;
		}
	};
	let server: ServerType | undefined;
	let boundPort = requestedPort;

	const app = new Hono();

	// Origin and content-type gate for every route. Runs before body
	// reading so a rejected request never touches the decoder.
	app.use('*', (c, next) =>
		enforceRequestPolicy(
			c,
			next,
			allowedOrigins,
			new Set([`${host}:${boundPort}`, ...(host === '127.0.0.1' ? [`localhost:${boundPort}`] : [])]),
		),
	);

	app.get('/healthz', (c) => c.text('ok'));

	app.post('/v1/traces', (c) =>
		handleExport(
			c,
			maxBodyBytes,
			(bytes) => decodeExportTraceServiceRequest(decodeTraceRequestFromProtobuf(bytes)),
			(payload) => decodeExportTraceServiceRequest(payload as OtlpExportTraceServiceRequest),
			(spans) => ingest('traces', spans, (value) => options.engine.ingestSpans(value)),
		),
	);

	app.post('/v1/logs', (c) =>
		handleExport(
			c,
			maxBodyBytes,
			(bytes) => decodeExportLogsServiceRequest(decodeLogsRequestFromProtobuf(bytes)),
			(payload) => decodeExportLogsServiceRequest(payload as OtlpExportLogsServiceRequest),
			(logs) => ingest('logs', logs, (value) => options.engine.ingestLogs(value)),
		),
	);

	app.post('/v1/metrics', (c) =>
		handleExport(
			c,
			maxBodyBytes,
			(bytes) => decodeExportMetricsServiceRequest(decodeMetricsRequestFromProtobuf(bytes)),
			(payload) => decodeExportMetricsServiceRequest(payload as OtlpExportMetricsServiceRequest),
			(metrics) => ingest('metrics', metrics, (value) => options.engine.ingestMetrics(value)),
		),
	);

	return {
		// Reported port reflects the actually bound port (matters when
		// callers pass `port: 0` to ask the OS for a free port — common in
		// tests and when the default 4318 is taken).
		get port(): number {
			return boundPort;
		},
		host,

		start(): Promise<void> {
			return new Promise<void>((resolve, reject) => {
				// @hono/node-server invokes the success callback on `listening`
				// but reports bind failures (EADDRINUSE, EACCES, ...) via the
				// http server's `error` event. Without an explicit listener
				// here, those errors would bubble up as unhandled and our
				// Promise would never settle — see
				// https://nodejs.org/api/net.html#event-error.
				const s = serve(
					{
						fetch: app.fetch,
						port: requestedPort,
						hostname: host,
					},
					(info) => {
						boundPort = info.port;
						s.off('error', onError);
						resolve();
					},
				);
				const onError = (err: Error): void => {
					s.off('error', onError);
					// Discard the failed server so `stop()` doesn't try to
					// close something that was never listening.
					server = undefined;
					reject(err);
				};
				s.once('error', onError);
				server = s;
			});
		},

		stop(): Promise<void> {
			return new Promise<void>((resolve, reject) => {
				if (!server) {
					resolve();
					return;
				}
				server.close((err) => {
					if (err) {
						reject(err);
						return;
					}
					resolve();
				});
				server = undefined;
			});
		},
	};
}

const MIB = 1024 * 1024;

/**
 * Default OTLP request body cap. Real OTLP/HTTP export batches are far
 * smaller; this bounds memory growth when a sender is hostile or
 * misconfigured. Overridable per-receiver via {@link ReceiverOptions.maxBodyBytes}.
 */
const DEFAULT_OTLP_MAX_BODY_BYTES = 10 * MIB;

const textDecoder = new TextDecoder();

/**
 * Shared export handler for the three signal routes. Reads the body under the
 * size cap, decodes it with the encoding named by `Content-Type` (protobuf when
 * `application/x-protobuf`/`application/protobuf`, otherwise JSON), ingests the
 * result, and answers with a success response in the same encoding. A malformed
 * body is rejected with `400` rather than throwing.
 */
async function handleExport<T>(
	c: Context,
	maxBodyBytes: number,
	decodeProto: (bytes: Uint8Array) => T,
	decodeJson: (payload: unknown) => T,
	ingest: (data: T) => Promise<boolean>,
): Promise<Response> {
	const body = await readBodyWithLimit(c.req.raw, maxBodyBytes);
	if (!body.ok) {
		return c.json({ error: 'payload_too_large' }, 413);
	}
	const proto = isProtobufMediaType(c.req.header('content-type'));
	let data: T;
	try {
		data = proto ? decodeProto(body.bytes) : decodeJson(JSON.parse(textDecoder.decode(body.bytes)));
	} catch {
		return c.json({ error: proto ? 'invalid_protobuf' : 'invalid_json' }, 400);
	}
	if (!(await ingest(data))) {
		return c.json({ error: 'receiver_overloaded' }, 503);
	}
	// Mirror the request encoding in the success response. An empty body is a
	// valid empty ExportServiceResponse (no partial_success = everything accepted).
	return proto
		? c.body(null, 200, { 'Content-Type': 'application/x-protobuf' })
		: c.json({ partialSuccess: {} });
}

type LimitedBody = { ok: true; bytes: Uint8Array } | { ok: false };

/**
 * Read a request body as raw bytes while enforcing a hard byte cap.
 *
 * Two layers of defense:
 *  1. Fast path — honest senders declare `Content-Length`, so reject
 *     before reading a byte when the declared size already exceeds the
 *     cap.
 *  2. Slow path — a chunked body that omits or lies about
 *     `Content-Length` still cannot exhaust memory because we count
 *     bytes as they stream and abort the moment the running total
 *     exceeds the cap.
 *
 * A body of exactly `maxBytes` is accepted; only strictly larger bodies
 * are rejected.
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
		return { ok: true, bytes: new Uint8Array(0) };
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
					// Stop pulling and release the socket instead of buffering
					// the rest of an over-limit body.
					await reader.cancel();
					return { ok: false };
				}
				chunks.push(value);
			}
		}
	} finally {
		reader.releaseLock();
	}

	return { ok: true, bytes: concatChunks(chunks, total) };
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/**
 * Reject requests a loopback OTLP listener should never serve:
 *  - Any request carrying an `Origin` outside `allowedOrigins` gets
 *    `403`. Browsers attach `Origin`; OTLP SDKs and CLIs do not, so
 *    legitimate exporters are unaffected while a malicious web page (or
 *    a DNS-rebinding attempt against `127.0.0.1`) is blocked.
 *  - `OPTIONS` preflight for an approved (or non-browser) request returns
 *    `204` with the minimal CORS headers a browser needs.
 *  - `POST` bodies must be `application/json` or `application/x-protobuf`
 *    (`application/protobuf` is also accepted); anything else is `415`
 *    before the body is read.
 */
async function enforceRequestPolicy(
	c: Context,
	next: Next,
	allowedOrigins: ReadonlySet<string>,
	allowedHosts: ReadonlySet<string>,
): Promise<Response | undefined> {
	const requestHost = c.req.header('host')?.toLowerCase();
	if (requestHost === undefined || !allowedHosts.has(requestHost)) {
		return c.json({ error: 'invalid_host' }, 400);
	}
	const origin = c.req.header('origin');
	if (origin !== undefined) {
		if (!allowedOrigins.has(origin)) {
			return c.json({ error: 'forbidden_origin' }, 403);
		}
		// Echo the approved origin so the browser accepts the response.
		c.header('Access-Control-Allow-Origin', origin);
		c.header('Vary', 'Origin');
	}
	if (c.req.method === 'OPTIONS') {
		c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
		c.header('Access-Control-Allow-Headers', 'content-type');
		return c.body(null, 204);
	}
	if (c.req.method === 'POST' && !isSupportedMediaType(c.req.header('content-type'))) {
		return c.json({ error: 'unsupported_media_type' }, 415);
	}
	await next();
	return undefined;
}

function isJsonMediaType(value: string | undefined): boolean {
	return mediaType(value) === 'application/json';
}

function isProtobufMediaType(value: string | undefined): boolean {
	const m = mediaType(value);
	// Exporters use `application/x-protobuf`; `application/protobuf` is also seen.
	return m === 'application/x-protobuf' || m === 'application/protobuf';
}

function isSupportedMediaType(value: string | undefined): boolean {
	return isJsonMediaType(value) || isProtobufMediaType(value);
}

function mediaType(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	// Ignore parameters: "application/json; charset=utf-8" -> "application/json".
	return value.split(';', 1)[0]?.trim().toLowerCase();
}

export const OTELUX_RECEIVER_VERSION = '0.1.0' as const;
