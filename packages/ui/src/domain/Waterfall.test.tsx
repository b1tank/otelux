/**
 * @vitest-environment jsdom
 */

import { type Span, SpanKind, SpanStatusCode, type Trace } from '@otelux/types';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Waterfall } from './Waterfall.js';

function makeSpan(over: Partial<Span> & { name: string; spanId: string }): Span {
	const start = over.startTimeUnixNano ?? 0n;
	const end = over.endTimeUnixNano ?? start + 1_000_000n;
	const base: Span = {
		traceId: 'trace-1',
		spanId: over.spanId,
		name: over.name,
		kind: over.kind ?? SpanKind.Internal,
		startTimeUnixNano: start,
		endTimeUnixNano: end,
		status: over.status ?? { code: SpanStatusCode.Unset },
		attributes: over.attributes ?? {},
		resource: over.resource ?? { attributes: { 'service.name': 'frontend' } },
		scope: over.scope ?? { name: 'test' },
	};
	return over.parentSpanId !== undefined ? { ...base, parentSpanId: over.parentSpanId } : base;
}

function makeTrace(spans: readonly Span[]): Trace {
	const first = spans[0];
	if (!first) {
		throw new Error('makeTrace requires at least one span');
	}
	let start = first.startTimeUnixNano;
	let end = first.endTimeUnixNano;
	for (const s of spans) {
		if (s.startTimeUnixNano < start) {
			start = s.startTimeUnixNano;
		}
		if (s.endTimeUnixNano > end) {
			end = s.endTimeUnixNano;
		}
	}
	const root = spans.find((s) => s.parentSpanId === undefined);
	const base: Trace = {
		traceId: 'trace-1',
		spans,
		startTimeUnixNano: start,
		endTimeUnixNano: end,
		durationNanos: end - start,
		services: ['frontend'],
		spanCount: spans.length,
		errorCount: spans.filter((s) => s.status.code === SpanStatusCode.Error).length,
	};
	return root ? { ...base, rootSpan: root } : base;
}

describe('Waterfall', () => {
	it('renders the empty state when the trace has no spans', () => {
		const trace: Trace = {
			traceId: 'trace-empty',
			spans: [],
			startTimeUnixNano: 0n,
			endTimeUnixNano: 0n,
			durationNanos: 0n,
			services: [],
			spanCount: 0,
			errorCount: 0,
		};
		const { getByText } = render(<Waterfall trace={trace} onSpanSelect={() => {}} />);
		expect(getByText(/Trace is empty/i)).toBeTruthy();
	});

	it('renders one row per span and a ruler', () => {
		const root = makeSpan({
			spanId: 'root',
			name: 'GET /',
			startTimeUnixNano: 0n,
			endTimeUnixNano: 10_000_000n,
		});
		const child = makeSpan({
			spanId: 'c1',
			parentSpanId: 'root',
			name: 'db.query',
			startTimeUnixNano: 2_000_000n,
			endTimeUnixNano: 6_000_000n,
		});
		const trace = makeTrace([root, child]);
		const { container, getByLabelText } = render(<Waterfall trace={trace} onSpanSelect={() => {}} />);
		expect(getByLabelText(/Span waterfall/i)).toBeTruthy();
		const rows = container.querySelectorAll('.otelux-waterfall__row');
		expect(rows.length).toBe(2);
		const ruler = container.querySelector('.otelux-waterfall__ruler');
		expect(ruler).toBeTruthy();
		const ticks = container.querySelectorAll('.otelux-waterfall__ruler-tick');
		// 10ms / target 5 => 2ms step => ticks at 0, 2, 4, 6, 8, 10
		expect(ticks.length).toBe(6);
	});

	it('labels the inspected trace as selected during live ingest', () => {
		const trace = makeTrace([makeSpan({ spanId: 'root', name: 'GET /' })]);
		const { getByText } = render(<Waterfall trace={trace} onSpanSelect={() => {}} />);
		const badge = getByText('Selected trace');
		expect(badge.getAttribute('title')).toContain('Live arrivals update the list');
	});

	it('marks selected and error rows via class names', () => {
		const root = makeSpan({
			spanId: 'root',
			name: 'GET /',
			endTimeUnixNano: 5_000_000n,
			status: { code: SpanStatusCode.Error },
		});
		const trace = makeTrace([root]);
		const { container } = render(
			<Waterfall trace={trace} selectedSpanId="root" onSpanSelect={() => {}} />,
		);
		const row = container.querySelector('.otelux-waterfall__row');
		const cls = row?.getAttribute('class') ?? '';
		expect(cls).toContain('is-selected');
		expect(cls).toContain('is-error');
	});

	it('fires onSpanSelect with the span id when a row is clicked', () => {
		const root = makeSpan({ spanId: 'pick', name: 'pick me' });
		const trace = makeTrace([root]);
		const onSpanSelect = vi.fn();
		const { container } = render(<Waterfall trace={trace} onSpanSelect={onSpanSelect} />);
		const row = container.querySelector('.otelux-waterfall__row') as Element;
		fireEvent.click(row);
		expect(onSpanSelect).toHaveBeenCalledWith('pick');
	});
});
