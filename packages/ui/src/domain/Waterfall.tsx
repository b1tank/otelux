/**
 * Redesigned waterfall.
 *
 * HTML/CSS-grid layout (replaces the prior SVG version):
 *  - Header with name, count, total duration meta, and pane controls.
 *  - Ruler row: 280px "SPAN" column, flexible tick column, 64px
 *    "DURATION" column.
 *  - One row per visible span. Each row has the same three-column
 *    grid so labels, bars, and duration align across the whole list.
 *  - Per-row indent guides (`14px * ancestor` vertical hairlines)
 *    matching the mockup `.wf__row::before`.
 *  - Caret button to collapse/expand a subtree; descendants are
 *    skipped while any ancestor is collapsed.
 *
 * Bars are positioned with percentage values driven by
 * `computeWaterfallLayout` from `@otelux/engine`, so geometry stays
 * unit-testable.
 *
 * Search matches: when `searchMatchIds` is supplied, rows in the set
 * get an `is-match` class so the consumer's search UI can light them
 * up. The set is consulted in O(1); we never iterate it per render.
 */

import { type WaterfallLayout, type WaterfallRow, computeWaterfallLayout } from '@otelux/engine';
import { SpanStatusCode } from '@otelux/types';
import type { SpanId, Trace } from '@otelux/types';
import { type JSX, useMemo, useState } from 'react';
import { formatDuration, nanosToNumber, serviceColorVar } from '../format.js';
import { CopyButton } from '../primitives/CopyButton.js';
import { IconButton } from '../primitives/IconButton.js';
import {
	ChevronDownIcon,
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	ListIcon,
	PanelRightIcon,
} from '../primitives/icons.js';
import { formatRulerTick, makeRulerTicks } from './waterfall-geometry.js';

export interface WaterfallProps {
	trace: Trace;
	selectedSpanId?: SpanId;
	onSpanSelect(spanId: SpanId): void;
	/**
	 * When provided, a collapse-pane icon button is rendered on the
	 * right end of the header.
	 */
	onCollapse?: () => void;
	/**
	 * When provided, a "show trace list" restore button is shown in the
	 * header. Only relevant when the sibling trace-list pane is
	 * currently collapsed so the user has a way to bring it back.
	 */
	onRestoreList?: () => void;
	/**
	 * Optional set of span ids that match the active search query.
	 * Rows whose id is in the set get an `is-match` class.
	 */
	searchMatchIds?: ReadonlySet<SpanId>;
}

const RULER_TARGET_TICKS = 5;
// Per-level horizontal indent for the name column. Matches the
// mockup's `.wf__row::before` step (14px per ancestor).
const DEPTH_INDENT_PX = 14;
// Max distinct services shown as chips in the header. Mirrors the
// trace-list row (`max=1` + a "+N" overflow chip) so the header reads
// as a denser version of the same identity.
const HEADER_SERVICE_CHIP_MAX = 1;

