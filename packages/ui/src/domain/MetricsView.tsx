/**
 * `MetricsView` — instrument explorer (Phase 3).
 *
 * Traces answer "what happened", logs answer "what was said"; metrics
 * answer "how much / how often / how long". The Codex workload emits a
 * handful of instruments per meter (counters like `codex.api_request`,
 * token-usage sums, and `*_ms` duration histograms), so this surface uses
 * a meter/instrument explorer: select a meter on the left, then inspect a
 * focused instrument on the right. Scalar Sums/Gauges render as a
 * dependency-free SVG line chart, Histograms as bucket bars. Every focused
 * instrument can flip to a raw data-point table for exact values.
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

import type {
	DataSource,
	ListMetricInstrumentsResult,
	MetricInstrumentSummary,
} from '@otelux/protocol';
import type {
	AttributeValue,
	HistogramDataPoint,
	HistogramMetric,
	Metric,
	NumberDataPoint,
} from '@otelux/types';
import { AggregationTemporality } from '@otelux/types';
import { type CSSProperties, type JSX, useState } from 'react';
import { formatWallClock, nanosToNumber, serviceColorVar } from '../format.js';
import {
	Accordion,
	type AccordionItem,
	CopyButton,
	Drawer,
	EyeIcon,
	IconButton,
	ResultFooter,
	ValueViewer,
} from '../primitives/index.js';
import { useDataSourceQuery } from '../useDataSourceQuery.js';

export interface MetricsViewProps {
	dataSource: DataSource;
	/** Restrict to instruments emitted by any of these application-level sources. */
	sources?: readonly string[];
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
	/** When true, live updates are frozen (the explorer holds its instruments). */
	paused?: boolean;
}

const DEFAULT_LIMIT = 500;
const DEFAULT_ENDPOINT = 'http://localhost:4319/v1/metrics';

