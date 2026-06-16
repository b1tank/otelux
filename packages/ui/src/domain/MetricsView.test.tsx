/**
 * @vitest-environment jsdom
 */

import type {
	ChangeEvent,
	DataSource,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListLogsQuery,
	ListLogsResult,
	ListMetricsQuery,
	ListMetricsResult,
	ListTracesQuery,
	ListTracesResult,
	SpanDetails,
} from '@otelux/protocol';
import type { HistogramMetric, Metric, SumMetric, Trace } from '@otelux/types';
import { AggregationTemporality } from '@otelux/types';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricsView } from './MetricsView.js';

function makeSum(over: Partial<SumMetric> = {}): SumMetric {
	return {
		type: 'sum',
		name: 'codex.api_request',
		isMonotonic: true,
		temporality: AggregationTemporality.Delta,
		resource: { attributes: { 'service.name': 'codex' } },
		scope: { name: 'codex', version: '1.0.0' },
		dataPoints: [
			{
				timeUnixNano: 1_768_000_000_000_000_000n,
				value: 3,
				attributes: { status: 'ok' },
			},
			{
				timeUnixNano: 1_768_000_001_000_000_000n,
				value: 7,
				attributes: { status: 'ok' },
			},
		],
		...over,
	};
}

function makeHistogram(over: Partial<HistogramMetric> = {}): HistogramMetric {
	return {
		type: 'histogram',
		name: 'codex.turn.e2e_duration_ms',
		temporality: AggregationTemporality.Delta,
		resource: { attributes: { 'service.name': 'codex' } },
		scope: { name: 'codex' },
		dataPoints: [
			{
				timeUnixNano: 1_768_000_000_000_000_000n,
				count: 3,
				sum: 1234,
				bucketCounts: [0, 0, 1, 2, 0],
				explicitBounds: [100, 500, 1000, 5000],
				attributes: {},
			},
		],
		...over,
	};
}

class FakeDataSource implements DataSource {
	readonly kind = 'otelux/datasource' as const;
	calls: ListMetricsQuery[] = [];
	rows: readonly Metric[] = [];

	listTraces(_query: ListTracesQuery): Promise<ListTracesResult> {
		return Promise.resolve({ rows: [], totalCount: 0 });
	}
	getTrace(_query: GetTraceQuery): Promise<Trace> {
		throw new Error('not used');
	}
	getSpanDetails(_query: GetSpanDetailsQuery): Promise<SpanDetails> {
		throw new Error('not used');
	}
	listLogs(_query: ListLogsQuery): Promise<ListLogsResult> {
		return Promise.resolve({ rows: [], totalCount: 0 });
	}
	listMetrics(query: ListMetricsQuery): Promise<ListMetricsResult> {
		this.calls.push(query);
		return Promise.resolve({ rows: this.rows, totalCount: this.rows.length });
	}
	subscribe(_handler: (e: ChangeEvent) => void): { dispose(): void } {
		return { dispose: () => {} };
	}
}

describe('MetricsView', () => {
	it('renders the empty state when there are no metrics', async () => {
		const ds = new FakeDataSource();
		const { findByText } = render(<MetricsView dataSource={ds} />);
		await findByText(/No metrics match/i);
	});

	it('groups instruments under their meter with a kind badge', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum(), makeHistogram()];
		const { findByText, container } = render(<MetricsView dataSource={ds} />);
		await findByText('codex.api_request');
		expect(container.querySelector('.otelux-meter')).toBeTruthy();
		const cards = container.querySelectorAll('.otelux-metric');
		expect(cards.length).toBe(2);
		expect(container.textContent).toContain('Counter');
		expect(container.textContent).toContain('Histogram');
	});

	it('renders a line chart for scalar instruments and a histogram for distributions', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum(), makeHistogram()];
		const { findByText, container } = render(<MetricsView dataSource={ds} />);
		await findByText('codex.api_request');
		expect(container.querySelector('.otelux-linechart')).toBeTruthy();
		expect(container.querySelector('.otelux-histogram')).toBeTruthy();
	});

	it('flips an instrument to the table view', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum()];
		const { findByText, getAllByRole, container } = render(<MetricsView dataSource={ds} />);
		await findByText('codex.api_request');
		const tableButton = getAllByRole('button', { name: 'Table' })[0];
		if (!tableButton) {
			throw new Error('expected a Table toggle');
		}
		fireEvent.click(tableButton);
		expect(container.querySelector('.otelux-metric-table')).toBeTruthy();
		expect(container.textContent).toContain('status=ok');
	});

	it('forwards filters to the data source query', async () => {
		const ds = new FakeDataSource();
		render(<MetricsView dataSource={ds} services={['codex']} search="request" limit={50} />);
		await Promise.resolve();
		const q = ds.calls.at(-1);
		expect(q).toMatchObject({
			limit: 50,
			services: ['codex'],
			search: 'request',
		});
	});
});
