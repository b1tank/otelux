/**
 * @otelux/receiver — OTLP/HTTP receiver wired to an @otelux/engine.
 *
 * For Milestone 1 we accept the OTLP/HTTP JSON encoding only. Spec:
 * https://opentelemetry.io/docs/specs/otlp/#otlphttp
 *
 * - POST /v1/traces — `ExportTraceServiceRequest` JSON body.
 * - GET /healthz — 200 OK probe used by the desktop app to know when the
 *   server is ready to accept connections.
 *
 * The protobuf encoding (`Content-Type: application/x-protobuf`) is
 * intentionally deferred — OTel SDKs all support `protocol=http/json` so
 * we lose no real-world senders.
 */

import { type ServerType, serve } from '@hono/node-server';
import type { Engine } from '@otelux/engine';
import { Hono } from 'hono';
import { type OtlpExportTraceServiceRequest, decodeExportTraceServiceRequest } from './otlp.js';

export type { OtlpExportTraceServiceRequest } from './otlp.js';
export { decodeExportTraceServiceRequest } from './otlp.js';

export interface ReceiverOptions {
	engine: Engine;
	/** Port to bind. OTLP/HTTP default is 4318. */
	port?: number;
	/** Host to bind. Defaults to `127.0.0.1` so a desktop install is not exposed on the LAN. */
	host?: string;
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
	let server: ServerType | undefined;
	let boundPort = requestedPort;

	const app = new Hono();

	app.get('/healthz', (c) => c.text('ok'));

	app.post('/v1/traces', async (c) => {
		// OTLP requires application/json for JSON encoding. Be lenient: we
		// accept anything that parses, but reject obviously wrong bodies
		// with a structured OTLP partial-success-style 400.
		let payload: OtlpExportTraceServiceRequest;
		try {
			payload = (await c.req.json()) as OtlpExportTraceServiceRequest;
		} catch {
			return c.json({ error: 'invalid_json' }, 400);
		}
		const spans = decodeExportTraceServiceRequest(payload);
		await options.engine.ingestSpans(spans);
		// OTLP success response shape: empty partialSuccess means everything accepted.
		return c.json({ partialSuccess: {} });
	});

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

export const OTELUX_RECEIVER_VERSION = '0.1.0' as const;
