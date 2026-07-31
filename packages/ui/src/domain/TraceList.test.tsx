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
	ListTracesResultRow,
	SpanDetails,
} from '@otelux/protocol';
import type { Trace, TraceId } from '@otelux/types';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TraceList } from './TraceList.js';

function makeRow(over: Partial<ListTracesResultRow> = {}): ListTracesResultRow {
	return {
		traceId: 'trace-a' as unknown as TraceId,
		rootName: 'GET /api/users',
		startTimeUnixNano: 1_768_000_000_000_000_000n,
		durationNanos: 12_500_000n,
		services: ['frontend', 'api'],
		spanCount: 5,
		errorCount: 0,
		...over,
	};
}

class FakeDataSource implements DataSource {
	readonly kind = 'otelux/datasource' as const;
	calls: ListTracesQuery[] = [];
	rows: readonly ListTracesResultRow[] = [];
	private handlers = new Set<(e: ChangeEvent) => void>();

	listTraces(query: ListTracesQuery): Promise<ListTracesResult> {
		this.calls.push(query);
		return Promise.resolve({ rows: this.rows, totalCount: this.rows.length });
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
	listMetrics(_query: ListMetricsQuery): Promise<ListMetricsResult> {
		return Promise.resolve({ rows: [], totalCount: 0 });
	}
	listResourceFacets() {
		return Promise.resolve({ rows: [] });
	}
	subscribe(handler: (e: ChangeEvent) => void): { dispose(): void } {
		this.handlers.add(handler);
		return { dispose: () => this.handlers.delete(handler) };
	}
	notify(event: ChangeEvent = { kind: 'tracesChanged', traceIds: [] }): void {
		for (const h of this.handlers) {
			h(event);
		}
	}
}

describe('TraceList', () => {
	it('renders the empty state when there are no rows', async () => {
		const ds = new FakeDataSource();
		const { findByText } = render(<TraceList dataSource={ds} onSelect={() => {}} />);
		await findByText(/No traces match/i);
	});

	it('shows the Load sample data button in the empty state and fires the callback', async () => {
		const ds = new FakeDataSource();
		const onLoadSampleData = vi.fn();
		const { findByText } = render(
			<TraceList dataSource={ds} onSelect={() => {}} onLoadSampleData={onLoadSampleData} />,
		);
		const button = await findByText('Load sample data');
		fireEvent.click(button);
		expect(onLoadSampleData).toHaveBeenCalledTimes(1);
	});

	it('hides the Load sample data button when a filter is active (filtered-empty)', async () => {
		const ds = new FakeDataSource();
		const { findByText, queryByText } = render(
			<TraceList
				dataSource={ds}
				onSelect={() => {}}
				onLoadSampleData={() => {}}
				search="nothing-matches"
			/>,
		);
		await findByText(/No traces match/i);
		expect(queryByText('Load sample data')).toBeNull();
	});

	it('renders a result footer with the count and live state', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeRow({ traceId: 'a' })];
		const { findByText, container } = render(<TraceList dataSource={ds} onSelect={() => {}} />);
		await findByText('GET /api/users');
		expect(container.querySelector('.otelux-result-footer')).toBeTruthy();
		expect(container.textContent).toContain('Showing 1 trace');
		expect(container.textContent).toContain('Live');
	});

