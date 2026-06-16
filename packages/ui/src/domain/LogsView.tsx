/**
 * `LogsView` — structured log explorer (Phase 2).
 *
 * The traces surface answers "what happened across services"; this one
 * answers "what was said" — for the Codex workload the human-readable
 * payload (user prompt, model, tool I/O) rides log *attributes*, not the
 * body, so rows surface a derived message and the detail drawer exposes
 * every attribute. Severity drives a left stripe + badge so errors are
 * scannable at a glance.
 *
 * Filtering is delegated to the data source via `ListLogsQuery`:
 *   - `minSeverity` -> severity floor
 *   - `services`    -> service names
 *   - `search`      -> free-text over body, event name, severity text,
 *                      and attribute keys/values
 *
 * Re-fetches when the DataSource notifies. No virtualization yet — current
 * local workloads (hundreds of logs) scroll fine; revisit when a heavier load
 * arrives. Layered import discipline: lives in
 * `src/domain/` and depends on `primitives` + `format.ts` + types only;
 * it MUST NOT import other domain components.
 */

import type { DataSource, ListLogsResult } from '@otelux/protocol';
import type { AttributeValue, LogRecord } from '@otelux/types';
import { type JSX, useState } from 'react';
import { formatWallClock, serviceColorVar, severityLabel, severityTone } from '../format.js';
import {
	Accordion,
	type AccordionItem,
	Drawer,
	EyeIcon,
	IconButton,
	ValueViewer,
} from '../primitives/index.js';
import { useDataSourceQuery } from '../useDataSourceQuery.js';

export interface LogsViewProps {
	dataSource: DataSource;
	/** Severity floor (OTLP severity number); rows below are excluded. */
	minSeverity?: number;
	/** Restrict to logs emitted by any of these service names. */
	services?: readonly string[];
	/** Free-text search applied by the data source. */
	search?: string;
	/** Max rows fetched. */
	limit?: number;
	/** Hint text shown in the empty state. */
	endpointUrl?: string;
}

const DEFAULT_LIMIT = 500;
const DEFAULT_ENDPOINT = 'http://localhost:4319/v1/logs';

export function LogsView(props: LogsViewProps): JSX.Element {
	const {
		dataSource,
		minSeverity,
		services,
		search,
		limit = DEFAULT_LIMIT,
		endpointUrl = DEFAULT_ENDPOINT,
	} = props;

	const [selected, setSelected] = useState<LogRecord | null>(null);
	const [viewValue, setViewValue] = useState<{ key: string; value: AttributeValue } | null>(null);

	// The serialization key must include every input that changes the
	// result set; otherwise the hook reuses a stale fetch when filters change.
	const queryKey = `logs:${limit}:${minSeverity ?? ''}:${(services ?? []).join(',')}:${search ?? ''}`;
	const query = useDataSourceQuery<ListLogsResult>(
		dataSource,
		(ds) => {
			const q: Parameters<DataSource['listLogs']>[0] = {
				limit,
				sortBy: 'time',
				sortDirection: 'desc',
			};
			if (minSeverity !== undefined) {
				q.minSeverity = minSeverity;
			}
			if (services && services.length > 0) {
				q.services = services;
			}
			if (search) {
				q.search = search;
			}
			return ds.listLogs(q);
		},
		queryKey,
	);

	const rows = query.value?.rows ?? [];

	return (
		<section className="otelux-logs" aria-label="Logs">
			<header className="otelux-logs__header">
				<span className="otelux-logs__title">Logs</span>
				<span className="otelux-logs__count">{query.value?.totalCount ?? 0}</span>
			</header>
			<div className="otelux-logs__body">
				{query.loading && rows.length === 0 ? (
					<div className="otelux-logs__empty">Waiting for logs…</div>
				) : rows.length === 0 ? (
					<div className="otelux-logs__empty">
						No logs match. Point an OTel logs exporter at
						<br />
						<code>{endpointUrl}</code>
					</div>
				) : (
					<ul className="otelux-logs__rows">
						{rows.map((log, i) => (
							<LogRow
								// Logs have no stable id; pair time + index for a stable key.
								key={`${log.timeUnixNano}:${i}`}
								log={log}
								selected={selected === log}
								onSelect={() => setSelected(log)}
							/>
						))}
					</ul>
				)}
			</div>

			<Drawer
				open={selected !== null}
				onClose={() => setSelected(null)}
				{...(selected
					? {
							title: logMessage(selected) || '(log)',
							accentVar: serviceColorVar(serviceName(selected) ?? ''),
							kindLabel: severityLabel(selected.severityNumber, selected.severityText),
						}
					: {})}
			>
				{selected ? (
					<LogDetail log={selected} onViewValue={(key, value) => setViewValue({ key, value })} />
				) : null}
			</Drawer>
			<ValueViewer
				open={viewValue !== null}
				onClose={() => setViewValue(null)}
				{...(viewValue !== null ? { title: viewValue.key, value: viewValue.value } : { value: '' })}
			/>
		</section>
	);
}

interface LogRowProps {
	log: LogRecord;
	selected: boolean;
	onSelect(): void;
}

