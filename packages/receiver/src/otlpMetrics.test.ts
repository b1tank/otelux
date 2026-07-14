import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEngine, createMemoryStorage } from '@otelux/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	type OtlpExportMetricsServiceRequest,
	createReceiver,
	decodeExportMetricsServiceRequest,
} from './index.js';

// Synthetic ExportMetricsServiceRequest shaped after a `codex exec` run — the
// Codex metrics pipeline is the load-bearing workload for OTelux metrics.
const FIXTURE = JSON.parse(
	readFileSync(
		fileURLToPath(new URL('../../../fixtures/sample_codex_metrics.json', import.meta.url)),
		'utf8',
	),
) as OtlpExportMetricsServiceRequest;

describe('@otelux/receiver metrics', () => {
	it('decodes the synthetic Codex-shaped ExportMetricsServiceRequest fixture', () => {
		const metrics = decodeExportMetricsServiceRequest(FIXTURE);
		expect(metrics.length).toBe(3);
		const first = metrics[0];
		expect(first?.resource.attributes['service.name']).toBe('codex');
		expect(first?.scope.name).toBe('codex');
	});

	it('decodes a monotonic delta Sum with its data points', () => {
		const metrics = decodeExportMetricsServiceRequest(FIXTURE);
		const apiRequest = metrics.find((m) => m.name === 'codex.api_request');
		expect(apiRequest?.type).toBe('sum');
		if (apiRequest?.type !== 'sum') {
			throw new Error('expected a sum');
		}
		expect(apiRequest.isMonotonic).toBe(true);
		// 1 = delta temporality.
		expect(apiRequest.temporality).toBe(1);
		expect(apiRequest.unit).toBe('{request}');
		expect(apiRequest.dataPoints).toHaveLength(2);
		// int64 value rides as a string on the wire; decoded to a number.
		expect(apiRequest.dataPoints[0]?.value).toBe(1);
		expect(apiRequest.dataPoints[1]?.value).toBe(2);
		expect(apiRequest.dataPoints[0]?.attributes['http.response.status_code']).toBe(200n);
	});

	it('decodes a Histogram with bucket counts and bounds', () => {
		const metrics = decodeExportMetricsServiceRequest(FIXTURE);
		const duration = metrics.find((m) => m.name === 'codex.turn.e2e_duration_ms');
		expect(duration?.type).toBe('histogram');
		if (duration?.type !== 'histogram') {
			throw new Error('expected a histogram');
		}
		const dp = duration.dataPoints[0];
		expect(dp?.count).toBe(3);
		expect(dp?.sum).toBeCloseTo(4821.5);
		expect(dp?.min).toBeCloseTo(980.2);
		expect(dp?.max).toBeCloseTo(2611);
		// bucketCounts has one more entry than explicitBounds (the +∞ overflow).
		expect(dp?.bucketCounts).toEqual([0, 0, 1, 2, 0]);
		expect(dp?.explicitBounds).toEqual([100, 500, 1000, 5000]);
	});

	it('drops metrics with no name and unmodelled instrument kinds', () => {
		const metrics = decodeExportMetricsServiceRequest({
			resourceMetrics: [
				{
					resource: { attributes: [] },
					scopeMetrics: [
						{
							scope: { name: 's' },
							metrics: [
								{ sum: { dataPoints: [] } },
								{ name: 'unmodelled', summary: { dataPoints: [] } } as never,
							],
						},
					],
				},
			],
		});
		expect(metrics).toHaveLength(0);
	});

	it('falls back to startTimeUnixNano when the explicit point time is "0"', () => {
		// Mirrors the lenient timestamp handling logs need for Codex.
		const metrics = decodeExportMetricsServiceRequest({
			resourceMetrics: [
				{
					resource: { attributes: [] },
					scopeMetrics: [
						{
							scope: { name: 's' },
							metrics: [
								{
									name: 'g',
									gauge: {
										dataPoints: [
											{
												timeUnixNano: '0',
												startTimeUnixNano: '1700000000000000000',
												asDouble: 1.5,
											},
										],
									},
								},
							],
						},
					],
				},
			],
		});
		expect(metrics).toHaveLength(1);
		const m = metrics[0];
		if (m?.type !== 'gauge') {
			throw new Error('expected a gauge');
		}
		expect(m.dataPoints[0]?.timeUnixNano).toBe(1700000000000000000n);
		expect(m.dataPoints[0]?.value).toBeCloseTo(1.5);
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

		it('ingests an OTLP/HTTP metrics payload and exposes instruments', async () => {
			const res = await fetch(`${baseUrl}/v1/metrics`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(FIXTURE),
			});
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ partialSuccess: {} });

			const all = await engine.listMetrics({});
			expect(all.totalCount).toBe(3);
			expect(all.rows.map((m) => m.name)).toContain('codex.api_request');
		});

		it('merges repeated exports of the same instrument into one series', async () => {
			await fetch(`${baseUrl}/v1/metrics`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(FIXTURE),
			});
			await fetch(`${baseUrl}/v1/metrics`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(FIXTURE),
			});
			// Still three instruments, but each accumulated its points twice.
			const all = await engine.listMetrics({});
			expect(all.totalCount).toBe(3);
			const apiRequest = all.rows.find((m) => m.name === 'codex.api_request');
			if (apiRequest?.type !== 'sum') {
				throw new Error('expected a sum');
			}
			expect(apiRequest.dataPoints).toHaveLength(4);
		});

		it('returns 400 for malformed JSON', async () => {
			const res = await fetch(`${baseUrl}/v1/metrics`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{ not json',
			});
			expect(res.status).toBe(400);
		});
	});
});
