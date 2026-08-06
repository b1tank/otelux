/**
 * @vitest-environment jsdom
 */

import { type Span, SpanKind, SpanStatusCode } from '@otelux/types';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpanDetail } from './SpanDetail.js';

function makeSpan(over: Partial<Span> = {}): Span {
	return {
		traceId: over.traceId ?? 'tr-1',
		spanId: over.spanId ?? 'sp-1',
		name: over.name ?? 'GET /users',
		kind: over.kind ?? SpanKind.Server,
		startTimeUnixNano: over.startTimeUnixNano ?? 1_000_000_000n,
		endTimeUnixNano: over.endTimeUnixNano ?? 1_005_000_000n,
		status: over.status ?? { code: SpanStatusCode.Ok },
		attributes: over.attributes ?? { 'http.method': 'GET', 'http.status_code': 200 },
		resource: over.resource ?? { attributes: { 'service.name': 'frontend' } },
		scope: over.scope ?? { name: 'opentelemetry-instrumentation-http', version: '1.0.0' },
		...(over.parentSpanId !== undefined ? { parentSpanId: over.parentSpanId } : {}),
		...(over.events !== undefined ? { events: over.events } : {}),
		...(over.links !== undefined ? { links: over.links } : {}),
	};
}

describe('SpanDetail', () => {
	it('renders identity facts and the default accordion sections', () => {
		const { getByText, queryByText } = render(<SpanDetail span={makeSpan()} />);
		// Identity is now hosted in the "Span" accordion (open by default).
		expect(getByText('Span')).toBeTruthy();
		expect(getByText('GET /users')).toBeTruthy();
		expect(getByText('Ok')).toBeTruthy();
		expect(getByText('Span ID')).toBeTruthy();
		expect(getByText('Trace ID')).toBeTruthy();
		expect(getByText('Attributes')).toBeTruthy();
		expect(getByText('Resource')).toBeTruthy();
		expect(getByText('Scope')).toBeTruthy();
		expect(queryByText('Events')).toBeNull();
		expect(queryByText('Links')).toBeNull();
	});

	it('opens Attributes by default and lists rows', () => {
		const { getByText } = render(<SpanDetail span={makeSpan()} />);
		expect(getByText('http.method')).toBeTruthy();
		expect(getByText('GET')).toBeTruthy();
	});

	it('renders the Events section when events are present', () => {
		const span = makeSpan({
			events: [{ name: 'cache.miss', timeUnixNano: 1_002_000_000n, attributes: { key: 'x' } }],
		});
		const { getByText } = render(<SpanDetail span={span} />);
		const eventsHead = getByText('Events').closest('button') as HTMLButtonElement;
		fireEvent.click(eventsHead);
		expect(getByText('cache.miss')).toBeTruthy();
	});

	it('renders Links when links are present', () => {
		const span = makeSpan({ links: [{ traceId: 'tr-2', spanId: 'sp-2' }] });
		const { getByText } = render(<SpanDetail span={span} />);
		fireEvent.click(getByText('Links').closest('button') as HTMLButtonElement);
		expect(getByText('tr-2')).toBeTruthy();
		expect(getByText('sp-2')).toBeTruthy();
	});

	it('surfaces onViewValue with the key and value when the eye button is clicked', () => {
		const onViewValue = vi.fn();
		const { getByLabelText } = render(<SpanDetail span={makeSpan()} onViewValue={onViewValue} />);
		fireEvent.click(getByLabelText('View value for http.method'));
		expect(onViewValue).toHaveBeenCalledWith('http.method', 'GET');
	});

	it('omits the eye buttons when no onViewValue is provided', () => {
		const { queryByLabelText } = render(<SpanDetail span={makeSpan()} />);
		expect(queryByLabelText('View value for http.method')).toBeNull();
	});

	it('filters sections and attribute rows through detail search', () => {
		const { getByLabelText, getByText, queryByText } = render(<SpanDetail span={makeSpan()} />);
		fireEvent.change(getByLabelText('Search span details'), { target: { value: 'http.method' } });
		expect(getByText('Attributes')).toBeTruthy();
		expect(getByText('http.method')).toBeTruthy();
		expect(queryByText('http.status_code')).toBeNull();
		expect(queryByText('Resource')).toBeNull();

		fireEvent.change(getByLabelText('Search span details'), { target: { value: 'missing-value' } });
		expect(getByText('No matching details.')).toBeTruthy();
		fireEvent.click(getByLabelText('Clear search'));
		expect(getByText('Resource')).toBeTruthy();
		fireEvent.change(getByLabelText('Search span details'), { target: { value: 'service.name' } });
		expect(getByText('service.name')).toBeTruthy();
	});

	it('marks an error span with the error status badge', () => {
		const span = makeSpan({ status: { code: SpanStatusCode.Error, message: 'boom' } });
		const { container, getByText } = render(<SpanDetail span={span} />);
		expect(getByText('Error')).toBeTruthy();
		expect(getByText('boom')).toBeTruthy();
		const status = container.querySelector('.otelux-span-detail__status');
		expect(status?.className).toContain('is-error');
	});
});
