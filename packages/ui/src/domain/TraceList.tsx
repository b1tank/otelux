/**
 * Redesigned trace list (T16).
 *
 * Two display modes:
 *  - 'card' (default): three-line cards. Line 1: root name + duration.
 *    Line 2: service chips + span/error counts. Line 3: relative time +
 *    absolute wall clock.
 *  - 'flat': single dense row per trace. Same data, less padding,
 *    designed for power users with lots of traces on screen.
 *
 * Filtering is delegated to the data source via `ListTracesQuery`:
 *  - `errorsOnly` -> hasError: true
 *  - `services`  -> services
 *  - `search`    -> search
 *
 * Re-fetches when the DataSource notifies. No virtualization yet — for current
 * local workloads (hundreds of traces) a native scroll container performs
 * well; revisit when a heavier load arrives.
 */

import type {
	DataSource,
	ListTracesResultRow,
	SortDirection,
	TraceListSort,
} from '@otelux/protocol';
import type { TraceId } from '@otelux/types';
import type { JSX, KeyboardEvent } from 'react';
import { formatDuration, formatWallClock, serviceColorVar } from '../format.js';
import { CopyButton } from '../primitives/CopyButton.js';
import { IconButton } from '../primitives/IconButton.js';
import { ResultFooter } from '../primitives/ResultFooter.js';
import { PanelLeftIcon, WaterfallIcon } from '../primitives/icons.js';
import { useDataSourceQuery } from '../useDataSourceQuery.js';

export type TraceListDensity = 'card' | 'flat';