export function MetricsView(props: MetricsViewProps): JSX.Element {
	const {
		dataSource,
		sources,
		services,
		meters,
		search,
		limit = DEFAULT_LIMIT,
		endpointUrl = DEFAULT_ENDPOINT,
		paused = false,
	} = props;
	const [selectedMeter, setSelectedMeter] = useState<string | null>(null);
	const [selectedMetricKey, setSelectedMetricKey] = useState<string | null>(null);
	const [listRevision, setListRevision] = useState(0);
	const [detailsMetric, setDetailsMetric] = useState<{
		metric: Metric;
		totalPointCount: number;
		truncatedPointCount: number;
		metadataTruncated: boolean;
	} | null>(null);
	const [mode, setMode] = useState<ViewMode>('chart');
	const [viewValue, setViewValue] = useState<{ key: string; value: AttributeValue } | null>(null);

	// The serialization key must include every input that changes the
	// result set; otherwise the hook reuses a stale fetch when filters change.
	const queryKey = `metrics:${limit}:${(sources ?? []).join(',')}:${(services ?? []).join(',')}:${(meters ?? []).join(',')}:${search ?? ''}:${listRevision}`;
	const query = useDataSourceQuery<ListMetricInstrumentsResult>(
		dataSource,
		(ds) => {
			const q: Parameters<DataSource['listMetricInstruments']>[0] = { limit };
			if (sources && sources.length > 0) {
				q.sources = sources;
			}
			if (services && services.length > 0) {
				q.services = services;
			}
			if (meters && meters.length > 0) {
				q.meters = meters;
			}
			if (search) {
				q.search = search;
			}
			return ds.listMetricInstruments(q);
		},
		queryKey,
		paused,
		'metricsChanged',
		true,
		undefined,
		2_000,
	);

	const rows = query.value?.rows ?? [];
	const groups = groupByMeter(rows);
	const selection = resolveMetricSelection(groups, selectedMeter, selectedMetricKey);
	const selectedSummary = selection.activeMetric;
	const selectedKey = selectedSummary?.instrumentId ?? '';
	const detailQuery = useDataSourceQuery<
		| {
				instrumentId: string;
				metric: Metric;
				totalPointCount: number;
				truncatedPointCount: number;
				metadataTruncated: boolean;
		  }
		| undefined
	>(
		dataSource,
		async (ds) => {
			if (!selectedSummary) return undefined;
			const result = await ds.getMetricPoints({
				instrumentId: selectedSummary.instrumentId,
				limit: 120,
			});
			return {
				instrumentId: selectedSummary.instrumentId,
				metric: result.metric,
				totalPointCount: result.totalPointCount,
				truncatedPointCount: result.truncatedAttributes?.length ?? 0,
				metadataTruncated:
					result.metadataTruncated === true ||
					result.resourceAttributesTruncated !== undefined ||
					result.scopeAttributesTruncated !== undefined ||
					result.histogramBucketsTruncated !== undefined,
			};
		},
		`metric-detail:${selectedKey}`,
		paused,
		'metricsChanged',
		selectedSummary !== undefined,
		undefined,
		2_000,
	);
	const activeMetric =
		detailQuery.value && detailQuery.value.instrumentId === selectedSummary?.instrumentId
			? detailQuery.value
			: undefined;

	return (
		<>
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
						<div className="otelux-metrics__explorer">
							<MetricTree
								groups={groups}
								activeMeter={selection.activeMeter}
								activeMetricKey={selection.activeMetric?.instrumentId}
								onSelectMeter={(meter) => {
									setSelectedMeter(meter);
									setSelectedMetricKey(null);
								}}
								onSelectMetric={(metric) => {
									setSelectedMeter(instrumentGroupKey(metric));
									setSelectedMetricKey(metric.instrumentId);
								}}
							/>
							<div className="otelux-metrics__workspace">
								{activeMetric ? (
									<MetricWorkspace
										metric={activeMetric.metric}
										totalPointCount={activeMetric.totalPointCount}
										mode={mode}
										onModeChange={setMode}
										onShowDetails={() => setDetailsMetric(activeMetric)}
									/>
								) : detailQuery.error ? (
									<div className="otelux-metrics__empty" role="alert">
										<p>This instrument is no longer retained.</p>
										<button
											type="button"
											className="otelux-load-more"
											onClick={() => {
												setSelectedMetricKey(null);
												setListRevision((revision) => revision + 1);
											}}
										>
											Refresh instruments
										</button>
									</div>
								) : selectedSummary ? (
									<div className="otelux-metrics__empty">Loading metric points…</div>
								) : selection.activeGroup ? (
									<MeterInstrumentTable
										group={selection.activeGroup}
										onSelectMetric={(metric) => {
											setSelectedMeter(instrumentGroupKey(metric));
											setSelectedMetricKey(metric.instrumentId);
										}}
									/>
								) : null}
							</div>
						</div>
					)}
				</div>
				{rows.length > 0 ? (
					<ResultFooter
						count={query.value?.totalCount ?? rows.length}
						noun="instrument"
						paused={paused}
					/>
				) : null}
			</section>
			<Drawer
				open={detailsMetric !== null}
				onClose={() => setDetailsMetric(null)}
				{...(detailsMetric
					? {
							title: detailsMetric.metric.name,
							accentVar: serviceColorVar(metricService(detailsMetric.metric) ?? detailsMetric.metric.name),
							kindLabel: kindLabel(detailsMetric.metric),
						}
					: {})}
			>
				{detailsMetric ? (
					<MetricDetail
						metric={detailsMetric.metric}
						totalPointCount={detailsMetric.totalPointCount}
						truncatedPointCount={detailsMetric.truncatedPointCount}
						metadataTruncated={detailsMetric.metadataTruncated}
						onViewValue={(key, value) => setViewValue({ key, value })}
					/>
				) : null}
			</Drawer>
			<ValueViewer
				open={viewValue !== null}
				onClose={() => setViewValue(null)}
				{...(viewValue !== null ? { title: viewValue.key, value: viewValue.value } : { value: '' })}
			/>
		</>
	);
}

