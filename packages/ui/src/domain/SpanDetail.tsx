/**
 * `SpanDetail` — read-only details for a selected `Span`.
 *
 * Structure: a single `Accordion` whose first item ("Span") holds the
 * span's identity facts (kind, status, duration, ids, timestamps),
 * followed by Attributes, Resource, Scope, and — when populated —
 * Events and Links. The span's name and status badge are surfaced by
 * the hosting Drawer header (via `accentVar` + `kindLabel`); we don't
 * repeat them inside the body. Long attribute values can be inspected
 * via the optional `onViewValue` callback which is wired to the
 * `ValueViewer` modal.
 *
 * Layered import discipline: lives in `src/domain/` and depends on
 * `primitives` + `format.ts` + `@otelux/types`. It MUST NOT import
 * from other domain components (`TraceList`, `Waterfall`, ...).
 */

import { type AttributeValue, type Span, SpanKind, SpanStatusCode } from '@otelux/types';
import type { JSX } from 'react';
import { formatDuration, formatWallClock } from '../format.js';
import { Accordion, type AccordionItem, EyeIcon, IconButton } from '../primitives/index.js';

export interface SpanDetailProps {
	span: Span;
	/**
	 * When supplied, each attribute row gets a "View value" eye button
	 * that surfaces this callback. Used by T22 to host `ValueViewer`.
	 */
	onViewValue?: (key: string, value: AttributeValue) => void;
}

const SPAN_KIND_LABELS: Readonly<Record<number, string>> = {
	[SpanKind.Unspecified]: 'Unspecified',
	[SpanKind.Internal]: 'Internal',
	[SpanKind.Server]: 'Server',
	[SpanKind.Client]: 'Client',
	[SpanKind.Producer]: 'Producer',
	[SpanKind.Consumer]: 'Consumer',
};

const STATUS_LABELS: Readonly<Record<number, string>> = {
	[SpanStatusCode.Unset]: 'Unset',
	[SpanStatusCode.Ok]: 'Ok',
	[SpanStatusCode.Error]: 'Error',
};

export function SpanDetail(props: SpanDetailProps): JSX.Element {
	const { span, onViewValue } = props;
	const rawDuration = span.endTimeUnixNano - span.startTimeUnixNano;
	const duration = rawDuration < 0n ? 0n : rawDuration;
	const isError = span.status.code === SpanStatusCode.Error;
	const statusKey = isError ? 'error' : span.status.code === SpanStatusCode.Ok ? 'ok' : 'unset';

	const items: AccordionItem[] = [
		{
			id: 'span',
			label: 'Span',
			defaultOpen: true,
			children: <SpanFacts span={span} duration={duration} statusKey={statusKey} />,
		},
		{
			id: 'attributes',
			label: 'Attributes',
			badge: <Count value={Object.keys(span.attributes).length} />,
			defaultOpen: true,
			children: <AttributeTable attributes={span.attributes} onViewValue={onViewValue} />,
		},
		{
			id: 'resource',
			label: 'Resource',
			badge: <Count value={Object.keys(span.resource.attributes).length} />,
			children: <AttributeTable attributes={span.resource.attributes} onViewValue={onViewValue} />,
		},
		{
			id: 'scope',
			label: 'Scope',
			children: <ScopeBlock name={span.scope.name} version={span.scope.version} />,
		},
	];

	if (span.events && span.events.length > 0) {
		items.push({
			id: 'events',
			label: 'Events',
			badge: <Count value={span.events.length} />,
			children: <EventList events={span.events} onViewValue={onViewValue} />,
		});
	}

	if (span.links && span.links.length > 0) {
		items.push({
			id: 'links',
			label: 'Links',
			badge: <Count value={span.links.length} />,
			children: <LinkList links={span.links} />,
		});
	}

	return (
		<section className="otelux-span-detail" aria-label="Span detail">
			<Accordion items={items} />
		</section>
	);
}

function SpanFacts(props: {
	span: Span;
	duration: bigint;
	statusKey: 'ok' | 'error' | 'unset';
}): JSX.Element {
	const { span, duration, statusKey } = props;
	return (
		<div className="otelux-kv">
			<KVRow label="Name" value={span.name || '(unnamed)'} />
			<KVRow
				label="Status"
				value={
					<span className={`otelux-span-detail__status is-${statusKey}`}>
						{STATUS_LABELS[span.status.code] ?? 'Unset'}
					</span>
				}
			/>
			{span.status.message !== undefined && span.status.message !== '' ? (
				<KVRow label="Status message" value={span.status.message} />
			) : null}
			<KVRow label="Kind" value={SPAN_KIND_LABELS[span.kind] ?? 'Unspecified'} />
			<KVRow label="Duration" value={formatDuration(duration)} />
			<KVRow label="Started" value={formatWallClock(span.startTimeUnixNano)} />
			<KVRow label="Ended" value={formatWallClock(span.endTimeUnixNano)} />
			<KVRow label="Span ID" value={span.spanId} mono />
			<KVRow label="Trace ID" value={span.traceId} mono />
			{span.parentSpanId !== undefined ? (
				<KVRow label="Parent" value={span.parentSpanId} mono />
			) : null}
		</div>
	);
}

function Count(props: { value: number }): JSX.Element {
	return <>{props.value}</>;
}

function KVRow(props: { label: string; value: JSX.Element | string; mono?: boolean }): JSX.Element {
	// `title` exposes the raw text on hover for ellipsised single-line values.
	const titleAttr = typeof props.value === 'string' ? props.value : undefined;
	return (
		<div className="otelux-kv__row">
			<span className="otelux-kv__key">{props.label}</span>
			<span className={`otelux-kv__val${props.mono ? ' otelux-kv__val--mono' : ''}`} title={titleAttr}>
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

function ScopeBlock(props: { name: string; version: string | undefined }): JSX.Element {
	return (
		<div className="otelux-span-detail__scope">
			<span className="otelux-span-detail__scope-name">{props.name || '(unnamed)'}</span>
			{props.version !== undefined && props.version !== '' ? (
				<span className="otelux-span-detail__scope-version">{props.version}</span>
			) : null}
		</div>
	);
}

interface EventListProps {
	events: NonNullable<Span['events']>;
	onViewValue: ((key: string, value: AttributeValue) => void) | undefined;
}

function EventList(props: EventListProps): JSX.Element {
	return (
		<ul className="otelux-span-detail__events">
			{props.events.map((ev, i) => (
				// Event names are not unique; pair the name with the timestamp + index
				// so list reconciliation is stable across re-renders.
				<li key={`${ev.name}:${ev.timeUnixNano}:${i}`} className="otelux-span-detail__event">
					<div className="otelux-span-detail__event-head">
						<span className="otelux-span-detail__event-name">{ev.name}</span>
						<span className="otelux-span-detail__event-time">{formatWallClock(ev.timeUnixNano)}</span>
					</div>
					<AttributeTable attributes={ev.attributes ?? {}} onViewValue={props.onViewValue} />
				</li>
			))}
		</ul>
	);
}

function LinkList(props: { links: NonNullable<Span['links']> }): JSX.Element {
	return (
		<ul className="otelux-span-detail__links">
			{props.links.map((l, i) => (
				<li key={`${l.traceId}:${l.spanId}:${i}`}>
					<code>{l.traceId}</code>
					<span className="otelux-span-detail__link-sep">:</span>
					<code>{l.spanId}</code>
				</li>
			))}
		</ul>
	);
}