export function Waterfall(props: WaterfallProps): JSX.Element {
	const { trace, selectedSpanId, onSpanSelect, onCollapse, onRestoreList, searchMatchIds } = props;
	const layout = useMemo(() => computeWaterfallLayout(trace), [trace]);
	const totalNs = nanosToNumber(layout.totalDurationNanos);
	const ticks = useMemo(() => makeRulerTicks(totalNs, RULER_TARGET_TICKS), [totalNs]);

	// Collapsed parent span ids. Each visible row whose depth is deeper
	// than the nearest collapsed ancestor is filtered out by
	// `getVisibleRows` below.
	const [collapsed, setCollapsed] = useState<ReadonlySet<SpanId>>(() => new Set());
	const visibleRows = useMemo(() => getVisibleRows(layout, collapsed), [layout, collapsed]);
	const collapsibleIds = useMemo(
		() => layout.rows.filter((r) => r.hasChildren).map((r) => r.span.spanId),
		[layout],
	);

	const expandAll = (): void => {
		setCollapsed(new Set());
	};
	const collapseAll = (): void => {
		setCollapsed(new Set(collapsibleIds));
	};
	// Single toggle button: collapse-all when anything is expanded;
	// expand-all when every collapsible parent is currently collapsed.
	const allCollapsed = collapsibleIds.length > 0 && collapsed.size >= collapsibleIds.length;
	const toggleAll = (): void => {
		if (allCollapsed) {
			expandAll();
		} else {
			collapseAll();
		}
	};
	const toggleRow = (id: SpanId): void => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	// Distinct services in this trace. Used to render service chips
	// in the header (mirrors the chip cluster in each trace-list row).
	const services = useMemo(() => uniqueServices(trace), [trace]);

	return (
		<section className="otelux-waterfall" aria-label="Waterfall">
			<header className="otelux-waterfall__header">
				{onRestoreList ? (
					<IconButton
						aria-label="Show trace list"
						title="Show trace list"
						className="otelux-waterfall__restore"
						onClick={onRestoreList}
					>
						<ListIcon size={14} />
					</IconButton>
				) : null}
				<span className="otelux-waterfall__tid-wrap">
					<span className="otelux-waterfall__tid" title={trace.traceId}>
						{trace.traceId}
					</span>
					<CopyButton
						value={trace.traceId}
						title="Copy trace id"
						ariaLabel="Copy trace id"
						className="otelux-waterfall__tid-copy"
					/>
				</span>
				<span className="otelux-waterfall__spans-pill" aria-label={`${trace.spanCount} spans`}>
					{trace.spanCount}
				</span>
				<HeaderServiceChips services={services} max={HEADER_SERVICE_CHIP_MAX} />
				<span
					className="otelux-waterfall__selected"
					title="Live arrivals update the list without replacing this trace"
				>
					Selected trace
				</span>
				<span className="otelux-waterfall__spacer" />
				{collapsibleIds.length > 0 ? (
					<IconButton
						aria-label={allCollapsed ? 'Expand all' : 'Collapse all'}
						title={allCollapsed ? 'Expand all' : 'Collapse all'}
						onClick={toggleAll}
					>
						{allCollapsed ? <ChevronsUpDownIcon size={14} /> : <ChevronsDownUpIcon size={14} />}
					</IconButton>
				) : null}
				{onCollapse ? (
					<IconButton
						aria-label="Collapse waterfall pane"
						title="Collapse waterfall pane"
						className="otelux-waterfall__collapse"
						onClick={onCollapse}
					>
						<PanelRightIcon size={14} />
					</IconButton>
				) : null}
			</header>
			{layout.rows.length === 0 ? (
				<div className="otelux-waterfall__empty">Trace is empty.</div>
			) : (
				<>
					<div className="otelux-waterfall__ruler" aria-hidden="true">
						<span className="otelux-waterfall__ruler-head">Span</span>
						<div className="otelux-waterfall__ruler-track">
							{ticks.map((tickNs) => {
								const pct = totalNs > 0 ? (tickNs / totalNs) * 100 : 0;
								return (
									<span
										key={`tick-${tickNs}`}
										className="otelux-waterfall__ruler-tick"
										style={{ left: `${pct}%` }}
									>
										{formatRulerTick(tickNs)}
									</span>
								);
							})}
						</div>
						<span className="otelux-waterfall__ruler-head otelux-waterfall__ruler-head--right">
							Duration
						</span>
					</div>
					<div className="otelux-waterfall__rows" aria-label="Span waterfall">
						{visibleRows.map((row) => (
							<Row
								key={row.span.spanId}
								row={row}
								totalNs={totalNs}
								selected={row.span.spanId === selectedSpanId}
								collapsed={collapsed.has(row.span.spanId)}
								matched={searchMatchIds?.has(row.span.spanId) ?? false}
								onSelect={onSpanSelect}
								onToggle={toggleRow}
							/>
						))}
					</div>
				</>
			)}
		</section>
	);
}

interface RowProps {
	row: WaterfallRow;
	totalNs: number;
	selected: boolean;
	collapsed: boolean;
	matched: boolean;
	onSelect(spanId: SpanId): void;
	onToggle(spanId: SpanId): void;
}