interface MeterGroup {
	key: string;
	label: string;
	meter: string;
	service: string;
	metrics: MetricInstrumentSummary[];
}

interface MetricSelection {
	activeGroup: MeterGroup | undefined;
	activeMetric: MetricInstrumentSummary | undefined;
	activeMeter: string | undefined;
}

// OpenTelemetry instrument identity includes service + meter + name + type.
// Group by the same service/meter boundary so equal names from codex_exec and
// codex_cli_rs never appear as unexplained duplicates under one heading.
function groupByMeter(rows: readonly MetricInstrumentSummary[]): MeterGroup[] {
	const groups = new Map<string, MeterGroup>();
	for (const metric of rows) {
		const meter = metric.meterName || '(default)';
		const service = metric.serviceName ?? '(no service)';
		const source = metric.sourceName ?? service;
		const key = instrumentGroupKey(metric);
		const existing = groups.get(key);
		if (existing) existing.metrics.push(metric);
		else {
			groups.set(key, {
				key,
				label: source === service ? `${service} / ${meter}` : `${source} / ${service} / ${meter}`,
				meter,
				service,
				metrics: [metric],
			});
		}
	}
	return [...groups.values()]
		.sort((a, b) => a.service.localeCompare(b.service) || a.meter.localeCompare(b.meter))
		.map((group) => ({
			...group,
			metrics: group.metrics.sort((a, b) => a.name.localeCompare(b.name)),
		}));
}

type ViewMode = 'chart' | 'table';

function resolveMetricSelection(
	groups: readonly MeterGroup[],
	selectedMeter: string | null,
	selectedMetricKey: string | null,
): MetricSelection {
	if (selectedMetricKey !== null) {
		for (const group of groups) {
			const metric = group.metrics.find((candidate) => candidate.instrumentId === selectedMetricKey);
			if (metric !== undefined) {
				return { activeGroup: group, activeMetric: metric, activeMeter: group.key };
			}
		}
	}

	if (selectedMeter !== null) {
		const group = groups.find((candidate) => candidate.key === selectedMeter);
		if (group !== undefined) {
			return { activeGroup: group, activeMetric: undefined, activeMeter: group.key };
		}
	}

	const firstGroup = groups[0];
	const firstMetric = firstGroup?.metrics[0];
	return { activeGroup: firstGroup, activeMetric: firstMetric, activeMeter: firstGroup?.key };
}

