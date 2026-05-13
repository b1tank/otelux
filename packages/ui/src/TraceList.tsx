/**
 * Trace list. Shows the most recent traces sorted by start time desc.
 *
 * Re-fetches when the DataSource notifies. No virtualization yet — for
 * the Milestone 1 desktop workload (hundreds of traces in a session) a
 * native scroll container performs well; we revisit when a heavier load
 * arrives.
 */

import type { DataSource, ListTracesResultRow } from '@otelux/protocol';
import type { TraceId } from '@otelux/types';
import type { JSX } from 'react';
import { colorForService, formatDuration, formatWallClock } from './format.js';
import { useDataSourceQuery } from './useDataSourceQuery.js';

export interface TraceListProps {
	dataSource: DataSource;
	selectedTraceId?: TraceId;
	onSelect: (traceId: TraceId) => void;
}

export function TraceList(props: TraceListProps): JSX.Element {
	const { dataSource, selectedTraceId, onSelect } = props;
	const query = useDataSourceQuery(
		dataSource,
		(ds) => ds.listTraces({ limit: 200, sortBy: 'startTime', sortDirection: 'desc' }),
		'list:200',
	);

	const rows = query.value?.rows ?? [];

	return (
		<section className="otelux-trace-list" aria-label="Traces">
			<header className="otelux-trace-list__header">
				<span className="otelux-trace-list__title">Traces</span>
				<span className="otelux-trace-list__count">{query.value?.totalCount ?? 0}</span>
			</header>
			<div className="otelux-trace-list__body">
				{query.loading && rows.length === 0 ? (
					<div className="otelux-trace-list__empty">Waiting for traces…</div>
				) : rows.length === 0 ? (
					<div className="otelux-trace-list__empty">
						No traces yet. Point an OTel exporter at
						<br />
						<code>http://localhost:4318/v1/traces</code>
					</div>
				) : (
					<ul className="otelux-trace-list__rows">
						{rows.map((row) => (
							<TraceRow
								key={row.traceId}
								row={row}
								selected={row.traceId === selectedTraceId}
								onSelect={onSelect}
							/>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

interface TraceRowProps {
	row: ListTracesResultRow;
	selected: boolean;
	onSelect: (traceId: TraceId) => void;
}

function TraceRow(props: TraceRowProps): JSX.Element {
	const { row, selected, onSelect } = props;
	return (
		<li className={`otelux-trace-row${selected ? ' otelux-trace-row--selected' : ''}`}>
			<button
				type="button"
				className="otelux-trace-row__button"
				onClick={() => onSelect(row.traceId)}
				aria-pressed={selected}
			>
				<div className="otelux-trace-row__top">
					<span className="otelux-trace-row__time">{formatWallClock(row.startTimeUnixNano)}</span>
					<span className="otelux-trace-row__duration">{formatDuration(row.durationNanos)}</span>
				</div>
				<div className="otelux-trace-row__name">{row.rootName || '(unnamed)'}</div>
				<div className="otelux-trace-row__meta">
					<ServiceChips services={row.services} />
					<span className="otelux-trace-row__spans">{row.spanCount} spans</span>
					{row.errorCount > 0 && <span className="otelux-trace-row__errors">{row.errorCount} err</span>}
				</div>
			</button>
		</li>
	);
}

function ServiceChips(props: { services: readonly string[] }): JSX.Element {
	const visible = props.services.slice(0, 3);
	const overflow = props.services.length - visible.length;
	return (
		<span className="otelux-service-chips">
			{visible.map((s) => (
				<span key={s} className="otelux-service-chip" style={{ backgroundColor: colorForService(s) }}>
					{s}
				</span>
			))}
			{overflow > 0 && (
				<span className="otelux-service-chip otelux-service-chip--more">+{overflow}</span>
			)}
		</span>
	);
}
