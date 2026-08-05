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
import type { Trace } from '@otelux/types';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDataSourceQuery } from './useDataSourceQuery.js';

class DeferredTraceSource implements DataSource {
	readonly kind = 'otelux/datasource' as const;
	readonly pending: Array<(result: ListTracesResult) => void> = [];
	calls = 0;
	private readonly handlers = new Set<(event: ChangeEvent) => void>();

	listTraces(_query: ListTracesQuery): Promise<ListTracesResult> {
		this.calls++;
		return new Promise((resolve) => this.pending.push(resolve));
	}
	getTrace(_query: GetTraceQuery): Promise<Trace> {
		throw new Error('not used');
	}
	getSpanDetails(_query: GetSpanDetailsQuery): Promise<SpanDetails> {
		throw new Error('not used');
	}
	listLogs(_query: ListLogsQuery): Promise<ListLogsResult> {
		throw new Error('not used');
	}
	getLogDetails(): Promise<never> {
		throw new Error('not used');
	}
	listMetricInstruments(): Promise<never> {
		throw new Error('not used');
	}
	getMetricPoints(): Promise<never> {
		throw new Error('not used');
	}
	listResourceFacets() {
		return Promise.reject(new Error('not used'));
	}
	subscribe(handler: (event: ChangeEvent) => void): { dispose(): void } {
		this.handlers.add(handler);
		return { dispose: () => this.handlers.delete(handler) };
	}
	notify(event: ChangeEvent): void {
		for (const handler of this.handlers) handler(event);
	}
}

function Harness({ source, enabled = true }: { source: DeferredTraceSource; enabled?: boolean }) {
	const query = useDataSourceQuery(
		source,
		(ds) => ds.listTraces({ limit: 10 }),
		'test',
		false,
		'tracesChanged',
		enabled,
	);
	return <output>{query.value?.totalCount ?? 'loading'}</output>;
}

describe('useDataSourceQuery', () => {
	it('does not fetch or subscribe while disabled', async () => {
		const source = new DeferredTraceSource();
		render(<Harness source={source} enabled={false} />);
		await Promise.resolve();
		source.notify({ kind: 'tracesChanged', traceIds: [] });
		expect(source.calls).toBe(0);
	});

	it('coalesces a burst during an in-flight query into one trailing refresh', async () => {
		const source = new DeferredTraceSource();
		const { getByText } = render(<Harness source={source} />);
		await waitFor(() => expect(source.calls).toBe(1));

		act(() => {
			for (let i = 0; i < 25; i++) {
				source.notify({ kind: 'tracesChanged', traceIds: [] });
			}
		});
		expect(source.calls).toBe(1);

		await act(async () => {
			source.pending.shift()?.({ rows: [], totalCount: 1 });
			await Promise.resolve();
		});
		await waitFor(() => expect(source.calls).toBe(2));

		await act(async () => {
			source.pending.shift()?.({ rows: [], totalCount: 2 });
			await Promise.resolve();
		});
		await waitFor(() => expect(getByText('2')).toBeTruthy());
		expect(source.calls).toBe(2);
	});

	it('ignores invalidations for other signals', async () => {
		const source = new DeferredTraceSource();
		render(<Harness source={source} />);
		await waitFor(() => expect(source.calls).toBe(1));
		act(() => {
			source.notify({ kind: 'logsChanged', count: 1 });
			source.notify({ kind: 'metricsChanged', count: 1 });
		});
		expect(source.calls).toBe(1);
	});
});
