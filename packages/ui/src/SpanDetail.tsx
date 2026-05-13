/**
 * Span detail panel. Shows everything about a selected span: kind,
 * status, duration, attributes, events, links, resource attributes,
 * and instrumentation scope. Read-only — copy-able by selection.
 */

import type { AttributeValue, Span } from '@otelux/types';
import { SpanKind } from '@otelux/types';
import type { JSX } from 'react';
import { formatDuration, formatWallClock } from './format.js';

export interface SpanDetailProps {
	span: Span;
}

const SPAN_KIND_LABELS: Record<number, string> = {
	[SpanKind.Unspecified]: 'Unspecified',
	[SpanKind.Internal]: 'Internal',
	[SpanKind.Server]: 'Server',
	[SpanKind.Client]: 'Client',
	[SpanKind.Producer]: 'Producer',
	[SpanKind.Consumer]: 'Consumer',
};

const STATUS_LABELS: Record<number, string> = {
	0: 'Unset',
	1: 'Ok',
	2: 'Error',
};

export function SpanDetail(props: SpanDetailProps): JSX.Element {
	const { span } = props;
	const duration = span.endTimeUnixNano - span.startTimeUnixNano;
	const isError = span.status.code === 2;

	return (
		<section className="otelux-span-detail" aria-label="Span detail">
			<header className="otelux-span-detail__header">
				<h3 className="otelux-span-detail__name">{span.name || '(unnamed)'}</h3>
				<span
					className={`otelux-span-detail__status otelux-span-detail__status--${
						isError ? 'error' : span.status.code === 1 ? 'ok' : 'unset'
					}`}
				>
					{STATUS_LABELS[span.status.code] ?? 'Unset'}
				</span>
			</header>

			<dl className="otelux-span-detail__facts">
				<Fact label="Span ID" value={span.spanId} mono />
				<Fact label="Trace ID" value={span.traceId} mono />
				{span.parentSpanId && <Fact label="Parent" value={span.parentSpanId} mono />}
				<Fact label="Kind" value={SPAN_KIND_LABELS[span.kind] ?? 'Unspecified'} />
				<Fact label="Duration" value={formatDuration(duration < 0n ? 0n : duration)} />
				<Fact label="Started" value={formatWallClock(span.startTimeUnixNano)} />
				<Fact label="Ended" value={formatWallClock(span.endTimeUnixNano)} />
				{span.status.message && <Fact label="Status message" value={span.status.message} />}
			</dl>

			<Section title="Attributes">
				<AttributeTable attributes={span.attributes} />
			</Section>

			{span.events && span.events.length > 0 && (
				<Section title={`Events (${span.events.length})`}>
					<ul className="otelux-span-detail__events">
						{span.events.map((ev, i) => (
							<li key={`${ev.name}-${i}`} className="otelux-span-detail__event">
								<div className="otelux-span-detail__event-head">
									<span className="otelux-span-detail__event-name">{ev.name}</span>
									<span className="otelux-span-detail__event-time">{formatWallClock(ev.timeUnixNano)}</span>
								</div>
								<AttributeTable attributes={ev.attributes ?? {}} dense />
							</li>
						))}
					</ul>
				</Section>
			)}

			{span.links && span.links.length > 0 && (
				<Section title={`Links (${span.links.length})`}>
					<ul className="otelux-span-detail__links">
						{span.links.map((l) => (
							<li key={`${l.traceId}:${l.spanId}`}>
								<code>{l.traceId}</code>:<code>{l.spanId}</code>
							</li>
						))}
					</ul>
				</Section>
			)}

			<Section title="Resource">
				<AttributeTable attributes={span.resource.attributes} />
			</Section>

			<Section title="Scope">
				<div className="otelux-span-detail__scope">
					<span>{span.scope.name || '(unnamed)'}</span>
					{span.scope.version && (
						<span className="otelux-span-detail__scope-version">{span.scope.version}</span>
					)}
				</div>
			</Section>
		</section>
	);
}

function Fact(props: { label: string; value: string; mono?: boolean }): JSX.Element {
	return (
		<div className="otelux-fact">
			<dt className="otelux-fact__label">{props.label}</dt>
			<dd className={`otelux-fact__value${props.mono ? ' otelux-fact__value--mono' : ''}`}>
				{props.value}
			</dd>
		</div>
	);
}

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
	return (
		<section className="otelux-section">
			<h4 className="otelux-section__title">{props.title}</h4>
			{props.children}
		</section>
	);
}

function AttributeTable(props: {
	attributes: Readonly<Record<string, AttributeValue>>;
	dense?: boolean;
}): JSX.Element {
	const entries = Object.entries(props.attributes);
	if (entries.length === 0) {
		return <div className="otelux-attr-table__empty">none</div>;
	}
	return (
		<table className={`otelux-attr-table${props.dense ? ' otelux-attr-table--dense' : ''}`}>
			<tbody>
				{entries.map(([k, v]) => (
					<tr key={k}>
						<th scope="row">{k}</th>
						<td>{renderAttributeValue(v)}</td>
					</tr>
				))}
			</tbody>
		</table>
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
