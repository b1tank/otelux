/**
 * `MetricsView` — instrument explorer (Phase 3).
 *
 * Traces answer "what happened", logs answer "what was said"; metrics
 * answer "how much / how often / how long". The Codex workload emits a
 * handful of instruments per meter (counters like `codex.api_request`,
 * token-usage sums, and `*_ms` duration histograms), so this surface
 * groups instruments by **meter** (the instrumentation scope) and renders
 * each one inline: scalar Sums/Gauges as a dependency-free SVG line chart,
 * Histograms as bucket bars. Every instrument can flip to a raw data-point
 * table for exact values.
 *
 * Filtering is delegated to the data source via `ListMetricsQuery`:
 *   - `services` -> resource `service.name`
 *   - `meters`   -> instrumentation scope name
 *   - `search`   -> free-text over instrument name/description
 *
 * Re-fetches when the DataSource notifies (`metricsChanged`). No charting
 * library by design — the workbench forbids CSP-hostile deps, so charts are
 * hand-rolled inline SVG. Layered import discipline: lives in `src/domain/`
 * and depends on `primitives` + `format.ts` + types only; it MUST NOT import
 * other domain components.
 */

import type { DataSource, ListMetricsResult } from '@otelux/protocol';
import type { HistogramDataPoint, HistogramMetric, Metric, NumberDataPoint } from '@otelux/types';
import { AggregationTemporality } from '@otelux/types';
import { type JSX, useState } from 'react';
import { formatWallClock, nanosToNumber, serviceColorVar } from '../format.js';
import { useDataSourceQuery } from '../useDataSourceQuery.js';

export interface MetricsViewProps {
	dataSource: DataSource;
	/** Restrict to instruments emitted by any of these service names. */
	services?: readonly string[];
	/** Restrict to instruments emitted by any of these meter (scope) names. */
	meters?: readonly string[];
	/** Free-text search applied by the data source. */
	search?: string;
	/** Max instruments fetched. */
	limit?: number;
	/** Hint text shown in the empty state. */
	endpointUrl?: string;
}

const DEFAULT_LIMIT = 500;
const DEFAULT_ENDPOINT = 'http://localhost:4319/v1/metrics';

export function MetricsView(props: MetricsViewProps): JSX.Element {
	const {
		dataSource,
		services,
		meters,
		search,
		limit = DEFAULT_LIMIT,
		endpointUrl = DEFAULT_ENDPOINT,
	} = props;

	// The serialization key must include every input that changes the
	// result set; otherwise the hook reuses a stale fetch when filters change.
	const queryKey = `metrics:${limit}:${(services ?? []).join(',')}:${(meters ?? []).join(',')}:${search ?? ''}`;
	const query = useDataSourceQuery<ListMetricsResult>(
		dataSource,
		(ds) => {
			const q: Parameters<DataSource['listMetrics']>[0] = { limit };
			if (services && services.length > 0) {
				q.services = services;
			}
			if (meters && meters.length > 0) {
				q.meters = meters;
			}
			if (search) {
				q.search = search;
			}
			return ds.listMetrics(q);
		},
		queryKey,
	);

	const rows = query.value?.rows ?? [];
	const groups = groupByMeter(rows);

	return (
		<section className="otelux-metrics" aria-label="Metrics">
			<header className="otelux-metrics__header">
				<span className="otelux-metrics__title">Metrics</span>
				<span className="otelux-metrics__count">{query.value?.totalCount ?? 0}</span>
			</header>
			<div className="otelux-metrics__body">
				{query.loading && rows.length === 0 ? (
					<div className="otelux-metrics__empty">Waiting for metrics…</div>
				) : rows.length === 0 ? (
					<div className="otelux-metrics__empty">
						No metrics match. Point an OTel metrics exporter at
						<br />
						<code>{endpointUrl}</code>
					</div>
				) : (
					<div className="otelux-metrics__meters">
						{groups.map((group) => (
							<section key={group.meter} className="otelux-meter" aria-label={`Meter ${group.meter}`}>
								<header className="otelux-meter__header">
									<span className="otelux-meter__name">{group.meter}</span>
									<span className="otelux-meter__count">{group.metrics.length}</span>
								</header>
								<div className="otelux-meter__instruments">
									{group.metrics.map((metric) => (
										<MetricCard key={`${metric.name}:${metric.type}`} metric={metric} />
									))}
								</div>
							</section>
						))}
					</div>
				)}
			</div>
		</section>
	);
}