function LogRow(props: LogRowProps): JSX.Element {
	const { log, selected, onSelect } = props;
	const tone = severityTone(log.severityNumber);
	const svc = serviceName(log);
	const rowStyle =
		svc !== undefined
			? ({ ['--otelux-row-svc' as string]: serviceColorVar(svc) } as React.CSSProperties)
			: undefined;

	return (
		<li
			className={`otelux-log-row otelux-log-row--${tone}${selected ? ' is-selected' : ''}`}
			{...(rowStyle ? { style: rowStyle } : {})}
		>
			<button type="button" className="otelux-log-row__hit" onClick={onSelect}>
				<span className={`otelux-log-row__sev otelux-log-row__sev--${tone}`}>
					{severityLabel(log.severityNumber, log.severityText)}
				</span>
				<time className="otelux-log-row__time">{formatWallClock(log.timeUnixNano)}</time>
				{svc !== undefined ? <span className="otelux-log-row__svc">{svc}</span> : null}
				<span className="otelux-log-row__msg" title={logMessage(log)}>
					{logMessage(log)}
				</span>
			</button>
		</li>
	);
}

interface LogDetailProps {
	log: LogRecord;
	onViewValue?: (key: string, value: AttributeValue) => void;
}

function LogDetail(props: LogDetailProps): JSX.Element {
	const { log, onViewValue } = props;
	const items: AccordionItem[] = [
		{
			id: 'log',
			label: 'Log',
			defaultOpen: true,
			children: <LogFacts log={log} />,
		},
		{
			id: 'attributes',
			label: 'Attributes',
			badge: <>{Object.keys(log.attributes).length}</>,
			defaultOpen: true,
			children: <AttributeTable attributes={log.attributes} onViewValue={onViewValue} />,
		},
		{
			id: 'resource',
			label: 'Resource',
			badge: <>{Object.keys(log.resource.attributes).length}</>,
			children: <AttributeTable attributes={log.resource.attributes} onViewValue={onViewValue} />,
		},
		{
			id: 'scope',
			label: 'Scope',
			children: (
				<div className="otelux-kv">
					<KVRow label="Name" value={log.scope.name || '(unnamed)'} />
					{log.scope.version !== undefined && log.scope.version !== '' ? (
						<KVRow label="Version" value={log.scope.version} />
					) : null}
				</div>
			),
		},
	];

	return (
		<section className="otelux-log-detail" aria-label="Log detail">
			<Accordion items={items} />
		</section>
	);
}

function LogFacts(props: { log: LogRecord }): JSX.Element {
	const { log } = props;
	const body = log.body;
	return (
		<div className="otelux-kv">
			<KVRow label="Severity" value={severityLabel(log.severityNumber, log.severityText)} />
			<KVRow label="Time" value={formatWallClock(log.timeUnixNano)} />
			{log.eventName !== undefined && log.eventName !== '' ? (
				<KVRow label="Event" value={log.eventName} />
			) : null}
			{body !== undefined ? <KVRow label="Body" value={renderAttributeValue(body)} /> : null}
			{/* Trace correlation: present when the log was emitted inside an
			    active span context, which lets the user pivot to the trace. */}
			{log.traceId !== undefined ? <KVRow label="Trace ID" value={log.traceId} mono /> : null}
			{log.spanId !== undefined ? <KVRow label="Span ID" value={log.spanId} mono /> : null}
		</div>
	);
}

function KVRow(props: { label: string; value: string; mono?: boolean }): JSX.Element {
	return (
		<div className="otelux-kv__row">
			<span className="otelux-kv__key">{props.label}</span>
			<span
				className={`otelux-kv__val${props.mono ? ' otelux-kv__val--mono' : ''}`}
				title={props.value}
			>
				{props.value}
			</span>
			<span className="otelux-kv__view" aria-hidden="true" />
		</div>
	);
}

interface AttributeTableProps {
	attributes: Readonly<Record<string, AttributeValue>>;
	onViewValue: ((key: string, value: AttributeValue) => void) | undefined;
}

function AttributeTable(props: AttributeTableProps): JSX.Element {
	const { attributes, onViewValue } = props;
	const entries = Object.entries(attributes);
	if (entries.length === 0) {
		return <div className="otelux-kv__empty">none</div>;
	}
	return (
		<div className="otelux-kv">
			{entries.map(([k, v]) => {
				const rendered = renderAttributeValue(v);
				return (
					<div key={k} className="otelux-kv__row">
						<span className="otelux-kv__key">{k}</span>
						<span className="otelux-kv__val otelux-kv__val--mono" title={rendered}>
							{rendered}
						</span>
						{onViewValue !== undefined ? (
							<IconButton
								aria-label={`View value for ${k}`}
								className="otelux-kv__view"
								onClick={() => onViewValue(k, v)}
							>
								<EyeIcon />
							</IconButton>
						) : (
							<span className="otelux-kv__view" aria-hidden="true" />
						)}
					</div>
				);
			})}
		</div>
	);
}

function renderAttributeValue(v: AttributeValue): string {
	if (typeof v === 'bigint') {
		return v.toString();
	}
	if (Array.isArray(v)) {
		return v.map((item) => String(item)).join(', ');
	}
	return String(v);
}

// `service.name` lives on the resource attribute bag per OTel resource
// conventions: https://opentelemetry.io/docs/specs/semconv/resource/.
function serviceName(log: LogRecord): string | undefined {
	const v = log.resource.attributes['service.name'];
	return typeof v === 'string' ? v : undefined;
}

// The row message: prefer the OTLP body, then a conventional `message`
// attribute, then the event name. For Codex's attribute-only events
// (e.g. `codex.user_prompt`) the body is absent, so fall back through
// the most useful attribute the SDK populated.
function logMessage(log: LogRecord): string {
	if (typeof log.body === 'string' && log.body !== '') {
		return log.body;
	}
	if (log.body !== undefined && !Array.isArray(log.body)) {
		return renderAttributeValue(log.body);
	}
	const msg = log.attributes.message ?? log.attributes['event.name'] ?? log.attributes.prompt;
	if (msg !== undefined) {
		return renderAttributeValue(msg);
	}
	return log.eventName ?? '(no message)';
}