	it('shows Paused in the footer when paused', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeRow({ traceId: 'a' })];
		const { findByText, container } = render(
			<TraceList dataSource={ds} onSelect={() => {}} paused />,
		);
		await findByText('GET /api/users');
		expect(container.querySelector('.otelux-result-footer__state--paused')).toBeTruthy();
		expect(container.textContent).toContain('Paused');
	});

	it('forwards sortBy and sortDirection into the data source query', async () => {
		const ds = new FakeDataSource();
		render(<TraceList dataSource={ds} onSelect={() => {}} sortBy="duration" sortDirection="asc" />);
		await waitFor(() => expect(ds.calls.length).toBe(1));
		expect(ds.calls[0]).toMatchObject({ sortBy: 'duration', sortDirection: 'asc' });
	});

	it('defaults to newest-first (startTime desc) when no sort is given', async () => {
		const ds = new FakeDataSource();
		render(<TraceList dataSource={ds} onSelect={() => {}} />);
		await waitFor(() => expect(ds.calls.length).toBe(1));
		expect(ds.calls[0]).toMatchObject({ sortBy: 'startTime', sortDirection: 'desc' });
	});

	it('refetches on a live notification when not paused', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeRow({ traceId: 'a' })];
		const { findByText } = render(<TraceList dataSource={ds} onSelect={() => {}} />);
		await findByText('GET /api/users');
		const before = ds.calls.length;
		act(() => ds.notify());
		await waitFor(() => expect(ds.calls.length).toBeGreaterThan(before));
	});

	it('does not refetch on a live notification while paused', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeRow({ traceId: 'a' })];
		const { findByText } = render(<TraceList dataSource={ds} onSelect={() => {}} paused />);
		await findByText('GET /api/users');
		const before = ds.calls.length;
		act(() => ds.notify());
		await Promise.resolve();
		expect(ds.calls.length).toBe(before);
	});

	it('ignores log and metric invalidations', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeRow({ traceId: 'a' })];
		const { findByText } = render(<TraceList dataSource={ds} onSelect={() => {}} />);
		await findByText('GET /api/users');
		const before = ds.calls.length;
		act(() => {
			ds.notify({ kind: 'logsChanged', count: 1 });
			ds.notify({ kind: 'metricsChanged', count: 1 });
		});
		await Promise.resolve();
		expect(ds.calls.length).toBe(before);
	});

	it('renders 3-line cards by default with name, duration, time and counts', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeRow({ traceId: 'a', rootName: 'GET /a', spanCount: 7, errorCount: 2 })];
		const { findByText, container } = render(<TraceList dataSource={ds} onSelect={() => {}} />);
		await findByText('GET /a');
		expect(container.querySelector('.otelux-trace-list--card')).toBeTruthy();
		// 3 row blocks per card: time+duration, name+tid, chips+counts.
		const rows = container.querySelectorAll('.otelux-trace-row__row');
		expect(rows.length).toBe(3);
		expect(container.textContent).toContain('7 spans');
		expect(container.textContent).toContain('2 err');
	});

	it('renders a single flat line per row in flat density', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeRow({ traceId: 'a' })];
		const { findByText, container } = render(
			<TraceList dataSource={ds} density="flat" onSelect={() => {}} />,
		);
		await findByText('GET /api/users');
		const rows = container.querySelectorAll('.otelux-trace-row__row');
		expect(rows.length).toBe(1);
	});

	it('forwards filter props into the data source query', async () => {
		const ds = new FakeDataSource();
		render(
			<TraceList
				dataSource={ds}
				onSelect={() => {}}
				errorsOnly
				services={['frontend']}
				search="users"
				limit={50}
			/>,
		);
		await waitFor(() => expect(ds.calls.length).toBe(1));
		expect(ds.calls[0]).toMatchObject({
			limit: 50,
			hasError: true,
			services: ['frontend'],
			search: 'users',
			sortBy: 'startTime',
			sortDirection: 'desc',
		});
	});

	it('fires onSelect with the row id when a card is clicked', async () => {
		const ds = new FakeDataSource();
		ds.rows = [
			makeRow({
				traceId: 'pick-me' as unknown as TraceId,
				rootName: 'pick me',
			}),
		];
		const onSelect = vi.fn();
		const { findByText } = render(<TraceList dataSource={ds} onSelect={onSelect} />);
		const card = await findByText('pick me');
		act(() => {
			fireEvent.click(card);
		});
		expect(onSelect).toHaveBeenCalledWith('pick-me');
	});
});
