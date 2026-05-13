import { describe, expect, it } from 'vitest';
import { OTELUX_TYPES_VERSION, type Span, SpanKind, SpanStatusCode } from './index.js';

describe('@otelux/types', () => {
	it('exposes SpanKind values matching the OTLP proto', () => {
		expect(SpanKind.Unspecified).toBe(0);
		expect(SpanKind.Internal).toBe(1);
		expect(SpanKind.Server).toBe(2);
		expect(SpanKind.Client).toBe(3);
		expect(SpanKind.Producer).toBe(4);
		expect(SpanKind.Consumer).toBe(5);
	});

	it('exposes SpanStatusCode values matching the OTLP proto', () => {
		expect(SpanStatusCode.Unset).toBe(0);
		expect(SpanStatusCode.Ok).toBe(1);
		expect(SpanStatusCode.Error).toBe(2);
	});

	it('Span type composes resource, scope, and attributes', () => {
		const span: Span = {
			traceId: '00000000000000000000000000000001',
			spanId: '0000000000000001',
			name: 'GET /',
			kind: SpanKind.Server,
			startTimeUnixNano: 1_700_000_000_000_000_000n,
			endTimeUnixNano: 1_700_000_000_500_000_000n,
			status: { code: SpanStatusCode.Ok },
			attributes: { 'http.method': 'GET' },
			resource: { attributes: { 'service.name': 'web' } },
			scope: { name: 'test' },
		};
		expect(span.resource.attributes['service.name']).toBe('web');
	});

	it('exports a version constant', () => {
		expect(OTELUX_TYPES_VERSION).toBe('0.0.0');
	});
});