function Row(props: RowProps): JSX.Element {
	const { row, totalNs, selected, collapsed, matched, onSelect, onToggle } = props;
	const startNs = nanosToNumber(row.startOffsetNanos);
	const durationNs = nanosToNumber(row.durationNanos);
	// Percent positions for the bar within the bar track. Clamped to
	// [0, 100] so floating-point drift on degenerate traces doesn't
	// paint outside the row.
	const denom = totalNs > 0 ? totalNs : 1;
	const leftPct = clamp((startNs / denom) * 100, 0, 100);
	const widthPct = Math.max(0.5, clamp((durationNs / denom) * 100, 0, 100 - leftPct));

	const svc = row.span.resource.attributes['service.name'];
	const serviceName = typeof svc === 'string' ? svc : 'unknown';
	const fillVar = serviceColorVar(serviceName);
	const isError = row.span.status.code === SpanStatusCode.Error;

	return (
		<div
			// biome-ignore lint/a11y/useSemanticElements: this is a row in a custom waterfall list — role=button + keyboard handlers replicate <button> semantics inside the grid layout.
			role="button"
			aria-pressed={selected}
			aria-label={`${row.span.name}, ${formatDuration(row.durationNanos)}`}
			tabIndex={0}
			className={
				`otelux-waterfall__row${selected ? ' is-selected' : ''}` +
				`${isError ? ' is-error' : ''}${matched ? ' is-match' : ''}` +
				`${row.hasChildren ? '' : ' is-leaf'}`
			}
			data-depth={row.depth}
			style={{
				// Service color is exposed as a CSS variable so the bar and
				// the selected-state slab can reference the same hue without
				// re-deriving it from the service name. Depth drives one CSS
				// repeating gradient instead of O(depth) guide elements.
				['--svc' as string]: fillVar,
				['--otelux-depth' as string]: row.depth,
			}}
			onClick={() => onSelect(row.span.spanId)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onSelect(row.span.spanId);
				}
			}}
		>
			<div className="otelux-waterfall__name-cell">
				{row.hasChildren ? (
					<button
						type="button"
						className={`otelux-waterfall__caret${collapsed ? ' is-collapsed' : ''}`}
						aria-label={collapsed ? 'Expand span' : 'Collapse span'}
						aria-expanded={!collapsed}
						tabIndex={-1}
						onClick={(e) => {
							// Don't bubble to the row's onSelect: clicking the caret
							// should toggle, not change selection.
							e.stopPropagation();
							onToggle(row.span.spanId);
						}}
						style={{ marginLeft: `${row.depth * DEPTH_INDENT_PX}px` }}
					>
						<ChevronDownIcon size={12} />
					</button>
				) : (
					// Leaf row: no toggle button. Render a width-preserving
					// spacer so the title still aligns with sibling parent
					// rows that do show a caret.
					<span
						className="otelux-waterfall__caret-spacer"
						style={{ marginLeft: `${row.depth * DEPTH_INDENT_PX}px` }}
						aria-hidden="true"
					/>
				)}
				<span className="otelux-waterfall__title" title={row.span.name}>
					{row.span.name}
				</span>
			</div>
			<div className="otelux-waterfall__bar-track">
				<div
					className="otelux-waterfall__bar"
					style={{
						left: `${leftPct}%`,
						width: `${widthPct}%`,
						background: 'var(--svc)',
					}}
				/>
			</div>
			<span className="otelux-waterfall__duration">{formatDuration(row.durationNanos)}</span>
		</div>
	);
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

/**
 * Filter the layout's flat row list down to rows that are not hidden
 * by a collapsed ancestor. Walks the rows top-to-bottom and skips any
 * row whose depth is strictly greater than the depth at which we last
 * encountered a collapsed parent.
 */
function getVisibleRows(
	layout: WaterfallLayout,
	collapsed: ReadonlySet<SpanId>,
): readonly WaterfallRow[] {
	if (collapsed.size === 0) {
		return layout.rows;
	}
	const out: WaterfallRow[] = [];
	let hideDepth: number | undefined;
	for (const row of layout.rows) {
		if (hideDepth !== undefined && row.depth > hideDepth) {
			continue;
		}
		hideDepth = undefined;
		out.push(row);
		if (collapsed.has(row.span.spanId) && row.hasChildren) {
			hideDepth = row.depth;
		}
	}
	return out;
}

function rootServiceName(trace: Trace): string | undefined {
	const svc = trace.rootSpan?.resource.attributes['service.name'];
	return typeof svc === 'string' && svc.length > 0 ? svc : undefined;
}

/**
 * Distinct service names in the trace, root-service first when known.
 * The waterfall header renders these as chips that mirror the trace
 * list rows — same look, same colour mapping.
 */
function uniqueServices(trace: Trace): readonly string[] {
	if (trace.services.length === 0) {
		return [];
	}
	const root = rootServiceName(trace);
	if (root === undefined) {
		return trace.services;
	}
	// Move the root service to the front so the chip cluster leads with
	// the trace's owning service. The remaining order is preserved.
	const rest = trace.services.filter((s) => s !== root);
	return [root, ...rest];
}

interface HeaderServiceChipsProps {
	services: readonly string[];
	max: number;
}

/**
 * Inline service-chip cluster for the waterfall header. Visually
 * identical to the trace-list row chips — same colored dot + name +
 * "+N" overflow chip. Kept inline (not extracted) because it is only
 * used here and in TraceList; sharing through CSS classes is
 * sufficient.
 */
function HeaderServiceChips(props: HeaderServiceChipsProps): JSX.Element | null {
	const visible = props.services.slice(0, props.max);
	const overflow = props.services.length - visible.length;
	if (visible.length === 0 && overflow <= 0) {
		return null;
	}
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
			{overflow > 0 ? (
				<span className="otelux-service-chip otelux-service-chip--more">+{overflow}</span>
			) : null}
		</span>
	);
}
