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
});
