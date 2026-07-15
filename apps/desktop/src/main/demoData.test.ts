import { describe, expect, it } from 'vitest';
import { createDemoTelemetry } from './demoData.js';

describe('createDemoTelemetry', () => {
	it('produces a coherent, clearly-sample dataset across all three signals', () => {
		const demo = createDemoTelemetry({ now: 1_800_000_000_000_000_000n, otlpPort: 9999 });

		// Two traces (a checkout flow and a health check).
		const traceIds = new Set(demo.spans.map((s) => s.traceId));
		expect(traceIds.size).toBe(2);

		// Exactly one span carries an error, and it is the DB span.
		const errored = demo.spans.filter((s) => s.status.code === 2);
		expect(errored).toHaveLength(1);
		expect(errored[0]?.name).toBe('SELECT orders');

		// IDs are well-formed hex of the right length.
		for (const s of demo.spans) {
			expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
			expect(s.spanId).toMatch(/^[0-9a-f]{16}$/);
		}

		// Every entity is labelled sample and uses an otelux-demo-* service.
		for (const s of demo.spans) {
			expect(s.resource.attributes['otelux.sample']).toBe(true);
			expect(String(s.resource.attributes['service.name'])).toMatch(/^otelux-demo-/);
		}

		// At least one log is correlated to the checkout trace.
		expect(demo.logs.some((l) => l.traceId !== undefined)).toBe(true);
		// The banner log names the live OTLP port so a user knows where to send.
		expect(demo.logs.some((l) => typeof l.body === 'string' && l.body.includes('9999'))).toBe(true);
		// A Codex-style log carries its payload in attributes (search target).
		expect(demo.logs.some((l) => l.attributes.prompt !== undefined)).toBe(true);

		// One of each instrument kind, and the histogram is internally consistent.
		const kinds = demo.metrics.map((m) => m.type).sort();
		expect(kinds).toEqual(['gauge', 'histogram', 'sum']);
		const histogram = demo.metrics.find((m) => m.type === 'histogram');
		if (histogram?.type === 'histogram') {
			const dp = histogram.dataPoints[0];
			expect(dp?.bucketCounts.length).toBe((dp?.explicitBounds.length ?? 0) + 1);
		}
	});

	it('anchors spans near the provided clock', () => {
		const now = 1_800_000_000_000_000_000n;
		const demo = createDemoTelemetry({ now });
		for (const s of demo.spans) {
			// Everything lands within the last ~3 seconds before `now`.
			expect(s.startTimeUnixNano).toBeGreaterThanOrEqual(now - 3_000_000_000n);
			expect(s.startTimeUnixNano).toBeLessThanOrEqual(now);
		}
	});
});