function MetricTree(props: {
	groups: readonly MeterGroup[];
	activeMeter: string | undefined;
	activeMetricKey: string | undefined;
	onSelectMeter(meter: string): void;
	onSelectMetric(metric: MetricInstrumentSummary): void;
}): JSX.Element {
	return (
		<aside className="otelux-metrics-nav" aria-label="Metric instruments">
			<header className="otelux-metrics-nav__header">
				<span className="otelux-metrics-nav__title">Instruments</span>
				<span className="otelux-metrics-nav__count">
					{props.groups.reduce((count, group) => count + group.metrics.length, 0)}
				</span>
			</header>
			<div className="otelux-metrics-tree">
				{props.groups.map((group) => {
					const meterIsActive = props.activeMetricKey === undefined && props.activeMeter === group.key;
					return (
						<div key={group.key} className="otelux-metrics-tree__group">
							<button
								type="button"
								className={`otelux-metrics-tree__meter${meterIsActive ? ' is-active' : ''}`}
								onClick={() => props.onSelectMeter(group.key)}
								aria-pressed={meterIsActive}
							>
								<span className="otelux-metrics-tree__meter-name" title={group.label}>
									{group.label}
								</span>
								<span className="otelux-metrics-tree__meter-count">{group.metrics.length}</span>
							</button>
							<div className="otelux-metrics-tree__instruments">
								{group.metrics.map((metric) => {
									const key = metric.instrumentId;
									return (
										<button
											type="button"
											key={key}
											className={`otelux-metrics-tree__instrument${
												props.activeMetricKey === key ? ' is-active' : ''
											}`}
											onClick={() => props.onSelectMetric(metric)}
											aria-pressed={props.activeMetricKey === key}
										>
											<span className="otelux-metrics-tree__instrument-name" title={metric.name}>
												{metric.name}
											</span>
											<span className="otelux-metrics-tree__instrument-meta">
												{kindLabel(metric)}
												{metric.unit ? ` · ${metric.unit}` : ''}
											</span>
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</aside>
	);
}

function MeterInstrumentTable(props: {
	group: MeterGroup;
	onSelectMetric(metric: MetricInstrumentSummary): void;
}): JSX.Element {
	return (
		<section className="otelux-meter-overview" aria-label={`Meter ${props.group.label}`}>
			<header className="otelux-meter-overview__header">
				<div className="otelux-meter-overview__title-block">
					<span className="otelux-meter-overview__eyebrow">Meter</span>
					<h3 className="otelux-meter-overview__title" title={props.group.label}>
						{props.group.label}
					</h3>
				</div>
				<span className="otelux-meter-overview__count">{props.group.metrics.length}</span>
			</header>
			<table className="otelux-metric-table otelux-meter-overview__table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Type</th>
						<th>Service</th>
						<th>Latest</th>
						<th>Unit</th>
						<th>Updated</th>
						<th>Points</th>
					</tr>
				</thead>
				<tbody>
					{props.group.metrics.map((metric) => {
						const updated = metric.latest?.timeUnixNano;
						return (
							<tr key={metric.instrumentId}>
								<td>
									<button
										type="button"
										className="otelux-meter-overview__link"
										onClick={() => props.onSelectMetric(metric)}
									>
										{metric.name}
									</button>
								</td>
								<td>{kindLabel(metric)}</td>
								<td>{metric.serviceName ?? '—'}</td>
								<td className="otelux-metric-table__num">{latestInstrumentSummary(metric)}</td>
								<td>{metric.unit || '—'}</td>
								<td>{updated !== undefined ? formatWallClock(updated) : '—'}</td>
								<td className="otelux-metric-table__num">{metric.pointCount}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</section>
	);
}

function MetricWorkspace(props: {
	metric: Metric;
	totalPointCount: number;
	mode: ViewMode;
	onModeChange(mode: ViewMode): void;
	onShowDetails(): void;
}): JSX.Element {
	const { metric, totalPointCount, mode, onModeChange, onShowDetails } = props;
	const service = metricService(metric);
	const latest = latestMetricSummary(metric);
	const updated = latestMetricTime(metric);
	const unit = metric.unit || '—';

	return (
		<article
			className="otelux-metric otelux-metric--focused"
			aria-label={`Instrument ${metric.name}`}
		>
			<header className="otelux-metric__header">
				<div className="otelux-metric__id">
					<span className="otelux-metric__name" title={metric.name}>
						{metric.name}
					</span>
					{metric.unit ? <span className="otelux-metric__unit">{metric.unit}</span> : null}
					{service !== undefined ? (
						<span className="otelux-metric__svc">
							<span
								className="otelux-metric__svc-dot"
								style={{ background: serviceColorVar(service) }}
								aria-hidden
							/>
							{service}
						</span>
					) : null}
				</div>
				<div className="otelux-metric__badges">
					<span className={`otelux-metric__kind otelux-metric__kind--${metric.type}`}>
						{kindLabel(metric)}
					</span>
					{temporalityLabel(metric) ? (
						<span className="otelux-metric__temporality">{temporalityLabel(metric)}</span>
					) : null}
					<div className="otelux-metric__actions" aria-label={`Actions for ${metric.name}`}>
						<CopyButton
							value={metric.name}
							title="Copy metric name"
							ariaLabel={`Copy metric name ${metric.name}`}
							className="otelux-metric__action otelux-metric__copy-action"
							iconSize={12}
						>
							Name
						</CopyButton>
						<CopyButton
							value={metricDataJson(metric)}
							title="Copy metric data"
							ariaLabel={`Copy metric data ${metric.name}`}
							className="otelux-metric__action otelux-metric__copy-action"
							iconSize={12}
						>
							Data
						</CopyButton>
						<IconButton
							className="otelux-metric__action otelux-metric__details-action"
							aria-label={`View metric details ${metric.name}`}
							onClick={onShowDetails}
						>
							<EyeIcon size={14} />
						</IconButton>
					</div>
					<div className="otelux-metric__toggle">
						<button
							type="button"
							className={`otelux-metric__toggle-btn${mode === 'chart' ? ' is-active' : ''}`}
							aria-pressed={mode === 'chart'}
							onClick={() => onModeChange('chart')}
						>
							Graph
						</button>
						<button
							type="button"
							className={`otelux-metric__toggle-btn${mode === 'table' ? ' is-active' : ''}`}
							aria-pressed={mode === 'table'}
							onClick={() => onModeChange('table')}
						>
							Table
						</button>
					</div>
				</div>
			</header>
			<div className="otelux-metric__summary" aria-label={`Summary for ${metric.name}`}>
				<MetricSummaryCell label="Type" value={kindLabel(metric)} />
				<MetricSummaryCell label="Service" value={service ?? '—'} />
				<MetricSummaryCell label="Latest" value={latest} strong />
				<MetricSummaryCell label="Unit" value={unit} />
				<MetricSummaryCell
					label="Updated"
					value={updated !== undefined ? formatWallClock(updated) : '—'}
				/>
				<MetricSummaryCell
					label="Points"
					value={
						totalPointCount === metricPointCount(metric)
							? String(totalPointCount)
							: `${metricPointCount(metric)} loaded / ${totalPointCount} total`
					}
				/>
			</div>
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

function instrumentGroupKey(metric: MetricInstrumentSummary): string {
	return `${metric.sourceName ?? ''}\u0000${metric.serviceName ?? ''}\u0000${metric.meterName || '(default)'}`;
}

function MetricSummaryCell(props: { label: string; value: string; strong?: boolean }): JSX.Element {
	return (
		<span className="otelux-metric__summary-cell">
			<span className="otelux-metric__summary-label">{props.label}</span>
			<span
				className={`otelux-metric__summary-value${props.strong ? ' is-strong' : ''}`}
				title={props.value}
			>
				{props.value}
			</span>
		</span>
	);
}

interface MetricDetailProps {
	metric: Metric;
	totalPointCount: number;
	truncatedPointCount: number;
	metadataTruncated: boolean;
	onViewValue?: (key: string, value: AttributeValue) => void;
}

function MetricDetail(props: MetricDetailProps): JSX.Element {
	const { metric, totalPointCount, truncatedPointCount, metadataTruncated, onViewValue } = props;
	const items: AccordionItem[] = [
		{
			id: 'instrument',
			label: 'Instrument',
			defaultOpen: true,
			children: <MetricFacts metric={metric} totalPointCount={totalPointCount} />,
		},
		{
			id: 'data-points',
			label: 'Data points',
			badge: metricPointCount(metric),
			defaultOpen: true,
			children: <MetricDataPointTable metric={metric} />,
		},
		{
			id: 'resource',
			label: 'Resource',
			badge: Object.keys(metric.resource.attributes).length,
			children: (
				<AttributeTable
					attributes={metric.resource.attributes}
					{...(onViewValue !== undefined ? { onViewValue } : {})}
				/>
			),
		},
		{
			id: 'scope',
			label: 'Scope',
			children: (
				<div className="otelux-kv">
					<KVRow label="Name" value={metric.scope.name || '(unnamed)'} />
					{metric.scope.version !== undefined ? (
						<KVRow label="Version" value={metric.scope.version} />
					) : null}
					{metric.scope.attributes !== undefined ? (
						<AttributeTable
							attributes={metric.scope.attributes}
							{...(onViewValue !== undefined ? { onViewValue } : {})}
						/>
					) : null}
				</div>
			),
		},
	];

	return (
		<div className="otelux-metric-detail">
			{truncatedPointCount > 0 || metadataTruncated ? (
				<output className="otelux-metric__desc">
					Large telemetry was projected to bounded chart data
					{truncatedPointCount > 0 ? ` for ${truncatedPointCount} points` : ''}.
				</output>
			) : null}
			<Accordion items={items} />
		</div>
	);
}

function MetricFacts(props: { metric: Metric; totalPointCount: number }): JSX.Element {
	const { metric, totalPointCount } = props;
	const service = metricService(metric);
	const updated = latestMetricTime(metric);
	const temporality = temporalityLabel(metric);
	return (
		<div className="otelux-kv">
			<KVRow label="Name" value={metric.name} mono />
			<KVRow label="Type" value={kindLabel(metric)} />
			{temporality !== undefined ? <KVRow label="Temporality" value={temporality} /> : null}
			<KVRow label="Service" value={service ?? '—'} />
			<KVRow label="Unit" value={metric.unit || '—'} />
			{metric.description !== undefined ? (
				<KVRow label="Description" value={metric.description} />
			) : null}
			<KVRow label="Latest" value={latestMetricSummary(metric)} />
			<KVRow label="Updated" value={updated !== undefined ? formatWallClock(updated) : '—'} />
			<KVRow
				label="Data points"
				value={
					totalPointCount === metricPointCount(metric)
						? String(totalPointCount)
						: `${metricPointCount(metric)} loaded / ${totalPointCount} total`
				}
			/>
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
			<span className="otelux-kv__view" />
		</div>
	);
}

function AttributeTable(props: {
	attributes: Readonly<Record<string, AttributeValue>>;
	onViewValue?: (key: string, value: AttributeValue) => void;
}): JSX.Element {
	const entries = Object.entries(props.attributes).sort((a, b) => a[0].localeCompare(b[0]));
	if (entries.length === 0) {
		return <div className="otelux-kv__empty">none</div>;
	}
	return (
		<div className="otelux-kv">
			{entries.map(([key, value]) => {
				const rendered = renderAttributeValue(value);
				return (
					<div key={key} className="otelux-kv__row">
						<span className="otelux-kv__key">{key}</span>
						<span className="otelux-kv__val otelux-kv__val--mono" title={rendered}>
							{rendered}
						</span>
						{props.onViewValue !== undefined ? (
							<IconButton
								aria-label={`View value for ${key}`}
								className="otelux-kv__view"
								onClick={() => props.onViewValue?.(key, value)}
							>
								<EyeIcon size={14} />
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

function MetricDataPointTable(props: { metric: Metric }): JSX.Element {
	const { metric } = props;
	if (metric.type === 'histogram') {
		const sorted = [...metric.dataPoints].sort((a, b) => Number(b.timeUnixNano - a.timeUnixNano));
		if (sorted.length === 0) {
			return <div className="otelux-kv__empty">No data points.</div>;
		}
		return (
			<table className="otelux-metric-table otelux-metric-detail__table">
				<thead>
					<tr>
						<th>Time</th>
						<th>Count</th>
						<th>Sum</th>
						<th>Min</th>
						<th>Max</th>
						<th>Attributes</th>
					</tr>
				</thead>
				<tbody>
					{sorted.map((point, i) => (
						<tr key={`${point.timeUnixNano}:${i}`}>
							<td>{formatWallClock(point.timeUnixNano)}</td>
							<td className="otelux-metric-table__num">{point.count}</td>
							<td className="otelux-metric-table__num">
								{point.sum !== undefined ? formatNumber(point.sum) : '—'}
							</td>
							<td className="otelux-metric-table__num">
								{point.min !== undefined ? formatNumber(point.min) : '—'}
							</td>
							<td className="otelux-metric-table__num">
								{point.max !== undefined ? formatNumber(point.max) : '—'}
							</td>
							<td className="otelux-metric-table__attrs">{formatAttributes(point.attributes)}</td>
						</tr>
					))}
				</tbody>
			</table>
		);
	}

	return <ScalarTable points={metric.dataPoints} />;
}

function latestInstrumentSummary(metric: MetricInstrumentSummary): string {
	const latest = metric.latest;
	if (!latest) return '—';
	if (latest.kind === 'histogram') {
		return `${latest.count} obs${latest.sum !== undefined && latest.sum > 0 ? ` / ${formatNumber(latest.sum)} sum` : ''}`;
	}
	return formatNumber(latest.value);
}

function latestMetricSummary(metric: Metric): string {
	if (metric.type === 'histogram') {
		const count = metric.dataPoints.reduce((acc, point) => acc + point.count, 0);
		const sum = metric.dataPoints.reduce((acc, point) => acc + (point.sum ?? 0), 0);
		return `${count} obs${sum > 0 ? ` / ${formatNumber(sum)} sum` : ''}`;
	}
	const latest = latestScalarPoint(metric.dataPoints);
	return latest !== undefined ? formatNumber(latest.value) : '—';
}

function latestMetricTime(metric: Metric): bigint | undefined {
	const points = metric.dataPoints;
	const first = points[0];
	if (first === undefined) {
		return undefined;
	}
	return points.reduce(
		(latest, point) => (point.timeUnixNano > latest ? point.timeUnixNano : latest),
		first.timeUnixNano,
	);
}

function latestScalarPoint(points: readonly NumberDataPoint[]): ScalarChartPoint | undefined {
	return aggregateScalarPointsByTime(points).at(-1);
}

function metricPointCount(metric: Metric): number {
	return metric.dataPoints.length;
}

function metricDataJson(metric: Metric): string {
	return JSON.stringify(toSerializable(metric), null, 2);
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function toSerializable(value: unknown): JsonValue {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'bigint') {
		return value.toString();
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => toSerializable(item));
	}
	if (typeof value === 'object') {
		const result: { [key: string]: JsonValue } = {};
		for (const [key, child] of Object.entries(value)) {
			result[key] = toSerializable(child);
		}
		return result;
	}
	return String(value);
}

function renderAttributeValue(value: AttributeValue): string {
	if (typeof value === 'bigint') {
		return value.toString();
	}
	if (Array.isArray(value)) {
		return value.map((v) => String(v)).join(', ');
	}
	return String(value);
}

const CHART_W = 640;
const CHART_H = 180;
const CHART_PAD_X = 14;
const CHART_PAD_TOP = 12;
const CHART_PAD_BOTTOM = 18;

interface ScalarChartPoint {
	timeUnixNano: bigint;
	time: number;
	value: number;
	rawCount: number;
}

function aggregateScalarPointsByTime(points: readonly NumberDataPoint[]): ScalarChartPoint[] {
	const byTime = new Map<bigint, { value: number; rawCount: number }>();
	for (const point of points) {
		const bucket = byTime.get(point.timeUnixNano);
		if (bucket !== undefined) {
			bucket.value += point.value;
			bucket.rawCount += 1;
		} else {
			byTime.set(point.timeUnixNano, { value: point.value, rawCount: 1 });
		}
	}
	return Array.from(byTime.entries())
		.map(([timeUnixNano, point]) => ({
			timeUnixNano,
			time: nanosToNumber(timeUnixNano),
			value: point.value,
			rawCount: point.rawCount,
		}))
		.sort((a, b) => a.time - b.time);
}

// Dependency-free line chart for scalar (Sum/Gauge) instruments. Plots value
// against time; a single point renders as a dot. Multiple attribute series can
// share an export timestamp, so the graph aggregates those raw points into a
// per-timestamp total. The table keeps the unaggregated rows for inspection.
function LineChart(props: { points: readonly NumberDataPoint[]; colorVar: string }): JSX.Element {
	const { points, colorVar } = props;
	if (points.length === 0) {
		return <div className="otelux-metric__nodata">No data points</div>;
	}

	const chartPoints = aggregateScalarPointsByTime(points);
	const values = chartPoints.map((p) => p.value);
	const tMin = chartPoints[0]?.time ?? 0;
	const tMax = chartPoints.at(-1)?.time ?? tMin;
	const vMin = Math.min(...values, 0);
	const vMax = Math.max(...values, 0);
	const tSpan = tMax - tMin || 1;
	const vSpan = vMax - vMin || 1;

	const x = (t: number): number => CHART_PAD_X + ((t - tMin) / tSpan) * (CHART_W - 2 * CHART_PAD_X);
	const y = (v: number): number =>
		CHART_H - CHART_PAD_BOTTOM - ((v - vMin) / vSpan) * (CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM);

	const coords = chartPoints.map((p) => ({ cx: x(p.time), cy: y(p.value), p }));
	const dotStyle = (c: (typeof coords)[number]): CSSProperties => ({
		left: `${(c.cx / CHART_W) * 100}%`,
		top: `${(c.cy / CHART_H) * 100}%`,
		backgroundColor: colorVar,
	});
	const path = coords
		.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.cx.toFixed(1)},${c.cy.toFixed(1)}`)
		.join(' ');
	const last = chartPoints.at(-1);
	const topGridY = y(vMax);
	const midGridY = y(vMin + vSpan / 2);
	const zeroY = y(0);

	return (
		<div className="otelux-linechart">
			<div className="otelux-linechart__y-axis" aria-hidden="true">
				<span>{formatNumber(vMax)}</span>
				<span>{formatNumber(vMin)}</span>
			</div>
			<div className="otelux-linechart__plot">
				<svg
					viewBox={`0 0 ${CHART_W} ${CHART_H}`}
					role="img"
					aria-label="Metric over time"
					preserveAspectRatio="none"
					className="otelux-linechart__svg"
				>
					<line
						x1={CHART_PAD_X}
						y1={topGridY}
						x2={CHART_W - CHART_PAD_X}
						y2={topGridY}
						className="otelux-linechart__grid"
					/>
					<line
						x1={CHART_PAD_X}
						y1={midGridY}
						x2={CHART_W - CHART_PAD_X}
						y2={midGridY}
						className="otelux-linechart__grid"
					/>
					<line
						x1={CHART_PAD_X}
						y1={zeroY}
						x2={CHART_W - CHART_PAD_X}
						y2={zeroY}
						className="otelux-linechart__zero"
					/>
					<line
						x1={CHART_PAD_X}
						y1={CHART_PAD_TOP}
						x2={CHART_PAD_X}
						y2={CHART_H - CHART_PAD_BOTTOM}
						className="otelux-linechart__axis"
					/>
					<line
						x1={CHART_PAD_X}
						y1={CHART_H - CHART_PAD_BOTTOM}
						x2={CHART_W - CHART_PAD_X}
						y2={CHART_H - CHART_PAD_BOTTOM}
						className="otelux-linechart__axis"
					/>
					{coords.length > 1 ? (
						<path d={path} fill="none" stroke={colorVar} className="otelux-linechart__line" />
					) : null}
				</svg>
				{coords.map((c) => (
					<span
						key={`${c.p.timeUnixNano}`}
						className="otelux-linechart__dot"
						style={dotStyle(c)}
						title={`${formatWallClock(c.p.timeUnixNano)} · ${formatNumber(c.p.value)}${
							c.p.rawCount > 1 ? ` from ${c.p.rawCount} series` : ''
						}`}
					/>
				))}
			</div>
			{last ? (
				<div className="otelux-linechart__legend">
					<span className="otelux-linechart__latest">{formatNumber(last.value)}</span>
					<span className="otelux-linechart__latest-label">latest</span>
				</div>
			) : null}
			<div className="otelux-linechart__x-axis" aria-hidden="true">
				<span>{formatWallClock(chartPoints[0]?.timeUnixNano ?? 0n)}</span>
				<span>{formatWallClock(chartPoints.at(-1)?.timeUnixNano ?? 0n)}</span>
			</div>
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

function kindLabel(metric: { type: Metric['type']; isMonotonic?: boolean }): string {
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
