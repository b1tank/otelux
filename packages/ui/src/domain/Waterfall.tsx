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
import { type JSX, useMemo } from 'react';
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
const BAR_AREA_WIDTH = 1000; // viewBox-scaled; the SVG is responsive
const DEPTH_INDENT = 14;
const RULER_TARGET_TICKS = 5;

export function Waterfall(props: WaterfallProps): JSX.Element {
	const { trace, selectedSpanId, onSpanSelect } = props;
	const layout = useMemo(() => computeWaterfallLayout(trace), [trace]);
	const totalNs = nanosToNumber(layout.totalDurationNanos);

	const barAreaStart = LABEL_COLUMN_WIDTH + BAR_AREA_PADDING;
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
				<div className="otelux-waterfall__scroll">
					<svg
						className="otelux-waterfall__svg"
						width="100%"
						height={totalHeight}
						viewBox={`0 0 ${barAreaStart + BAR_AREA_WIDTH + BAR_AREA_PADDING} ${totalHeight}`}
						preserveAspectRatio="none"
						role="img"
						aria-label="Span waterfall"
					>
						<Ruler ticks={ticks} totalNs={totalNs} barAreaStart={barAreaStart} />
						<g className="otelux-waterfall__rows" transform={`translate(0, ${RULER_HEIGHT})`}>
							{ticks.map((tickNs) => (
								<line
									key={`tick-${tickNs}`}
									x1={timeToX(tickNs, totalNs, barAreaStart, BAR_AREA_WIDTH)}
									x2={timeToX(tickNs, totalNs, barAreaStart, BAR_AREA_WIDTH)}
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
}

function Ruler(props: RulerProps): JSX.Element {
	const { ticks, totalNs, barAreaStart } = props;
	return (
		<g className="otelux-waterfall__ruler" aria-hidden>
			<rect x={0} y={0} width="100%" height={RULER_HEIGHT} className="otelux-waterfall__ruler-bg" />
			{ticks.map((tickNs) => {
				const x = timeToX(tickNs, totalNs, barAreaStart, BAR_AREA_WIDTH);
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
	selected: boolean;
	onSelect(spanId: SpanId): void;
}

function Row(props: RowProps): JSX.Element {
	const { row, totalNs, barAreaStart, selected, onSelect } = props;
	const y = row.index * (ROW_HEIGHT + ROW_PADDING);
	const labelX = row.depth * DEPTH_INDENT + 4;

	const startNs = nanosToNumber(row.startOffsetNanos);
	const endNs = startNs + nanosToNumber(row.durationNanos);
	const x = timeToX(startNs, totalNs, barAreaStart, BAR_AREA_WIDTH);
	const xEnd = timeToX(endNs, totalNs, barAreaStart, BAR_AREA_WIDTH);
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
