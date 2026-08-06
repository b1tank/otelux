/** @vitest-environment jsdom */
import type { ChangeEvent, DataSource } from '@otelux/protocol';
import type { Trace, TraceId } from '@otelux/types';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSelectedTrace } from './useSelectedTrace.js';

const emptyTrace = (traceId: TraceId): Trace => ({
	traceId,
	spans: [],
	startTimeUnixNano: 0n,
	endTimeUnixNano: 0n,
	durationNanos: 0n,
	services: [],
	spanCount: 0,
	errorCount: 0,
});

class TraceDataSource implements DataSource {
	readonly kind = 'otelux/datasource' as const;
	readonly calls: TraceId[] = [];
	private readonly listeners = new Set<(event: ChangeEvent) => void>();
	blockRefresh = false;
	resolveRefresh: (() => void) | undefined;
	async getTrace(query: { traceId: TraceId }): Promise<Trace> {
		this.calls.push(query.traceId);
		if (this.blockRefresh) {
			await new Promise<void>((resolve) => {
				this.resolveRefresh = resolve;
			});
		}
		return emptyTrace(query.traceId);
	}
	listTraces = async () => ({ rows: [], totalCount: 0 });
	getSpanDetails = async () => {
		throw new Error('unused');
	};
	listLogs = async () => ({ rows: [], totalCount: 0 });
	getLogDetails = async () => {
		throw new Error('unused');
	};
	listMetricInstruments = async () => ({ rows: [], totalCount: 0 });
	getMetricPoints = async () => {
		throw new Error('unused');
	};
	listResourceFacets = async () => ({ rows: [] });
	emit(event: ChangeEvent): void {
		for (const listener of this.listeners) listener(event);
	}
	subscribe = (handler: (event: ChangeEvent) => void) => {
		this.listeners.add(handler);
		return { dispose: () => this.listeners.delete(handler) };
	};
}

function Probe(props: { dataSource: DataSource; traceId: TraceId }): JSX.Element {
	const state = useSelectedTrace(props.dataSource, props.traceId, true);
	return <output>{state.trace?.traceId ?? (state.loading ? 'loading' : 'empty')}</output>;
}

describe('useSelectedTrace', () => {
	it('coalesces same-turn selections to the latest request', async () => {
		const dataSource = new TraceDataSource();
		const { rerender, getByText } = render(
			<Probe dataSource={dataSource} traceId={'a' as TraceId} />,
		);
		act(() => {
			for (let index = 0; index < 50; index++) {
				rerender(<Probe dataSource={dataSource} traceId={`trace-${index}` as TraceId} />);
			}
		});
		await waitFor(() => expect(getByText('trace-49')).toBeTruthy());
		expect(dataSource.calls).toEqual(['trace-49']);
	});

	it('keeps the selected trace visible during a live refresh', async () => {
		const dataSource = new TraceDataSource();
		const { getByText } = render(<Probe dataSource={dataSource} traceId={'a' as TraceId} />);
		await waitFor(() => expect(getByText('a')).toBeTruthy());
		dataSource.blockRefresh = true;
		act(() => dataSource.emit({ kind: 'tracesChanged', traceIds: ['a'] }));
		expect(getByText('a')).toBeTruthy();
		act(() => dataSource.resolveRefresh?.());
		await waitFor(() => expect(dataSource.calls).toEqual(['a', 'a']));
	});

	it('serves back-and-forth selection from its recent cache', async () => {
		const dataSource = new TraceDataSource();
		const { rerender, getByText } = render(
			<Probe dataSource={dataSource} traceId={'a' as TraceId} />,
		);
		await waitFor(() => expect(getByText('a')).toBeTruthy());
		rerender(<Probe dataSource={dataSource} traceId={'b' as TraceId} />);
		await waitFor(() => expect(getByText('b')).toBeTruthy());
		rerender(<Probe dataSource={dataSource} traceId={'a' as TraceId} />);
		expect(getByText('a')).toBeTruthy();
		expect(dataSource.calls).toEqual(['a', 'b']);
	});
});
