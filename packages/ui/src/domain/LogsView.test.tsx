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
import type { LogRecord, Trace } from '@otelux/types';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LogsView } from './LogsView.js';

function makeLog(over: Partial<LogRecord> = {}): LogRecord {
	return {
		timeUnixNano: 1_768_000_000_000_000_000n,
		severityNumber: 9,
		severityText: 'INFO',
		body: 'hello world',
		traceId: '0123456789abcdef0123456789abcdef',
		spanId: 'abcdef0123456789',
		attributes: { 'event.name': 'codex.user_prompt', prompt: 'do the thing' },
		resource: { attributes: { 'service.name': 'codex_exec' } },
		scope: { name: 'codex', version: '1.0.0' },
		...over,
	};
}

class FakeDataSource implements DataSource {
	readonly kind = 'otelux/datasource' as const;
	calls: ListLogsQuery[] = [];
	rows: readonly LogRecord[] = [];

	listTraces(_query: ListTracesQuery): Promise<ListTracesResult> {
		return Promise.resolve({ rows: [], totalCount: 0 });
	}
	getTrace(_query: GetTraceQuery): Promise<Trace> {
		throw new Error('not used');
	}
	getSpanDetails(_query: GetSpanDetailsQuery): Promise<SpanDetails> {
		throw new Error('not used');
	}
	listLogs(query: ListLogsQuery): Promise<ListLogsResult> {
		this.calls.push(query);
		return Promise.resolve({ rows: this.rows, totalCount: this.rows.length });
	}
	listMetrics(_query: ListMetricsQuery): Promise<ListMetricsResult> {
		return Promise.resolve({ rows: [], totalCount: 0 });
	}
	subscribe(_handler: (e: ChangeEvent) => void): { dispose(): void } {
		return { dispose: () => {} };
	}
}

class PendingDataSource extends FakeDataSource {
	override listLogs(query: ListLogsQuery): Promise<ListLogsResult> {
		this.calls.push(query);
		return new Promise<ListLogsResult>(() => {});
	}
}

function expectLogHeaders(container: HTMLElement): void {
	expect(Array.from(container.querySelectorAll('th')).map((header) => header.textContent)).toEqual([
		'Level',
		'Time',
		'Service',
		'Message',
		'Trace',
		'Actions',
	]);
}

describe('LogsView', () => {
	it('keeps column headers visible while logs are loading', () => {
		const ds = new PendingDataSource();
		const { getByText, container } = render(<LogsView dataSource={ds} />);
		expectLogHeaders(container);
		expect(getByText('Waiting for logs…')).toBeTruthy();
	});

	it('renders the empty state when there are no logs', async () => {
		const ds = new FakeDataSource();
		const { findByText, container } = render(<LogsView dataSource={ds} />);
		expectLogHeaders(container);
		await findByText(/No logs match/i);
	});

	it('renders a row per log with severity, service and message', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeLog(), makeLog({ severityNumber: 17, severityText: 'ERROR', body: 'boom' })];
		const { findByText, container } = render(<LogsView dataSource={ds} />);
		await findByText('hello world');
		expectLogHeaders(container);
		const rows = container.querySelectorAll('.otelux-log-row');
		expect(rows.length).toBe(2);
		expect(container.textContent).toContain('codex_exec');
		expect(container.textContent).toContain('0123456789ab');
		expect(container.querySelector('[aria-label="Copy log message: hello world"]')).toBeTruthy();
		expect(container.querySelector('[aria-label="Copy trace ID 0123456789ab"]')).toBeTruthy();
		expect(container.querySelector('[aria-label="Copy span ID abcdef012345"]')).toBeTruthy();
		expect(container.querySelector('[aria-label="View log details: hello world"]')).toBeTruthy();
		expect(container.querySelector('.otelux-log-row--error')).toBeTruthy();
	});

	it('opens correlated traces and spans when a pivot callback is provided', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeLog()];
		const onOpenTrace = vi.fn();
		const { findByLabelText } = render(<LogsView dataSource={ds} onOpenTrace={onOpenTrace} />);

		fireEvent.click(await findByLabelText('Open trace 0123456789ab'));
		expect(onOpenTrace).toHaveBeenLastCalledWith('0123456789abcdef0123456789abcdef');

		fireEvent.click(await findByLabelText('Open span abcdef012345 in trace 0123456789ab'));
		expect(onOpenTrace).toHaveBeenLastCalledWith(
			'0123456789abcdef0123456789abcdef',
			'abcdef0123456789',
		);
	});

	it('hides correlation actions when a log has no trace context', async () => {
		const ds = new FakeDataSource();
		const { traceId: _traceId, spanId: _spanId, ...uncorrelatedLog } = makeLog();
		ds.rows = [uncorrelatedLog];
		const { findByText, queryByLabelText, container } = render(<LogsView dataSource={ds} />);
		await findByText('hello world');
		expect(queryByLabelText(/Copy trace ID/)).toBeNull();
		expect(queryByLabelText(/Copy span ID/)).toBeNull();
		expect(queryByLabelText(/Open trace|Open span/)).toBeNull();

		const actions = container.querySelector('.otelux-log-row__actions');
		expect(actions).not.toBeNull();
		expect(
			within(actions as HTMLElement).getByLabelText('Copy log message: hello world'),
		).toBeTruthy();
		expect(
			within(actions as HTMLElement).getByLabelText('View log details: hello world'),
		).toBeTruthy();
	});

	it('falls back to a prompt attribute when there is no body', async () => {
		const ds = new FakeDataSource();
		// Attribute-only event: no `body`, so the row message falls back
		// through the attribute chain (`event.name` before `prompt`).
		const { body: _body, ...noBody } = makeLog();
		ds.rows = [noBody];
		const { findByText } = render(<LogsView dataSource={ds} />);
		await findByText('codex.user_prompt');
	});

	it('forwards filters to the data source query', async () => {
		const ds = new FakeDataSource();
		render(
			<LogsView dataSource={ds} minSeverity={13} services={['codex_exec']} search="boom" limit={50} />,
		);
		await waitFor(() => {
			expect(ds.calls.at(-1)).toMatchObject({
				limit: 50,
				minSeverity: 13,
				services: ['codex_exec'],
				search: 'boom',
				sortBy: 'time',
				sortDirection: 'desc',
			});
		});
	});

	it('forwards sortBy and sortDirection into the query', async () => {
		const ds = new FakeDataSource();
		render(<LogsView dataSource={ds} sortBy="severity" sortDirection="desc" />);
		await waitFor(() =>
			expect(ds.calls.at(-1)).toMatchObject({ sortBy: 'severity', sortDirection: 'desc' }),
		);
	});

	it('opens a detail drawer with attributes when a row is clicked', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeLog()];
		const { findByText, getByRole } = render(<LogsView dataSource={ds} />);
		const hit = await findByText('hello world');
		fireEvent.click(hit);
		const dialog = getByRole('dialog');
		expect(dialog.textContent).toContain('Attributes');
		expect(dialog.textContent).toContain('do the thing');
	});
});
