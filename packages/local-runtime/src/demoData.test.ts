import { describe, expect, it } from 'vitest';
import { createDemoTelemetry } from './demoData.js';

describe('createDemoTelemetry', () => {
	it('produces a coherent sample dataset across all three signals', () => {
		const demo = createDemoTelemetry({ now: 1_800_000_000_000_000_000n, otlpPort: 9999 });
		const traceIds = new Set(demo.spans.map((span) => span.traceId));
		expect(traceIds.size).toBe(2);

		const errored = demo.spans.filter((span) => span.status.code === 2);
		expect(errored).toHaveLength(1);
		expect(errored[0]?.name).toBe('SELECT orders');
		for (const span of demo.spans) {
			expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
			expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
			expect(span.resource.attributes['otelux.sample']).toBe(true);
			expect(String(span.resource.attributes['service.name'])).toMatch(/^otelux-demo-/);
		}

		expect(demo.logs.some((log) => log.traceId !== undefined)).toBe(true);
		expect(demo.logs.some((log) => typeof log.body === 'string' && log.body.includes('9999'))).toBe(
			true,
		);
		expect(demo.logs.some((log) => log.attributes.prompt !== undefined)).toBe(true);

		expect(demo.metrics.map((metric) => metric.type).sort()).toEqual(['gauge', 'histogram', 'sum']);
		const histogram = demo.metrics.find((metric) => metric.type === 'histogram');
		if (histogram?.type === 'histogram') {
			const point = histogram.dataPoints[0];
			expect(point?.bucketCounts.length).toBe((point?.explicitBounds.length ?? 0) + 1);
		}
	});

	it('anchors spans near the provided clock', () => {
		const now = 1_800_000_000_000_000_000n;
		const demo = createDemoTelemetry({ now });
		for (const span of demo.spans) {
			expect(span.startTimeUnixNano).toBeGreaterThanOrEqual(now - 3_000_000_000n);
			expect(span.startTimeUnixNano).toBeLessThanOrEqual(now);
		}
	});
});
