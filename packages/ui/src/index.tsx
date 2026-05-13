/**
 * `@otelux/ui` — composed React workbench.
 *
 * `OTeluxWorkbench` is the single entry point hosts (Electron renderer,
 * vscode webview, vscode-dev workbench) mount. It owns the trace-list /
 * waterfall / span-detail layout and consumes any `DataSource`.
 */

import type { DataSource } from '@otelux/protocol';
import type { Span, SpanId, Trace, TraceId } from '@otelux/types';
import { type JSX, useEffect, useState } from 'react';
import { SpanDetail } from './SpanDetail.js';
import { TraceList } from './TraceList.js';
import { Waterfall } from './Waterfall.js';
import { useDataSourceQuery } from './useDataSourceQuery.js';

export { SpanDetail } from './SpanDetail.js';
export { TraceList } from './TraceList.js';
export { Waterfall } from './Waterfall.js';
export { useDataSourceQuery } from './useDataSourceQuery.js';
export { colorForService, formatDuration, formatWallClock } from './format.js';

export interface OTeluxWorkbenchProps {
	dataSource: DataSource;
	theme?: 'dark' | 'light';
}

export function OTeluxWorkbench(props: OTeluxWorkbenchProps): JSX.Element {
	const { dataSource, theme = 'dark' } = props;
	const [selectedTraceId, setSelectedTraceIdRaw] = useState<TraceId | undefined>(undefined);
	const [selectedSpanId, setSelectedSpanId] = useState<SpanId | undefined>(undefined);

	// Switching traces always clears the span selection so the detail
	// panel doesn't render a span that no longer belongs to the trace.
	const setSelectedTraceId = (id: TraceId): void => {
		setSelectedTraceIdRaw(id);
		setSelectedSpanId(undefined);
	};

	const traceQuery = useDataSourceQuery<Trace | undefined>(
		dataSource,
		async (ds) => {
			if (!selectedTraceId) {
				return undefined;
			}
			return ds.getTrace({ traceId: selectedTraceId });
		},
		`trace:${selectedTraceId ?? ''}`,
	);

	const trace = traceQuery.value;

	// Auto-select the root span when a new trace lands so the detail
	// panel is never blank if the user clicked a trace row.
	useEffect(() => {
		if (trace && !selectedSpanId && trace.rootSpan) {
			setSelectedSpanId(trace.rootSpan.spanId);
		}
	}, [trace, selectedSpanId]);

	const selectedSpan: Span | undefined = trace?.spans.find((s) => s.spanId === selectedSpanId);

	return (
		<div className="otelux-workbench" data-theme={theme} data-source={dataSource.kind}>
			<aside className="otelux-workbench__sidebar">
				<TraceList
					dataSource={dataSource}
					{...(selectedTraceId !== undefined ? { selectedTraceId } : {})}
					onSelect={setSelectedTraceId}
				/>
			</aside>
			<main className="otelux-workbench__main">
				{trace && trace.spans.length > 0 ? (
					<Waterfall
						trace={trace}
						{...(selectedSpanId !== undefined ? { selectedSpanId } : {})}
						onSpanSelect={setSelectedSpanId}
					/>
				) : (
					<div className="otelux-workbench__placeholder">
						{selectedTraceId ? 'Loading trace…' : 'Select a trace from the list to view its waterfall.'}
					</div>
				)}
			</main>
			<aside className="otelux-workbench__inspector">
				{selectedSpan ? (
					<SpanDetail span={selectedSpan} />
				) : (
					<div className="otelux-workbench__placeholder">
						{trace ? 'Select a span to inspect its attributes.' : 'No span selected.'}
					</div>
				)}
			</aside>
		</div>
	);
}

export const OTELUX_UI_VERSION = '0.1.0' as const;
