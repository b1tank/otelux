/**
 * Redesigned waterfall (T17).
 *
 * Adds:
 *  - A time ruler at the top with "nice" tick intervals.
 *  - Depth indent guides drawn behind the rows.
 *  - Per-service color sourced from CSS vars (`--otelux-svc-N`) so the
 *    palette is themable from `tokens.css` alone.
 *
 * Layout is computed by `@otelux/engine`'s `computeWaterfallLayout`.
 * Bar geometry is delegated to `./waterfall-geometry` so the math is
 * unit-testable.
 */

import { type WaterfallRow, computeWaterfallLayout } from '@otelux/engine';
import { SpanStatusCode } from '@otelux/types';
import type { SpanId, Trace } from '@otelux/types';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, nanosToNumber, serviceColorVar } from '../format.js';
import { formatRulerTick, makeRulerTicks, timeToX } from './waterfall-geometry.js';

export interface WaterfallProps {
	trace: Trace;
	selectedSpanId?: SpanId;
	onSpanSelect(spanId: SpanId): void;
}

const ROW_HEIGHT = 22;
const ROW_PADDING = 2;
const RULER_HEIGHT = 24;
const LABEL_COLUMN_WIDTH = 280;
const BAR_AREA_PADDING = 8;
// Default pane width used until the ResizeObserver reports a measurement
// (e.g. first render before paint, or under jsdom in tests). Picked to
// be wider than the label column so bars render in a sensible spot.
const DEFAULT_PANE_WIDTH = 1024;
const MIN_PANE_WIDTH = LABEL_COLUMN_WIDTH + 200;
const DEPTH_INDENT = 14;
const RULER_TARGET_TICKS = 5;

export function Waterfall(props: WaterfallProps): JSX.Element {
	const { trace, selectedSpanId, onSpanSelect } = props;
	const layout = useMemo(() => computeWaterfallLayout(trace), [trace]);
	const totalNs = nanosToNumber(layout.totalDurationNanos);

	// Render the SVG at its container's real pixel width (1:1 with the
	// viewBox) so the <text> elements aren't horizontally stretched or
	// squeezed by preserveAspectRatio. Before we did this the bar area
	// was a fixed viewBox-px value scaled by the browser, which made
	// labels deform whenever the pane size differed from the viewBox.
	const scrollRef = useRef<HTMLDivElement>(null);
	const [paneWidth, setPaneWidth] = useState<number>(DEFAULT_PANE_WIDTH);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) {
			return;
		}
		// jsdom (used by our unit tests) does not implement ResizeObserver.
		// Fall back to the default pane width there; production browsers
		// always have ResizeObserver so this branch is test-only.
		if (typeof ResizeObserver === 'undefined') {
			return;
		}
		// ResizeObserver fires both on mount and on every layout change of
		// the observed element, so we don't need a separate window 'resize'
		// listener for the splitter or window-resize cases.
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const next = Math.max(MIN_PANE_WIDTH, Math.floor(entry.contentRect.width));
				setPaneWidth((prev) => (prev === next ? prev : next));
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const barAreaStart = LABEL_COLUMN_WIDTH + BAR_AREA_PADDING;
	const barAreaWidth = Math.max(100, paneWidth - barAreaStart - BAR_AREA_PADDING);
	const ticks = useMemo(() => makeRulerTicks(totalNs, RULER_TARGET_TICKS), [totalNs]);
	const rowsHeight = layout.rows.length * (ROW_HEIGHT + ROW_PADDING);
	const totalHeight = RULER_HEIGHT + Math.max(ROW_HEIGHT, rowsHeight);

	return (
		<section className="otelux-waterfall" aria-label="Waterfall">
			<header className="otelux-waterfall__header">
				<span className="otelux-waterfall__name" title={trace.rootSpan?.name ?? ''}>
					{trace.rootSpan?.name ?? '(no spans)'}
				</span>
				<span className="otelux-waterfall__duration">{formatDuration(trace.durationNanos)}</span>
				<span className="otelux-waterfall__count">{trace.spanCount} spans</span>
			</header>
			{layout.rows.length === 0 ? (
				<div className="otelux-waterfall__empty">Trace is empty.</div>
			) : (
				<div ref={scrollRef} className="otelux-waterfall__scroll">
					<svg
						className="otelux-waterfall__svg"
						width={paneWidth}
						height={totalHeight}
						viewBox={`0 0 ${paneWidth} ${totalHeight}`}
						role="img"
						aria-label="Span waterfall"
					>
						<Ruler
							ticks={ticks}
							totalNs={totalNs}
							barAreaStart={barAreaStart}
							barAreaWidth={barAreaWidth}
						/>
						<g className="otelux-waterfall__rows" transform={`translate(0, ${RULER_HEIGHT})`}>
							{ticks.map((tickNs) => (
								<line
									key={`tick-${tickNs}`}
									x1={timeToX(tickNs, totalNs, barAreaStart, barAreaWidth)}
									x2={timeToX(tickNs, totalNs, barAreaStart, barAreaWidth)}
									y1={0}
									y2={rowsHeight}
									className="otelux-waterfall__tickline"
								/>
							))}
							{layout.rows.map((row) => (
								<Row
									key={row.span.spanId}
									row={row}
									totalNs={totalNs}
									barAreaStart={barAreaStart}
									barAreaWidth={barAreaWidth}
									selected={row.span.spanId === selectedSpanId}
									onSelect={onSpanSelect}
								/>
							))}
						</g>
					</svg>
				</div>
			)}
		</section>
	);
}