export interface TraceListProps {
	dataSource: DataSource;
	selectedTraceId?: TraceId;
	onSelect(traceId: TraceId): void;
	/** Visual density of each row. */
	density?: TraceListDensity;
	/** When true, only traces with at least one error are shown. */
	errorsOnly?: boolean;
	/** Restrict to traces touching any of these service names. */
	services?: readonly string[];
	/** Substring search applied by the data source. */
	search?: string;
	/** Max rows fetched. */
	limit?: number;
	/** Hint text for the empty state. */
	endpointUrl?: string;
	/**
	 * When provided, a collapse-pane icon button is rendered on the
	 * right side of the header. Clicking it invokes the callback so the
	 * host can hide this pane (mockup parity: `.pane__head .btn-collapse-list`).
	 */
	onCollapse?: () => void;
	/**
	 * When provided, a "show waterfall" restore button appears in the
	 * header. Only relevant when the sibling waterfall pane is currently
	 * collapsed so the user has a way to bring it back.
	 */
	onRestoreWaterfall?: () => void;
	/**
	 * When provided and the list is empty with no active filters, a
	 * "Load sample data" button is shown in the empty state so a first-run
	 * user can populate the workbench without wiring an exporter.
	 */
	onLoadSampleData?: () => void;
	/** When true, live updates are frozen (the list holds its current rows). */
	paused?: boolean;
	/** Sort field. Defaults to `startTime` (most recent first). */
	sortBy?: TraceListSort;
	/** Sort direction. Defaults to `desc` for `startTime`, else `asc`. */
	sortDirection?: SortDirection;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_ENDPOINT = 'http://localhost:4319/v1/traces';

export function TraceList(props: TraceListProps): JSX.Element {
	const {
		dataSource,
		selectedTraceId,
		onSelect,
		density = 'card',
		errorsOnly,
		services,
		search,
		limit = DEFAULT_LIMIT,
		endpointUrl = DEFAULT_ENDPOINT,
		onCollapse,
		onRestoreWaterfall,
		onLoadSampleData,
		paused = false,
		sortBy = 'startTime',
		sortDirection = sortBy === 'startTime' ? 'desc' : 'asc',
	} = props;

	// Build the protocol-level query object. The serialization key below
	// must include every input that changes the result set; otherwise the
	// hook will reuse a stale fetch when filters change.
	const queryKey = `list:${limit}:${errorsOnly ? '1' : '0'}:${(services ?? []).join(',')}:${search ?? ''}:${sortBy}:${sortDirection}`;
	const query = useDataSourceQuery(
		dataSource,
		(ds) => {
			const q: Parameters<DataSource['listTraces']>[0] = {
				limit,
				sortBy,
				sortDirection,
			};
			if (errorsOnly) {
				q.hasError = true;
			}
			if (services && services.length > 0) {
				q.services = services;
			}
			if (search) {
				q.search = search;
			}
			return ds.listTraces(q);
		},
		queryKey,
		paused,
		'tracesChanged',
		true,
		undefined,
		100,
	);

	const rows = query.value?.rows ?? [];

	// Distinguish a genuinely empty store from a filtered-empty result: the
	// "Load sample data" affordance only makes sense when nothing is stored,
	// not when the user's filters happen to exclude everything.
	const filtersActive = Boolean(errorsOnly) || (services?.length ?? 0) > 0 || Boolean(search);
	const showSampleButton = onLoadSampleData !== undefined && !filtersActive;

	return (
		<section className={`otelux-trace-list otelux-trace-list--${density}`} aria-label="Traces">
			<header className="otelux-trace-list__header">
				<span className="otelux-trace-list__title">Traces</span>
				<span className="otelux-trace-list__count">{query.value?.totalCount ?? 0}</span>
				<span className="otelux-trace-list__spacer" />
				{onRestoreWaterfall ? (
					<IconButton
						aria-label="Show waterfall"
						title="Show waterfall"
						className="otelux-trace-list__restore"
						onClick={onRestoreWaterfall}
					>
						<WaterfallIcon size={14} />
					</IconButton>
				) : null}
				{onCollapse ? (
					<IconButton
						aria-label="Collapse trace list"
						title="Collapse trace list"
						className="otelux-trace-list__collapse"
						onClick={onCollapse}
					>
						<PanelLeftIcon size={14} />
					</IconButton>
				) : null}
			</header>
			<div className="otelux-trace-list__body">
				{query.loading && rows.length === 0 ? (
					<div className="otelux-trace-list__empty">Waiting for traces…</div>
				) : rows.length === 0 ? (
					<div className="otelux-trace-list__empty">
						No traces match. Point an OTel exporter at
						<br />
						<code>{endpointUrl}</code>
						{showSampleButton ? (
							<>
								<br />
								<button type="button" className="otelux-trace-list__sample-btn" onClick={onLoadSampleData}>
									Load sample data
								</button>
							</>
						) : null}
					</div>
				) : (
					<ul className="otelux-trace-list__rows">
						{rows.map((row) => (
							<TraceRow
								key={row.traceId}
								row={row}
								density={density}
								selected={row.traceId === selectedTraceId}
								onSelect={onSelect}
							/>
						))}
					</ul>
				)}
			</div>
			{rows.length > 0 ? (
				<ResultFooter count={query.value?.totalCount ?? rows.length} noun="trace" paused={paused} />
			) : null}
		</section>
	);
}

interface TraceRowProps {
	row: ListTracesResultRow;
	density: TraceListDensity;
	selected: boolean;
	onSelect(traceId: TraceId): void;
}

function TraceRow(props: TraceRowProps): JSX.Element {
	const { row, density, selected, onSelect } = props;

	// Primary service drives the left-edge selection stripe color and the
	// row's --otelux-row-svc var so a single trace card can reference its
	// dominant service color anywhere (chip, stripe, etc.) without
	// re-hashing the service name in CSS.
	const primarySvc = row.services[0];
	const rowStyle =
		primarySvc !== undefined
			? ({ ['--otelux-row-svc' as string]: serviceColorVar(primarySvc) } as React.CSSProperties)
			: undefined;

	// 8-char prefix is enough to disambiguate by eye while keeping rows
	// scannable. The full id is in the drawer when the user clicks.
	const shortTraceId = row.traceId.slice(0, 8);

	return (
		<li
			className={`otelux-trace-row otelux-trace-row--${density}${selected ? ' is-selected' : ''}`}
			{...(rowStyle ? { style: rowStyle } : {})}
		>
			{/*
			 * Outer interactive surface is a div role="button" rather
			 * than a real <button>. The card embeds a real <button>
			 * (CopyButton next to the trace id) — nesting <button>s is
			 * invalid HTML, so the outer becomes a div with explicit
			 * role + keyboard handlers. aria-pressed still communicates
			 * the toggle state.
			 */}
			{/* biome-ignore lint/a11y/useSemanticElements: nested CopyButton forbids a real <button> here; explicit role + keydown preserves semantics. */}
			<div
				role="button"
				tabIndex={0}
				className="otelux-trace-row__button"
				onClick={() => onSelect(row.traceId)}
				onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onSelect(row.traceId);
					}
				}}
				aria-pressed={selected}
			>
				{density === 'card' ? (
					<>
						{/*
						 * Card hierarchy (per design spec — see redesign-mockup.html):
						 *   row 1 — meta strip: tid + copy icon · span count · wall clock w/ date
						 *   row 2 — headline: root name (truncates with ellipsis)
						 *   row 3 — tags strip: service chip(s) · error pill · duration (right)
						 * Spans count rides in row 1 so the eye reads tid → size → time
						 * left-to-right, leaving row 2 as a clean title row.
						 */}
						<div className="otelux-trace-row__row otelux-trace-row__row--1">
							<span className="otelux-trace-row__tid-wrap">
								<span className="otelux-trace-row__tid" title={row.traceId}>
									{shortTraceId}
								</span>
								<CopyButton
									value={row.traceId}
									title="Copy trace id"
									ariaLabel="Copy trace id"
									className="otelux-trace-row__tid-copy"
								/>
							</span>
							<span className="otelux-trace-row__spans">{row.spanCount} spans</span>
							<time className="otelux-trace-row__time">
								{formatWallClock(row.startTimeUnixNano, true)}
							</time>
						</div>
						<div className="otelux-trace-row__row otelux-trace-row__row--2">
							<span className="otelux-trace-row__name" title={row.rootName}>
								{row.rootName || '(unnamed)'}
							</span>
						</div>
						<div className="otelux-trace-row__row otelux-trace-row__row--3">
							<ServiceChips services={row.services} max={2} />
							{row.errorCount > 0 ? (
								<span className="otelux-trace-row__errors">{row.errorCount} err</span>
							) : null}
							<span className="otelux-trace-row__duration">{formatDuration(row.durationNanos)}</span>
						</div>
					</>
				) : (
					<div className="otelux-trace-row__row otelux-trace-row__row--flat">
						<time className="otelux-trace-row__time">{formatWallClock(row.startTimeUnixNano)}</time>
						<span className="otelux-trace-row__duration">{formatDuration(row.durationNanos)}</span>
						<span className="otelux-trace-row__name" title={row.rootName}>
							{row.rootName || '(unnamed)'}
						</span>
						<ServiceChips services={row.services} max={1} />
						<span className="otelux-trace-row__spans">{row.spanCount}</span>
						{row.errorCount > 0 ? (
							<span className="otelux-trace-row__errors">{row.errorCount} err</span>
						) : null}
					</div>
				)}
			</div>
		</li>
	);
}

interface ServiceChipsProps {
	services: readonly string[];
	max?: number;
}

function ServiceChips(props: ServiceChipsProps): JSX.Element {
	const max = props.max ?? 3;
	const visible = props.services.slice(0, max);
	const overflow = props.services.length - visible.length;
	return (
		<span className="otelux-service-chips">
			{visible.map((s) => (
				<span
					key={s}
					className="otelux-service-chip"
					style={{ ['--chip-color' as string]: serviceColorVar(s) }}
				>
					<span className="otelux-service-chip__dot" aria-hidden />
					<span className="otelux-service-chip__name">{s}</span>
				</span>
			))}
			{overflow > 0 && (
				<span className="otelux-service-chip otelux-service-chip--more">+{overflow}</span>
			)}
		</span>
	);
}