interface MeterGroup {
	meter: string;
	metrics: Metric[];
}

// Group instruments by meter (instrumentation scope name). The engine
// already sorts by scope then name, so within a meter the order is stable.
function groupByMeter(rows: readonly Metric[]): MeterGroup[] {
	const byMeter = new Map<string, Metric[]>();
	for (const metric of rows) {
		const meter = metric.scope.name || '(default)';
		const bucket = byMeter.get(meter);
		if (bucket) {
			bucket.push(metric);
		} else {
			byMeter.set(meter, [metric]);
		}
	}
	return Array.from(byMeter.entries())
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([meter, metrics]) => ({ meter, metrics }));
}

type ViewMode = 'chart' | 'table';

function MetricCard(props: { metric: Metric }): JSX.Element {
	const { metric } = props;
	const [mode, setMode] = useState<ViewMode>('chart');
	const service = metricService(metric);

	return (
		<article className="otelux-metric" aria-label={`Instrument ${metric.name}`}>
			<header className="otelux-metric__header">
				<div className="otelux-metric__id">
					<span className="otelux-metric__name" title={metric.name}>
						{metric.name}
					</span>
					{metric.unit ? <span className="otelux-metric__unit">{metric.unit}</span> : null}
				</div>
				<div className="otelux-metric__badges">
					<span className={`otelux-metric__kind otelux-metric__kind--${metric.type}`}>
						{kindLabel(metric)}
					</span>
					{temporalityLabel(metric) ? (
						<span className="otelux-metric__temporality">{temporalityLabel(metric)}</span>
					) : null}
					<div className="otelux-metric__toggle">
						<button
							type="button"
							className={`otelux-metric__toggle-btn${mode === 'chart' ? ' is-active' : ''}`}
							aria-pressed={mode === 'chart'}
							onClick={() => setMode('chart')}
						>
							Graph
						</button>
						<button
							type="button"
							className={`otelux-metric__toggle-btn${mode === 'table' ? ' is-active' : ''}`}
							aria-pressed={mode === 'table'}
							onClick={() => setMode('table')}
						>
							Table
						</button>
					</div>
				</div>
			</header>
			{metric.description ? <p className="otelux-metric__desc">{metric.description}</p> : null}
			<div className="otelux-metric__chart">
				{mode === 'chart' ? (
					metric.type === 'histogram' ? (
						<HistogramChart metric={metric} />
					) : (
						<LineChart points={metric.dataPoints} colorVar={serviceColorVar(service ?? metric.name)} />
					)
				) : metric.type === 'histogram' ? (
					<HistogramTable metric={metric} />
				) : (
					<ScalarTable points={metric.dataPoints} />
				)}
			</div>
		</article>
	);
}

const CHART_W = 320;
const CHART_H = 96;
const CHART_PAD = 8;