interface RulerProps {
	ticks: readonly number[];
	totalNs: number;
	barAreaStart: number;
	barAreaWidth: number;
}

function Ruler(props: RulerProps): JSX.Element {
	const { ticks, totalNs, barAreaStart, barAreaWidth } = props;
	return (
		<g className="otelux-waterfall__ruler" aria-hidden>
			<rect x={0} y={0} width="100%" height={RULER_HEIGHT} className="otelux-waterfall__ruler-bg" />
			{ticks.map((tickNs) => {
				const x = timeToX(tickNs, totalNs, barAreaStart, barAreaWidth);
				return (
					<g key={`r-${tickNs}`} transform={`translate(${x}, 0)`}>
						<line
							x1={0}
							x2={0}
							y1={RULER_HEIGHT - 6}
							y2={RULER_HEIGHT}
							className="otelux-waterfall__ruler-tick"
						/>
						<text x={3} y={RULER_HEIGHT - 8} className="otelux-waterfall__ruler-label">
							{formatRulerTick(tickNs)}
						</text>
					</g>
				);
			})}
		</g>
	);
}

interface RowProps {
	row: WaterfallRow;
	totalNs: number;
	barAreaStart: number;
	barAreaWidth: number;
	selected: boolean;
	onSelect(spanId: SpanId): void;
}

function Row(props: RowProps): JSX.Element {
	const { row, totalNs, barAreaStart, barAreaWidth, selected, onSelect } = props;
	const y = row.index * (ROW_HEIGHT + ROW_PADDING);
	const labelX = row.depth * DEPTH_INDENT + 4;

	const startNs = nanosToNumber(row.startOffsetNanos);
	const endNs = startNs + nanosToNumber(row.durationNanos);
	const x = timeToX(startNs, totalNs, barAreaStart, barAreaWidth);
	const xEnd = timeToX(endNs, totalNs, barAreaStart, barAreaWidth);
	const width = Math.max(1, xEnd - x);

	const svc = row.span.resource.attributes['service.name'];
	const serviceName = typeof svc === 'string' ? svc : 'unknown';
	const fillVar = serviceColorVar(serviceName);
	const isError = row.span.status.code === SpanStatusCode.Error;

	return (
		<g
			className={`otelux-waterfall__row${selected ? ' is-selected' : ''}${isError ? ' is-error' : ''}`}
			onClick={() => onSelect(row.span.spanId)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onSelect(row.span.spanId);
				}
			}}
			cursor="pointer"
			tabIndex={0}
			// biome-ignore lint/a11y/useSemanticElements: SVG <g> cannot be replaced with <button> inside an <svg>; the row is keyboard-activatable and exposes role=button + aria-pressed.
			role="button"
			aria-label={`${row.span.name}, ${formatDuration(row.durationNanos)}`}
			aria-pressed={selected}
		>
			<rect x={0} y={y} width="100%" height={ROW_HEIGHT} className="otelux-waterfall__row-bg" />
			<text
				x={labelX}
				y={y + ROW_HEIGHT / 2}
				dominantBaseline="middle"
				className="otelux-waterfall__label"
			>
				{row.span.name}
			</text>
			<rect
				x={x}
				y={y + 3}
				width={width}
				height={ROW_HEIGHT - 6}
				fill={fillVar}
				className="otelux-waterfall__bar"
				rx={2}
				ry={2}
			/>
			<text
				x={x + width + 4}
				y={y + ROW_HEIGHT / 2}
				dominantBaseline="middle"
				className="otelux-waterfall__duration-label"
			>
				{formatDuration(row.durationNanos)}
			</text>
		</g>
	);
}
