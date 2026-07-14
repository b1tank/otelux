import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine, createMemoryStorage } from '@otelux/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	OTELUX_RECEIVER_VERSION,
	type OtlpExportTraceServiceRequest,
	createReceiver,
	decodeExportTraceServiceRequest,
} from './index.js';

const FIXTURE = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('../../../fixtures/sample_trace.json', import.meta.url)),
		'utf8',
	),
) as OtlpExportTraceServiceRequest;

describe('@otelux/receiver', () => {
	it('exports a version constant', () => {
		expect(OTELUX_RECEIVER_VERSION).toBe('0.1.0');
	});

	it('decodes the sample OTLP/HTTP JSON fixture', () => {
		const spans = decodeExportTraceServiceRequest(FIXTURE);
		expect(spans).toHaveLength(3);
		const root = spans.find((s) => !s.parentSpanId);
		expect(root?.name).toBe('GET /api/users');
		expect(root?.resource.attributes['service.name']).toBe('api-gateway');
		expect(root?.attributes['http.status_code']).toBe(200n);
	});

	describe('HTTP server', () => {
		let engine: ReturnType<typeof createEngine>;
		let receiver: ReturnType<typeof createReceiver>;
		let baseUrl: string;

		beforeEach(async () => {
			engine = createEngine({ storage: createMemoryStorage() });
			// Bind to a random free port to allow parallel test runs.
			receiver = createReceiver({ engine, port: 0 });
			await receiver.start();
			baseUrl = `http://${receiver.host}:${receiver.port}`;
		});

		afterEach(async () => {
			await receiver.stop();
			await engine.close();
		});

		it('serves /healthz', async () => {
			const res = await fetch(`${baseUrl}/healthz`);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('ok');
		});

		it('ingests an OTLP/HTTP JSON payload into the engine', async () => {
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(FIXTURE),
			});
			expect(res.status).toBe(200);
			const list = await engine.listTraces({});
			expect(list.totalCount).toBe(1);
			expect(list.rows[0]?.spanCount).toBe(3);
			expect(list.rows[0]?.rootName).toBe('GET /api/users');
		});

		it('returns 400 for malformed JSON', async () => {
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{not json',
			});
			expect(res.status).toBe(400);
		});

		it('returns 415 for a non-JSON content type', async () => {
			// Valid JSON with the wrong media type must still be refused, so the
			// check discriminates content-type enforcement from JSON parsing.
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: JSON.stringify(FIXTURE),
			});
			expect(res.status).toBe(415);
			const list = await engine.listTraces({});
			expect(list.totalCount).toBe(0);
		});

		it('rejects a browser origin by default with 403 and no CORS header', async () => {
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
				body: JSON.stringify(FIXTURE),
			});
			expect(res.status).toBe(403);
			expect(res.headers.get('access-control-allow-origin')).toBeNull();
			const list = await engine.listTraces({});
			expect(list.totalCount).toBe(0);
		});

		it('rejects start() when the port is already in use', async () => {
			// The fixture receiver is already bound to `receiver.port`.
			// A second receiver targeting the same port must surface the
			// bind error as a rejection — otherwise callers (like the
			// desktop main process) hang forever on `await start()`.
			const second = createReceiver({ engine, port: receiver.port });
			await expect(second.start()).rejects.toThrow(/EADDRINUSE/);
			// A failed start must leave nothing to clean up; calling
			// stop() should be a safe no-op.
			await expect(second.stop()).resolves.toBeUndefined();
		});
	});

	describe('request body limits', () => {
		let engine: ReturnType<typeof createEngine>;
		let receiver: ReturnType<typeof createReceiver>;
		let baseUrl: string;

		beforeEach(async () => {
			engine = createEngine({ storage: createMemoryStorage() });
			// A tiny cap so tests can straddle it without megabyte payloads.
			receiver = createReceiver({ engine, port: 0, maxBodyBytes: 1024 });
			await receiver.start();
			baseUrl = `http://${receiver.host}:${receiver.port}`;
		});

		afterEach(async () => {
			await receiver.stop();
			await engine.close();
		});

		it('rejects an over-limit body with 413 before decoding', async () => {
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: 'x'.repeat(1025),
			});
			expect(res.status).toBe(413);
			const list = await engine.listTraces({});
			expect(list.totalCount).toBe(0);
		});

		it('accepts a body at exactly the limit, then applies normal validation', async () => {
			// A 1024-byte body passes the size gate; it is invalid JSON, so it
			// falls through to the normal 400 rather than 413 — proving the gate
			// let it reach payload validation.
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: 'x'.repeat(1024),
			});
			expect(res.status).toBe(400);
		});
	});

	describe('browser origin allowlist', () => {
		let engine: ReturnType<typeof createEngine>;
		let receiver: ReturnType<typeof createReceiver>;
		let baseUrl: string;

		beforeEach(async () => {
			engine = createEngine({ storage: createMemoryStorage() });
			receiver = createReceiver({
				engine,
				port: 0,
				allowedOrigins: ['https://app.example'],
			});
			await receiver.start();
			baseUrl = `http://${receiver.host}:${receiver.port}`;
		});

		afterEach(async () => {
			await receiver.stop();
			await engine.close();
		});

		it('allows a configured origin and echoes CORS headers', async () => {
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: 'https://app.example' },
				body: JSON.stringify(FIXTURE),
			});
			expect(res.status).toBe(200);
			expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
			expect(res.headers.get('vary')).toBe('Origin');
		});

		it('rejects a non-allowlisted sibling origin with 403', async () => {
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
				body: JSON.stringify(FIXTURE),
			});
			expect(res.status).toBe(403);
		});

		it('answers CORS preflight for an allowed origin', async () => {
			const res = await fetch(`${baseUrl}/v1/traces`, {
				method: 'OPTIONS',
				headers: {
					origin: 'https://app.example',
					'access-control-request-method': 'POST',
				},
			});
			expect(res.status).toBe(204);
			expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
			expect(res.headers.get('access-control-allow-methods')).toContain('POST');
		});
	});
});