// Dependency-free line chart for scalar (Sum/Gauge) instruments. Plots value
// against time; a single point renders as a dot. Codex's delta Sums produce
// a step-like series — good enough to eyeball rate/trend without a chart lib.
function LineChart(props: { points: readonly NumberDataPoint[]; colorVar: string }): JSX.Element {
	const { points, colorVar } = props;
	if (points.length === 0) {
		return <div className="otelux-metric__nodata">No data points</div>;
	}

	const sorted = [...points].sort((a, b) => Number(a.timeUnixNano - b.timeUnixNano));
	const times = sorted.map((p) => nanosToNumber(p.timeUnixNano));
	const values = sorted.map((p) => p.value);
	const tMin = Math.min(...times);
	const tMax = Math.max(...times);
	const vMin = Math.min(...values, 0);
	const vMax = Math.max(...values, 0);
	const tSpan = tMax - tMin || 1;
	const vSpan = vMax - vMin || 1;

	const x = (t: number): number => CHART_PAD + ((t - tMin) / tSpan) * (CHART_W - 2 * CHART_PAD);
	const y = (v: number): number =>
		CHART_H - CHART_PAD - ((v - vMin) / vSpan) * (CHART_H - 2 * CHART_PAD);

	const coords = sorted.map((p, i) => ({ cx: x(times[i] ?? 0), cy: y(p.value), p }));
	const path = coords
		.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`)
		.join(' ');
	const last = sorted[sorted.length - 1];

	return (
		<div className="otelux-linechart">
			<svg
				viewBox={`0 0 ${CHART_W} ${CHART_H}`}
				role="img"
				aria-label="Metric over time"
				preserveAspectRatio="none"
				className="otelux-linechart__svg"
			>
				<line
					x1={CHART_PAD}
					y1={y(0)}
					x2={CHART_W - CHART_PAD}
					y2={y(0)}
					className="otelux-linechart__axis"
				/>
				{coords.length > 1 ? (
					<path d={path} fill="none" stroke={colorVar} className="otelux-linechart__line" />
				) : null}
				{coords.map((c) => (
					<circle
						key={`${c.p.timeUnixNano}`}
						cx={c.cx}
						cy={c.cy}
						r={2.5}
						fill={colorVar}
						className="otelux-linechart__dot"
					/>
				))}
			</svg>
			{last ? (
				<div className="otelux-linechart__legend">
					<span className="otelux-linechart__latest">{formatNumber(last.value)}</span>
					<span className="otelux-linechart__latest-label">latest</span>
				</div>
			) : null}
		</div>
	);
}

// Aggregate histogram across all buffered data points (delta temporality
// means summing the per-export buckets yields the cumulative distribution).
function HistogramChart(props: { metric: HistogramMetric }): JSX.Element {
	const buckets = aggregateBuckets(props.metric.dataPoints);
	if (buckets.length === 0) {
		return <div className="otelux-metric__nodata">No data points</div>;
	}
	const max = Math.max(...buckets.map((b) => b.count), 1);
	const total = buckets.reduce((acc, b) => acc + b.count, 0);

	return (
		<div className="otelux-histogram">
			<div className="otelux-histogram__bars">
				{buckets.map((b) => (
					<div key={b.label} className="otelux-histogram__col" title={`${b.label}: ${b.count}`}>
						<span className="otelux-histogram__count">{b.count > 0 ? b.count : ''}</span>
						<div className="otelux-histogram__bar-track">
							<div className="otelux-histogram__bar" style={{ height: `${(b.count / max) * 100}%` }} />
						</div>
						<span className="otelux-histogram__label" title={b.label}>
							{b.label}
						</span>
					</div>
				))}
			</div>
			<div className="otelux-histogram__legend">
				<span className="otelux-histogram__total">{total}</span>
				<span className="otelux-histogram__total-label">observations</span>
			</div>
		</div>
	);
}

interface Bucket {
	label: string;
	count: number;
}

// Collapse the explicit-bucket histogram into labelled bars. `bucketCounts`
// has one more entry than `explicitBounds`; the trailing bucket is the
// `(lastBound, +∞)` overflow.
function aggregateBuckets(points: readonly HistogramDataPoint[]): Bucket[] {
	if (points.length === 0) {
		return [];
	}
	// Use the first point's bounds as the canonical layout; Codex keeps bounds
	// stable for an instrument so summing across exports is well-defined.
	const bounds = points[0]?.explicitBounds ?? [];
	const totals = new Array<number>(bounds.length + 1).fill(0);
	for (const p of points) {
		for (let i = 0; i < p.bucketCounts.length && i < totals.length; i++) {
			totals[i] = (totals[i] ?? 0) + (p.bucketCounts[i] ?? 0);
		}
	}
	return totals.map((count, i) => ({ label: bucketLabel(bounds, i), count }));
}

function bucketLabel(bounds: readonly number[], i: number): string {
	if (bounds.length === 0) {
		return 'all';
	}
	if (i === 0) {
		return `≤${formatNumber(bounds[0] ?? 0)}`;
	}
	if (i >= bounds.length) {
		return `>${formatNumber(bounds[bounds.length - 1] ?? 0)}`;
	}
	return `${formatNumber(bounds[i - 1] ?? 0)}–${formatNumber(bounds[i] ?? 0)}`;
}

function ScalarTable(props: { points: readonly NumberDataPoint[] }): JSX.Element {
	const sorted = [...props.points].sort((a, b) => Number(b.timeUnixNano - a.timeUnixNano));
	if (sorted.length === 0) {
		return <div className="otelux-metric__nodata">No data points</div>;
	}
	return (
		<table className="otelux-metric-table">
			<thead>
				<tr>
					<th>Time</th>
					<th>Value</th>
					<th>Attributes</th>
				</tr>
			</thead>
			<tbody>
				{sorted.map((p, i) => (
					<tr key={`${p.timeUnixNano}:${i}`}>
						<td>{formatWallClock(p.timeUnixNano)}</td>
						<td className="otelux-metric-table__num">{formatNumber(p.value)}</td>
						<td className="otelux-metric-table__attrs">{formatAttributes(p.attributes)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function HistogramTable(props: { metric: HistogramMetric }): JSX.Element {
	const buckets = aggregateBuckets(props.metric.dataPoints);
	if (buckets.length === 0) {
		return <div className="otelux-metric__nodata">No data points</div>;
	}
	const count = props.metric.dataPoints.reduce((acc, p) => acc + p.count, 0);
	const sum = props.metric.dataPoints.reduce((acc, p) => acc + (p.sum ?? 0), 0);
	return (
		<table className="otelux-metric-table">
			<thead>
				<tr>
					<th>Bucket</th>
					<th>Count</th>
				</tr>
			</thead>
			<tbody>
				{buckets.map((b) => (
					<tr key={b.label}>
						<td>{b.label}</td>
						<td className="otelux-metric-table__num">{b.count}</td>
					</tr>
				))}
				<tr className="otelux-metric-table__summary">
					<td>count / sum</td>
					<td className="otelux-metric-table__num">
						{count} / {formatNumber(sum)}
					</td>
				</tr>
			</tbody>
		</table>
	);
}

function kindLabel(metric: Metric): string {
	switch (metric.type) {
		case 'sum':
			return metric.isMonotonic ? 'Counter' : 'UpDownCounter';
		case 'gauge':
			return 'Gauge';
		case 'histogram':
			return 'Histogram';
	}
}

function temporalityLabel(metric: Metric): string | undefined {
	if (metric.type === 'gauge') {
		return undefined;
	}
	switch (metric.temporality) {
		case AggregationTemporality.Delta:
			return 'delta';
		case AggregationTemporality.Cumulative:
			return 'cumulative';
		default:
			return undefined;
	}
}

// `service.name` lives on the resource attribute bag per OTel resource
// conventions: https://opentelemetry.io/docs/specs/semconv/resource/.
function metricService(metric: Metric): string | undefined {
	const v = metric.resource.attributes['service.name'];
	return typeof v === 'string' ? v : undefined;
}

// Compact number formatting: keep small integers exact, abbreviate large
// magnitudes, and trim noisy decimals so charts/tables stay scannable.
function formatNumber(value: number): string {
	if (!Number.isFinite(value)) {
		return String(value);
	}
	const abs = Math.abs(value);
	if (abs >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (abs >= 10_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	if (Number.isInteger(value)) {
		return String(value);
	}
	return value.toFixed(2);
}

function formatAttributes(attributes: Readonly<Record<string, unknown>>): string {
	const entries = Object.entries(attributes);
	if (entries.length === 0) {
		return '—';
	}
	return entries.map(([k, v]) => `${k}=${String(v)}`).join(', ');
}
