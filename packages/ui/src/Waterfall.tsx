/**
 * Waterfall view. Renders the depth-first row layout produced by
 * `@otelux/engine/computeWaterfallLayout` as an SVG. Each row is a
 * single rectangle positioned by its start offset within the trace.
 *
 * SVG (vs canvas) gives us free hit-testing for `onSpanSelect` without
 * the trouble of building a quadtree. Per-service color keeps the visual
 * grouping stable across renders.
 */

import { type WaterfallRow, computeWaterfallLayout } from '@otelux/engine';
import type { SpanId, Trace } from '@otelux/types';
import { type JSX, useMemo } from 'react';
import { colorForService, formatDuration, nanosToNumber } from './format.js';

export interface WaterfallProps {
	trace: Trace;
	selectedSpanId?: SpanId;
	onSpanSelect: (spanId: SpanId) => void;
}

const ROW_HEIGHT = 22; // px
const ROW_PADDING = 2; // px between rows
const LABEL_COLUMN_WIDTH = 280; // px
const DEPTH_INDENT = 14; // px per depth level
const BAR_AREA_PADDING = 8; // px on each side of the bar area

export function Waterfall(props: WaterfallProps): JSX.Element {
	const { trace, selectedSpanId, onSpanSelect } = props;
	const layout = useMemo(() => computeWaterfallLayout(trace), [trace]);
	const total = nanosToNumber(layout.totalDurationNanos);

	const height = Math.max(ROW_HEIGHT, layout.rows.length * (ROW_HEIGHT + ROW_PADDING));

	return (
		<section className="otelux-waterfall" aria-label="Waterfall">
			<header className="otelux-waterfall__header">
				<span className="otelux-waterfall__name">{trace.rootSpan?.name ?? '(no spans)'}</span>
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
						height={height}
						role="img"
						aria-label="Span waterfall"
					>
						{layout.rows.map((row) => (
							<Row
								key={row.span.spanId}
								row={row}
								total={total}
								selected={row.span.spanId === selectedSpanId}
								onSelect={onSpanSelect}
							/>
						))}
					</svg>
				</div>
			)}
		</section>
	);
}

interface RowProps {
	row: WaterfallRow;
	total: number;
	selected: boolean;
	onSelect: (spanId: SpanId) => void;
}

function Row(props: RowProps): JSX.Element {
	const { row, total, selected, onSelect } = props;
	const y = row.index * (ROW_HEIGHT + ROW_PADDING);
	const labelX = row.depth * DEPTH_INDENT + 4;

	// Bar geometry. Treat negative or zero durations as a 1px tick so
	// instantaneous events stay visible.
	const start = nanosToNumber(row.startOffsetNanos);
	const dur = nanosToNumber(row.durationNanos);
	const totalNonZero = total > 0 ? total : 1;
	const barAreaStart = LABEL_COLUMN_WIDTH + BAR_AREA_PADDING;
	const barAreaWidth = 1000; // viewBox-scaled; outer container is responsive

	const x = barAreaStart + (start / totalNonZero) * barAreaWidth;
	const width = Math.max(1, (dur / totalNonZero) * barAreaWidth);
	const svc = row.span.resource.attributes['service.name'];
	const serviceName = typeof svc === 'string' ? svc : 'unknown';
	const fill = colorForService(serviceName);
	const isError = row.span.status.code === 2;

	return (
		<g
			className={`otelux-waterfall__row${selected ? ' otelux-waterfall__row--selected' : ''}`}
			onClick={() => onSelect(row.span.spanId)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onSelect(row.span.spanId);
				}
			}}
			cursor="pointer"
			tabIndex={0}
			aria-label={`Span ${row.span.name}`}
		>
			{selected && (
				<rect x={0} y={y} width="100%" height={ROW_HEIGHT} className="otelux-waterfall__row-bg" />
			)}
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
				fill={fill}
				stroke={isError ? '#f7768e' : 'none'}
				strokeWidth={isError ? 1.5 : 0}
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
