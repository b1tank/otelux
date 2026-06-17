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
import { fireEvent, render, waitFor } from '@testing-library/react';
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

	it('groups instruments in a meter tree with a focused instrument', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum(), makeHistogram()];
		const { findAllByText, container } = render(<MetricsView dataSource={ds} />);
		await findAllByText('codex.api_request');
		expect(container.querySelector('.otelux-metrics-nav')).toBeTruthy();
		expect(container.querySelectorAll('.otelux-metrics-tree__instrument').length).toBe(2);
		expect(container.querySelectorAll('.otelux-metric').length).toBe(1);
		expect(container.textContent).toContain('Counter');
		expect(container.textContent).toContain('Histogram');
	});

	it('shows a meter instrument table when selecting a meter', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum(), makeHistogram()];
		const { findAllByText, container } = render(<MetricsView dataSource={ds} />);
		await findAllByText('codex.api_request');
		const meterButton = container.querySelector<HTMLButtonElement>('.otelux-metrics-tree__meter');
		if (!meterButton) {
			throw new Error('expected a meter button');
		}
		fireEvent.click(meterButton);
		expect(container.querySelector('.otelux-meter-overview__table')).toBeTruthy();
		expect(container.textContent).toContain('Name');
		expect(container.textContent).toContain('Latest');
		expect(container.textContent).toContain('Updated');
	});

	it('renders scan summary fields and metric actions', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum()];
		const { findAllByText, getByLabelText, container } = render(<MetricsView dataSource={ds} />);
		await findAllByText('codex.api_request');
		expect(container.textContent).toContain('Latest');
		expect(container.textContent).toContain('Updated');
		expect(container.textContent).toContain('Points');
		expect(getByLabelText('Copy metric name codex.api_request')).toBeTruthy();
		expect(getByLabelText('Copy metric data codex.api_request')).toBeTruthy();
		expect(getByLabelText('View metric details codex.api_request')).toBeTruthy();
	});

	it('opens a metric details drawer', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum()];
		const { findAllByText, getByLabelText, getByRole } = render(<MetricsView dataSource={ds} />);
		await findAllByText('codex.api_request');
		fireEvent.click(getByLabelText('View metric details codex.api_request'));
		const dialog = getByRole('dialog');
		expect(dialog.textContent).toContain('Instrument');
		expect(dialog.textContent).toContain('Data points');
		expect(dialog.textContent).toContain('Counter');
		fireEvent.click(getByRole('button', { name: /Resource/i }));
		expect(dialog.textContent).toContain('service.name');
	});

	it('renders focused line and histogram charts from tree selection', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum(), makeHistogram()];
		const { findAllByText, getByText, container } = render(<MetricsView dataSource={ds} />);
		await findAllByText('codex.api_request');
		expect(container.querySelector('.otelux-linechart')).toBeTruthy();
		expect(container.querySelector('.otelux-linechart__y-axis')).toBeTruthy();
		expect(container.querySelector('.otelux-linechart__x-axis')).toBeTruthy();
		fireEvent.click(getByText('codex.turn.e2e_duration_ms'));
		expect(container.querySelector('.otelux-histogram')).toBeTruthy();
	});

	it('aggregates scalar chart points that share an export timestamp', async () => {
		const ds = new FakeDataSource();
		ds.rows = [
			makeSum({
				dataPoints: [
					{
						timeUnixNano: 1_768_000_000_000_000_000n,
						value: 3,
						attributes: { status: 'ok' },
					},
					{
						timeUnixNano: 1_768_000_000_000_000_000n,
						value: 4,
						attributes: { status: 'error' },
					},
					{
						timeUnixNano: 1_768_000_001_000_000_000n,
						value: 8,
						attributes: { status: 'ok' },
					},
					{
						timeUnixNano: 1_768_000_001_000_000_000n,
						value: 9,
						attributes: { status: 'error' },
					},
				],
			}),
		];
		const { findAllByText, container } = render(<MetricsView dataSource={ds} />);
		await findAllByText('codex.api_request');

		expect(container.querySelectorAll('.otelux-linechart__dot').length).toBe(2);
		expect(container.querySelector('.otelux-linechart__latest')?.textContent).toBe('17');
	});

	it('flips an instrument to the table view', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeSum()];
		const { findAllByText, getAllByRole, container } = render(<MetricsView dataSource={ds} />);
		await findAllByText('codex.api_request');
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
		await waitFor(() => {
			expect(ds.calls.at(-1)).toMatchObject({
				limit: 50,
				services: ['codex'],
				search: 'request',
			});
		});
	});
});
