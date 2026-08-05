import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine, createMemoryStorage } from '@otelux/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	type OtlpExportLogsServiceRequest,
	createReceiver,
	decodeExportLogsServiceRequest,
} from './index.js';

// Synthetic ExportLogsServiceRequest shaped after `codex exec` telemetry — the
// Codex logs pipeline is the load-bearing workload for OTelux structured logs.
const FIXTURE = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('../../../fixtures/sample_codex_logs.json', import.meta.url)),
		'utf8',
	),
) as OtlpExportLogsServiceRequest;

const PROMPT_TEXT = 'Reply with exactly: otelux-logs-fixture';

describe('@otelux/receiver logs', () => {
	it('decodes the synthetic Codex-shaped ExportLogsServiceRequest fixture', () => {
		const logs = decodeExportLogsServiceRequest(FIXTURE);
		expect(logs.length).toBeGreaterThan(0);
		const first = logs[0];
		expect(first?.resource.attributes['service.name']).toBe('codex_exec');
		expect(first?.scope.name).toBe('codex_otel.log_only');
		expect(first?.severityNumber).toBe(9);
	});

	it('preserves the user prompt content from attributes', () => {
		// The whole point: content rides the logs pipeline (in attributes),
		// not traces. Verify the typed prompt survives decoding.
		const logs = decodeExportLogsServiceRequest(FIXTURE);
		const withPrompt = logs.find((l) => l.attributes.prompt === PROMPT_TEXT);
		expect(withPrompt).toBeDefined();
	});

	it('drops records with no usable timestamp', () => {
		const logs = decodeExportLogsServiceRequest({
			resourceLogs: [
				{
					resource: { attributes: [] },
					scopeLogs: [{ scope: { name: 's' }, logRecords: [{ severityNumber: 9 }] }],
				},
			],
		});
		expect(logs).toHaveLength(0);
	});

	it('falls back to the observed time when the explicit timestamp is "0"', () => {
		// Codex emits `timeUnixNano: "0"` and carries the real emit time in
		// `observedTimeUnixNano`; the record must land on the observed time,
		// not the Unix epoch.
		const logs = decodeExportLogsServiceRequest({
			resourceLogs: [
				{
					resource: { attributes: [] },
					scopeLogs: [
						{
							scope: { name: 's' },
							logRecords: [
								{
									severityNumber: 9,
									timeUnixNano: '0',
									observedTimeUnixNano: '1700000000000000000',
								},
							],
						},
					],
				},
			],
		});
		expect(logs).toHaveLength(1);
		expect(logs[0]?.timeUnixNano).toBe(1700000000000000000n);
	});

	it('drops records whose only timestamps are "0"', () => {
		const logs = decodeExportLogsServiceRequest({
			resourceLogs: [
				{
					resource: { attributes: [] },
					scopeLogs: [
						{
							scope: { name: 's' },
							logRecords: [{ severityNumber: 9, timeUnixNano: '0', observedTimeUnixNano: '0' }],
						},
					],
				},
			],
		});
		expect(logs).toHaveLength(0);
	});

	describe('HTTP server', () => {
		let engine: ReturnType<typeof createEngine>;
		let receiver: ReturnType<typeof createReceiver>;
		let baseUrl: string;

		beforeEach(async () => {
			engine = createEngine({ storage: createMemoryStorage() });
			receiver = createReceiver({ engine, port: 0 });
			await receiver.start();
			baseUrl = `http://${receiver.host}:${receiver.port}`;
		});

		afterEach(async () => {
			await receiver.stop();
			await engine.close();
		});

		it('ingests an OTLP/HTTP logs payload and makes content searchable', async () => {
			const res = await fetch(`${baseUrl}/v1/logs`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(FIXTURE),
			});
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ partialSuccess: {} });

			const all = await engine.listLogs({});
			expect(all.totalCount).toBeGreaterThan(0);

			// Free-text search hits the prompt attribute, not the body.
			const hit = await engine.searchLogs({ search: 'otelux-logs-fixture' });
			expect(hit.totalCount).toBeGreaterThan(0);
			expect(hit.rows.some((r) => r.attributes.prompt === PROMPT_TEXT)).toBe(true);
		});

		it('returns 400 for malformed JSON', async () => {
			const res = await fetch(`${baseUrl}/v1/logs`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{ not json',
			});
			expect(res.status).toBe(400);
		});
	});
});
