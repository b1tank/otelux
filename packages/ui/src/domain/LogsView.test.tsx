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
	ListTracesQuery,
	ListTracesResult,
	SpanDetails,
} from '@otelux/protocol';
import type { LogRecord, Trace } from '@otelux/types';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogsView } from './LogsView.js';

function makeLog(over: Partial<LogRecord> = {}): LogRecord {
	return {
		timeUnixNano: 1_768_000_000_000_000_000n,
		severityNumber: 9,
		severityText: 'INFO',
		body: 'hello world',
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
	subscribe(_handler: (e: ChangeEvent) => void): { dispose(): void } {
		return { dispose: () => {} };
	}
}

describe('LogsView', () => {
	it('renders the empty state when there are no logs', async () => {
		const ds = new FakeDataSource();
		const { findByText } = render(<LogsView dataSource={ds} />);
		await findByText(/No logs match/i);
	});

	it('renders a row per log with severity, service and message', async () => {
		const ds = new FakeDataSource();
		ds.rows = [makeLog(), makeLog({ severityNumber: 17, severityText: 'ERROR', body: 'boom' })];
		const { findByText, container } = render(<LogsView dataSource={ds} />);
		await findByText('hello world');
		const rows = container.querySelectorAll('.otelux-log-row');
		expect(rows.length).toBe(2);
		expect(container.textContent).toContain('codex_exec');
		expect(container.querySelector('.otelux-log-row--error')).toBeTruthy();
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
		await Promise.resolve();
		const q = ds.calls.at(-1);
		expect(q).toMatchObject({
			limit: 50,
			minSeverity: 13,
			services: ['codex_exec'],
			search: 'boom',
			sortBy: 'time',
			sortDirection: 'desc',
		});
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
