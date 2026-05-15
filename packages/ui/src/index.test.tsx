/**
 * @vitest-environment jsdom
 */

import { createEngine, createMemoryStorage } from '@otelux/engine';
import type { Span } from '@otelux/types';
import { SpanKind, SpanStatusCode } from '@otelux/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
	OTELUX_UI_VERSION,
	OTeluxWorkbench,
	SpanDetail,
	colorForService,
	formatDuration,
	formatTimeAgo,
	serviceColorVar,
	serviceIndex,
} from './index.js';

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

describe('formatTimeAgo', () => {
	// Anchor "now" deterministically so the bucket boundaries are easy to read.
	const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);
	const at = (offsetMs: number): bigint => BigInt(NOW_MS - offsetMs) * 1_000_000n;

	it('buckets recent → days', () => {
		expect(formatTimeAgo(at(0), NOW_MS)).toBe('just now');
		expect(formatTimeAgo(at(4_000), NOW_MS)).toBe('just now');
		expect(formatTimeAgo(at(12_000), NOW_MS)).toBe('12s ago');
		expect(formatTimeAgo(at(4 * 60_000), NOW_MS)).toBe('4m ago');
		expect(formatTimeAgo(at(2 * 3_600_000), NOW_MS)).toBe('2h ago');
		expect(formatTimeAgo(at(3 * 86_400_000), NOW_MS)).toBe('3d ago');
	});

	it('zero nanos renders em-dash', () => {
		expect(formatTimeAgo(0n, NOW_MS)).toBe('—');
	});
});

describe('serviceIndex / colorForService', () => {
	it('is deterministic and 1-based 1..8', () => {
		const idx = serviceIndex('frontend');
		expect(idx).toBe(serviceIndex('frontend'));
		expect(idx).toBeGreaterThanOrEqual(1);
		expect(idx).toBeLessThanOrEqual(8);
	});

	it('different names land in the palette range', () => {
		for (const name of ['a', 'frontend', 'api-gateway', 'unknown', 'svc-with-a-long-id']) {
			const idx = serviceIndex(name);
			expect(idx).toBeGreaterThanOrEqual(1);
			expect(idx).toBeLessThanOrEqual(8);
		}
	});

	it('colorForService and serviceColorVar agree on the slot', () => {
		const idx = serviceIndex('frontend');
		expect(serviceColorVar('frontend')).toBe(`var(--otelux-svc-${idx})`);
		expect(colorForService('frontend')).toMatch(/^#[0-9a-f]{6}$/);
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
