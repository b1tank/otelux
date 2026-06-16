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
	subscribe(handler: (e: ChangeEvent) => void): { dispose(): void } {
		this.handlers.add(handler);
		return { dispose: () => this.handlers.delete(handler) };
	}
}

describe('TraceList', () => {
	it('renders the empty state when there are no rows', async () => {
		const ds = new FakeDataSource();
		const { findByText } = render(<TraceList dataSource={ds} onSelect={() => {}} />);
		await findByText(/No traces match/i);
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
