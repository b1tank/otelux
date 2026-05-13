/**
 * @vitest-environment jsdom
 */

import { createEngine, createMemoryStorage } from '@otelux/engine';
import type { Span } from '@otelux/types';
import { SpanKind, SpanStatusCode } from '@otelux/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OTELUX_UI_VERSION, OTeluxWorkbench, SpanDetail, formatDuration } from './index.js';

const TRACE_ID = 'a'.repeat(32);

function makeSpan(overrides: Partial<Span> & Pick<Span, 'spanId' | 'name'>): Span {
	return {
		traceId: TRACE_ID,
		kind: SpanKind.Server,
		startTimeUnixNano: 1_700_000_000_000_000_000n,
		endTimeUnixNano: 1_700_000_000_010_000_000n,
		status: { code: SpanStatusCode.Ok },
		attributes: {},
		resource: { attributes: { 'service.name': 'api' } },
		scope: { name: 'http' },
		...overrides,
	} as Span;
}

describe('formatDuration', () => {
	it('formats nanos / micros / millis / seconds', () => {
		expect(formatDuration(500n)).toBe('500ns');
		expect(formatDuration(5_000n)).toBe('5.0µs');
		expect(formatDuration(5_000_000n)).toBe('5.0ms');
		expect(formatDuration(2_500_000_000n)).toBe('2.50s');
	});
});

describe('SpanDetail', () => {
	it('renders span name, status, kind, duration, and attributes', () => {
		const span = makeSpan({
			spanId: 'a'.repeat(16),
			name: 'GET /api/users',
			attributes: { 'http.method': 'GET', 'http.status_code': 200n },
		});
		const { container } = render(<SpanDetail span={span} />);
		expect(screen.getByText('GET /api/users')).not.toBeNull();
		expect(screen.getByText('Ok')).not.toBeNull();
		expect(screen.getByText('Server')).not.toBeNull();
		expect(container.textContent).toContain('http.method');
		expect(container.textContent).toContain('GET');
	});
});

describe('OTeluxWorkbench', () => {
	it('renders an empty state until traces arrive, then shows them', async () => {
		const engine = createEngine({ storage: createMemoryStorage() });
		render(<OTeluxWorkbench dataSource={engine} />);

		await waitFor(() => {
			expect(screen.getByText(/no traces yet/i)).not.toBeNull();
		});

		await engine.ingestSpans([makeSpan({ spanId: '1'.repeat(16), name: 'GET /' })]);

		await waitFor(() => {
			expect(screen.getByText('GET /')).not.toBeNull();
		});

		await engine.close();
	});

	it('shows the waterfall after selecting a trace', async () => {
		const engine = createEngine({ storage: createMemoryStorage() });
		await engine.ingestSpans([
			makeSpan({ spanId: 'r'.repeat(16), name: 'root' }),
			makeSpan({
				spanId: 'c'.repeat(16),
				parentSpanId: 'r'.repeat(16),
				name: 'child',
			}),
		]);

		render(<OTeluxWorkbench dataSource={engine} />);

		const row = await screen.findByText('root');
		fireEvent.click(row);

		await waitFor(() => {
			// "root" appears in trace list and waterfall header — accept either.
			expect(screen.getAllByText('root').length).toBeGreaterThanOrEqual(1);
			expect(screen.getByText('child')).not.toBeNull();
		});

		await engine.close();
	});

	it('exports a version constant', () => {
		expect(OTELUX_UI_VERSION).toBe('0.1.0');
	});
});
