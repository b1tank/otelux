/**
 * `@otelux/ui` — composed React workbench.
 *
 * `OTeluxWorkbench` is the single entry point Desktop and runtime-served
 * browser hosts mount. It owns the redesigned layout (rail + topbar +
 * filterbar + resizable workbench + drawer) and consumes any `DataSource`.
 *
 * Layered import discipline: this file is the only composition surface
 * permitted to depend on both `layout/` and `domain/`. Individual
 * domain components MUST NOT import each other.
 */

import type {
	DataSource,
	LogListSort,
	ResourceFacet,
	SortDirection,
	TraceListSort,
} from '@otelux/protocol';
import type { AttributeValue, Span, SpanId, TraceId } from '@otelux/types';
import { SpanKind } from '@otelux/types';
import { type JSX, useCallback, useEffect, useState } from 'react';
import { LogsView, MetricsView, SpanDetail, TraceList, Waterfall } from './domain/index.js';
import { serviceColorVar, serviceIndex } from './format.js';
import { AppShell, FilterBar, Rail, type RailItem, Topbar, Workbench } from './layout/index.js';
import {
	BarChart3Icon,
	ConfirmDialog,
	Drawer,
	Dropdown,
	type DropdownOption,
	GithubIcon,
	InfoIcon,
	LivePauseToggle,
	LogsIcon,
	MonitorIcon,
	MoonIcon,
	OTeluxLogo,
	SearchField,
	SettingsIcon,
	SunIcon,
	ToggleChip,
	TrashIcon,
	ValueViewer,
	WaterfallIcon,
} from './primitives/index.js';
import { useDataSourceQuery } from './useDataSourceQuery.js';
import { useSelectedTrace } from './useSelectedTrace.js';

export { useDataSourceQuery } from './useDataSourceQuery.js';
export * from './domain/index.js';
export * from './layout/index.js';
export * from './primitives/index.js';
export {
	colorForService,
	formatDuration,
	formatTimeAgo,
	formatWallClock,
	SERVICE_PALETTE,
	serviceColorVar,
	serviceIndex,
} from './format.js';

export interface OTeluxWorkbenchProps {
	dataSource: DataSource;
	/** Initial theme mode. `auto` follows the OS color scheme. */
	theme?: ThemeMode;
	/**
	 * OTLP/HTTP traces endpoint shown in the empty-state hint. Hosts
	 * that know the live bind should pass the real URL so users copy-paste
	 * the right thing.
	 */
	endpointUrl?: string;
	/**
	 * Optional slot rendered at the right of the topbar. Hosts use it
	 * to expose endpoint/connection state without baking a specific
	 * shape into the workbench.
	 */
	topbarEnd?: JSX.Element;
	/**
	 * Invoked when the user clicks the settings cog at the bottom of
	 * the left rail. Hosts that own a settings surface (e.g. the
	 * desktop Settings modal) wire it here; left undefined the rail
	 * cog is rendered disabled.
	 */
	onOpenSettings?: () => void;
	/**
	 * Invoked when the user clicks the About button at the bottom of the
	 * left rail. Hosts provide their own build and runtime diagnostics surface.
	 */
	onOpenAbout?: () => void;
	/**
	 * Invoked when the user clicks "Load sample data" in the empty Traces
	 * view. Hosts that can seed synthetic telemetry (the desktop app) wire
	 * it here; left undefined the button is not rendered, so embedders
	 * without a seed path show only the plain empty state.
	 */
	onLoadSampleData?: () => void;
	/**
	 * Invoked when the user confirms "Clear data". Hosts that own the store
	 * (the desktop app) delete all stored telemetry here. Left undefined the
	 * clear control is not rendered.
	 */
	onClearData?: () => void;
}

export type ThemeMode = 'auto' | 'dark' | 'light';
type ResolvedTheme = 'dark' | 'light';

const THEME_MODE_ORDER: readonly ThemeMode[] = ['auto', 'light', 'dark'];

// The rail's three pillars (Traces / Metrics / Logs) are all live. The
// icon bar stays anchored at three so the layout never reflows as
// surfaces ship.
const RAIL_ITEMS: readonly RailItem[] = [
	{ id: 'traces', label: 'Traces', icon: <WaterfallIcon size={18} /> },
	{
		id: 'metrics',
		label: 'Metrics',
		icon: <BarChart3Icon size={18} />,
	},
	{ id: 'logs', label: 'Logs', icon: <LogsIcon size={18} /> },
];

// Trace-list sort presets. Each maps a friendly label to a (field, direction)
// the storage layer already supports, so "Slowest" / "Most errors" are just a
// different `ListTracesQuery` rather than any new query work.
const TRACE_SORT_PRESETS = {
	recent: { sortBy: 'startTime', sortDirection: 'desc', label: 'Most recent' },
	slowest: { sortBy: 'duration', sortDirection: 'desc', label: 'Slowest' },
	errors: { sortBy: 'errorCount', sortDirection: 'desc', label: 'Most errors' },
	spans: { sortBy: 'spanCount', sortDirection: 'desc', label: 'Most spans' },
	name: { sortBy: 'name', sortDirection: 'asc', label: 'Name (A\u2013Z)' },
} as const satisfies Record<
	string,
	{ sortBy: TraceListSort; sortDirection: SortDirection; label: string }
>;

type TraceSortKey = keyof typeof TRACE_SORT_PRESETS;
const TRACE_SORT_OPTIONS: readonly DropdownOption[] = Object.entries(TRACE_SORT_PRESETS).map(
	([value, preset]) => ({ value, label: preset.label }),
);

// Severity-floor options for the logs filter. Values are OTLP severity
// numbers; "All" clears the floor. See
// https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber.
const LOG_SEVERITY_LABELS: Readonly<Record<string, string>> = {
	all: 'All levels',
	'5': 'Debug+',
	'9': 'Info+',
	'13': 'Warn+',
	'17': 'Error+',
};
const LOG_SEVERITY_OPTIONS: readonly DropdownOption[] = [
	{ value: 'all', label: 'All levels' },
	{ value: '5', label: 'Debug+' },
	{ value: '9', label: 'Info+' },
	{ value: '13', label: 'Warn+' },
	{ value: '17', label: 'Error+' },
];

// Log sort presets. Like the trace presets, each maps a friendly label to a
// `ListLogsQuery` sort. `time` is the arrival/emit order; `severity` groups the
// most severe records first for triage.
const LOG_SORT_PRESETS = {
	newest: { sortBy: 'time', sortDirection: 'desc', label: 'Newest' },
	oldest: { sortBy: 'time', sortDirection: 'asc', label: 'Oldest' },
	severity: { sortBy: 'severity', sortDirection: 'desc', label: 'Highest severity' },
} as const satisfies Record<
	string,
	{ sortBy: LogListSort; sortDirection: SortDirection; label: string }
>;

type LogSortKey = keyof typeof LOG_SORT_PRESETS;
const LOG_SORT_OPTIONS: readonly DropdownOption[] = Object.entries(LOG_SORT_PRESETS).map(
	([value, preset]) => ({ value, label: preset.label }),
);

// Shown in the span-detail drawer header to the right of the span name.
// Matches the mockup's `.drawer__tag` (e.g. "Client", "Server"). We omit
// `Unspecified` entirely so the tag chip doesn't appear at all when the
// SDK didn't fill the field.
const SPAN_KIND_DRAWER_LABEL: Readonly<Record<number, string>> = {
	[SpanKind.Internal]: 'Internal',
	[SpanKind.Server]: 'Server',
	[SpanKind.Client]: 'Client',
	[SpanKind.Producer]: 'Producer',
	[SpanKind.Consumer]: 'Consumer',
};

interface ViewValueTarget {
	key: string;
	value: AttributeValue;
}

function buildFacetControl(
	rows: readonly ResourceFacet[],
	selected: string,
	plural: 'sources' | 'services',
): { readonly options: readonly DropdownOption[]; readonly triggerCount: number | undefined } {
	const counts = new Map(rows.map((row) => [row.name, row.count] as const));
	const options: DropdownOption[] = [];
	if (selected !== 'all') {
		options.push({ value: 'all', label: `All ${plural}`, count: rows.length });
	}
	for (const row of rows) {
		options.push({
			value: row.name,
			label: row.name,
			count: row.count,
			colorIndex: serviceIndex(row.name),
		});
	}
	return {
		options,
		triggerCount: selected === 'all' ? rows.length : counts.get(selected),
	};
}

export function OTeluxWorkbench(props: OTeluxWorkbenchProps): JSX.Element {
	const {
		dataSource,
		theme = 'auto',
		endpointUrl,
		topbarEnd,
		onOpenSettings,
		onOpenAbout,
		onLoadSampleData,
		onClearData,
	} = props;
	const [themeMode, setThemeMode] = useState<ThemeMode>(theme);
	const systemTheme = useSystemTheme();
	const resolvedTheme = themeMode === 'auto' ? systemTheme : themeMode;
	const [activeView, setActiveView] = useState<'traces' | 'logs' | 'metrics'>('traces');
	// Live-tail state, shared across all three signal views. When paused, the
	// views freeze on their current results; ingest continues underneath.
	const [isPaused, setIsPaused] = useState(false);
	// Destructive "clear all data" confirmation.
	const [confirmClearOpen, setConfirmClearOpen] = useState(false);
	const [selectedTraceId, setSelectedTraceIdRaw] = useState<TraceId | undefined>(undefined);
	const [selectedSpanId, setSelectedSpanId] = useState<SpanId | undefined>(undefined);
	const [errorsOnly, setErrorsOnly] = useState(false);
	const [selectedSource, setSelectedSource] = useState<string>('all');
	const [selectedService, setSelectedService] = useState<string>('all');
	const [searchQuery, setSearchQuery] = useState<string>('');
	const [traceSort, setTraceSort] = useState<TraceSortKey>('recent');
	// Logs-view filters. Kept separate from the trace filters so switching
	// views doesn't carry one surface's filter state onto the other.
	const [logsSeverity, setLogsSeverity] = useState<string>('all');
	const [logsSource, setLogsSource] = useState<string>('all');
	const [logsService, setLogsService] = useState<string>('all');
	const [logsSearch, setLogsSearch] = useState<string>('');
	const [logsSort, setLogsSort] = useState<LogSortKey>('newest');
	// Metrics-view filters. Kept separate for the same reason as the logs
	// filters — switching views must not bleed one surface's filter onto
	// another.
	const [metricsSource, setMetricsSource] = useState<string>('all');
	const [metricsService, setMetricsService] = useState<string>('all');
	const [metricsSearch, setMetricsSearch] = useState<string>('');
	// Pane collapse state. Mutually exclusive (collapsing one side
	// auto-uncollapses the other) so the workbench never ends up with
	// nothing visible. The Workbench layout's invariant requires at most
	// one of `leftCollapsed` / `rightCollapsed` to be true at any time.
	const [listCollapsed, setListCollapsed] = useState(false);
	const [wfCollapsed, setWfCollapsed] = useState(false);
	const [viewValue, setViewValue] = useState<ViewValueTarget | null>(null);

	// Switching traces clears the span selection so the drawer never
	// renders a span that no longer belongs to the active trace.
	const setSelectedTraceId = useCallback((id: TraceId): void => {
		setSelectedTraceIdRaw(id);
		setSelectedSpanId(undefined);
	}, []);

	const openTraceFromLog = (traceId: TraceId, spanId?: SpanId): void => {
		setActiveView('traces');
		setSelectedTraceIdRaw(traceId);
		setSelectedSpanId(spanId);
		setListCollapsed(false);
		setWfCollapsed(false);
	};

	const traceQuery = useSelectedTrace(
		dataSource,
		selectedTraceId,
		activeView === 'traces' && selectedTraceId !== undefined,
	);
	const trace = traceQuery.trace;

	// Cold-start only needs one summary row. Service dropdown counts use a
	// dedicated grouped query instead of transferring hundreds of traces.
	const summaryProbe = useDataSourceQuery(
		dataSource,
		(ds) => ds.listTraces({ limit: 1, sortBy: 'startTime', sortDirection: 'desc' }),
		'workbench:summary-probe',
		false,
		'tracesChanged',
		activeView === 'traces',
		undefined,
		100,
	);
	const hasAnyTrace = (summaryProbe.value?.totalCount ?? 0) > 0;
	const traceSourceFacets = useDataSourceQuery(
		dataSource,
		(ds) => ds.listResourceFacets({ signal: 'traces', facet: 'source' }),
		'workbench:trace-source-facets',
		false,
		'tracesChanged',
		activeView === 'traces',
		undefined,
		100,
	);
	const traceServiceFacets = useDataSourceQuery(
		dataSource,
		(ds) => ds.listResourceFacets({ signal: 'traces', facet: 'service', sources: [selectedSource] }),
		`workbench:trace-service-facets:${selectedSource}`,
		false,
		'tracesChanged',
		activeView === 'traces' && selectedSource !== 'all',
		undefined,
		100,
	);
	const traceSources = buildFacetControl(
		traceSourceFacets.value?.rows ?? [],
		selectedSource,
		'sources',
	);
	const traceServices = buildFacetControl(
		traceServiceFacets.value?.rows ?? [],
		selectedService,
		'services',
	);

	const logsSourceFacets = useDataSourceQuery(
		dataSource,
		(ds) => ds.listResourceFacets({ signal: 'logs', facet: 'source' }),
		'workbench:logs-source-facets',
		false,
		'logsChanged',
		activeView === 'logs',
		undefined,
		500,
	);
	const logsServiceFacets = useDataSourceQuery(
		dataSource,
		(ds) => ds.listResourceFacets({ signal: 'logs', facet: 'service', sources: [logsSource] }),
		`workbench:logs-service-facets:${logsSource}`,
		false,
		'logsChanged',
		activeView === 'logs' && logsSource !== 'all',
		undefined,
		500,
	);
	const logSources = buildFacetControl(logsSourceFacets.value?.rows ?? [], logsSource, 'sources');
	const logServices = buildFacetControl(
		logsServiceFacets.value?.rows ?? [],
		logsService,
		'services',
	);

	const metricsSourceFacets = useDataSourceQuery(
		dataSource,
		(ds) => ds.listResourceFacets({ signal: 'metrics', facet: 'source' }),
		'workbench:metrics-source-facets',
		false,
		'metricsChanged',
		activeView === 'metrics',
		undefined,
		2_000,
	);
	const metricsServiceFacets = useDataSourceQuery(
		dataSource,
		(ds) => ds.listResourceFacets({ signal: 'metrics', facet: 'service', sources: [metricsSource] }),
		`workbench:metrics-service-facets:${metricsSource}`,
		false,
		'metricsChanged',
		activeView === 'metrics' && metricsSource !== 'all',
		undefined,
		2_000,
	);
	const metricSources = buildFacetControl(
		metricsSourceFacets.value?.rows ?? [],
		metricsSource,
		'sources',
	);
	const metricServices = buildFacetControl(
		metricsServiceFacets.value?.rows ?? [],
		metricsService,
		'services',
	);

	// The detail drawer is opened explicitly by the user clicking a span
	// row in the Waterfall — not auto-opened when a trace is selected.
	// Auto-opening covered the waterfall the moment a trace was clicked
	// and made the drawer feel unclosable: every trace click re-opened
	// it. Now selecting a trace shows just the waterfall; the drawer
	// only appears when the user picks a span to inspect.
	const selectedSpan: Span | undefined = trace?.spans.find((s) => s.spanId === selectedSpanId);

	const traceListProps = {
		dataSource,
		onSelect: setSelectedTraceId,
		errorsOnly,
		paused: isPaused,
		sortBy: TRACE_SORT_PRESETS[traceSort].sortBy,
		sortDirection: TRACE_SORT_PRESETS[traceSort].sortDirection,
		...(selectedSource !== 'all' ? { sources: [selectedSource] } : {}),
		...(selectedService !== 'all' ? { services: [selectedService] } : {}),
		...(searchQuery ? { search: searchQuery } : {}),
		...(selectedTraceId !== undefined ? { selectedTraceId } : {}),
		...(endpointUrl !== undefined ? { endpointUrl } : {}),
		...(onLoadSampleData ? { onLoadSampleData } : {}),
		// Collapse the left pane on click. Also clear any wf-collapse so the
		// invariant (at most one collapsed pane) holds.
		onCollapse: () => {
			setWfCollapsed(false);
			setListCollapsed(true);
		},
		// When waterfall is currently hidden, expose a restore button so
		// the user can bring it back without re-selecting a trace.
		...(wfCollapsed && trace ? { onRestoreWaterfall: () => setWfCollapsed(false) } : {}),
	};

	// One live/paused control, shared across every view's FilterBar so the
	// state is global (pausing on Logs keeps Traces frozen too).
	const livePauseControl = (
		<LivePauseToggle paused={isPaused} onToggle={() => setIsPaused((p) => !p)} />
	);

	// FilterBar right-side actions: live/paused plus (when the host supports it)
	// a destructive clear-data control gated behind a confirmation dialog.
	const filterBarActions = (
		<>
			{livePauseControl}
			{onClearData ? (
				<button
					type="button"
					className="otelux-clear-btn"
					onClick={() => setConfirmClearOpen(true)}
					title="Clear all stored telemetry"
				>
					<TrashIcon size={13} />
					<span>Clear</span>
				</button>
			) : null}
		</>
	);

	// Confirming a clear resumes live tail (so the now-empty result is visible
	// rather than frozen) and drops any open selection whose trace just vanished.
	const handleConfirmClear = (): void => {
		setConfirmClearOpen(false);
		setIsPaused(false);
		setSelectedTraceIdRaw(undefined);
		setSelectedSpanId(undefined);
		onClearData?.();
	};

	const cycleThemeMode = (): void => {
		const currentIndex = THEME_MODE_ORDER.indexOf(themeMode);
		setThemeMode(THEME_MODE_ORDER[(currentIndex + 1) % THEME_MODE_ORDER.length] ?? 'auto');
	};

	const activateSignalView = (view: 'traces' | 'logs' | 'metrics'): void => {
		setActiveView(view);
		if (view !== 'traces') {
			setSelectedSpanId(undefined);
			setViewValue(null);
		}
	};

	const themeLabel =
		themeMode === 'auto'
			? `Theme: Auto (${formatThemeName(systemTheme)})`
			: `Theme: ${formatThemeName(themeMode)}`;
	const themeIcon =
		themeMode === 'auto' ? (
			<MonitorIcon size={18} />
		) : themeMode === 'light' ? (
			<SunIcon size={18} />
		) : (
			<MoonIcon size={18} />
		);

	return (
		<div
			className="otelux-workbench-root"
			data-theme={resolvedTheme}
			data-theme-mode={themeMode}
			data-source={dataSource.kind}
		>
			<AppShell
				rail={
					<Rail
						items={RAIL_ITEMS}
						activeId={activeView}
						onActivate={(id) => {
							if (id === 'theme') {
								cycleThemeMode();
								return;
							}
							if (id === 'settings' && onOpenSettings) {
								onOpenSettings();
								return;
							}
							if (id === 'about' && onOpenAbout) {
								onOpenAbout();
								return;
							}
							if (id === 'traces' || id === 'logs' || id === 'metrics') {
								activateSignalView(id);
							}
						}}
						footerItems={[
							{
								id: 'theme',
								label: themeLabel,
								icon: themeIcon,
							},
							{
								id: 'about',
								label: 'About OTelux',
								icon: <InfoIcon size={18} />,
								disabled: onOpenAbout === undefined,
							},
							{
								id: 'github',
								label: 'GitHub',
								icon: <GithubIcon size={18} />,
								href: 'https://github.com/b1tank/otelux',
							},
							{
								id: 'settings',
								label: 'Settings',
								icon: <SettingsIcon size={18} />,
								disabled: onOpenSettings === undefined,
							},
						]}
						brand={<OTeluxLogo size={28} />}
						brandLabel="OTelux"
					/>
				}
			>
				<Topbar
					start={
						<h1 className="otelux-topbar__title">
							{activeView === 'logs' ? 'Logs' : activeView === 'metrics' ? 'Metrics' : 'Traces'}
						</h1>
					}
					{...(topbarEnd !== undefined ? { end: topbarEnd } : {})}
				/>
				{activeView === 'logs' ? (
					<>
						<FilterBar
							filters={
								<>
									<Dropdown
										aria-label="Filter by severity"
										triggerSlotLabel="Level"
										triggerLabel={LOG_SEVERITY_LABELS[logsSeverity] ?? 'All levels'}
										value={logsSeverity}
										onChange={setLogsSeverity}
										options={LOG_SEVERITY_OPTIONS}
									/>
									<Dropdown
										aria-label="Filter logs by source"
										triggerSlotLabel="Source"
										triggerLabel={logsSource === 'all' ? 'All sources' : logsSource}
										{...(logSources.triggerCount !== undefined
											? { triggerCount: logSources.triggerCount }
											: {})}
										value={logsSource}
										onChange={(source) => {
											setLogsSource(source);
											setLogsService('all');
										}}
										options={logSources.options}
									/>
									{logsSource !== 'all' ? (
										<Dropdown
											aria-label="Filter logs by service"
											triggerSlotLabel="Service"
											triggerLabel={logsService === 'all' ? 'All services' : logsService}
											{...(logServices.triggerCount !== undefined
												? { triggerCount: logServices.triggerCount }
												: {})}
											value={logsService}
											onChange={setLogsService}
											options={logServices.options}
										/>
									) : null}
									<Dropdown
										aria-label="Sort logs"
										triggerSlotLabel="Sort"
										triggerLabel={LOG_SORT_PRESETS[logsSort].label}
										value={logsSort}
										onChange={(v) => setLogsSort(v as LogSortKey)}
										options={LOG_SORT_OPTIONS}
									/>
									<SearchField
										value={logsSearch}
										onChange={setLogsSearch}
										placeholder="Search logs by message, attribute, or value…"
										aria-label="Search logs"
									/>
								</>
							}
							end={filterBarActions}
						/>
						<LogsView
							dataSource={dataSource}
							onOpenTrace={openTraceFromLog}
							paused={isPaused}
							sortBy={LOG_SORT_PRESETS[logsSort].sortBy}
							sortDirection={LOG_SORT_PRESETS[logsSort].sortDirection}
							{...(logsSeverity !== 'all' ? { minSeverity: Number(logsSeverity) } : {})}
							{...(logsSource !== 'all' ? { sources: [logsSource] } : {})}
							{...(logsService !== 'all' ? { services: [logsService] } : {})}
							{...(logsSearch ? { search: logsSearch } : {})}
							{...(endpointUrl !== undefined
								? { endpointUrl: endpointUrl.replace('/v1/traces', '/v1/logs') }
								: {})}
						/>
					</>
				) : activeView === 'metrics' ? (
					<>
						<FilterBar
							filters={
								<>
									<Dropdown
										aria-label="Filter metrics by source"
										triggerSlotLabel="Source"
										triggerLabel={metricsSource === 'all' ? 'All sources' : metricsSource}
										{...(metricSources.triggerCount !== undefined
											? { triggerCount: metricSources.triggerCount }
											: {})}
										value={metricsSource}
										onChange={(source) => {
											setMetricsSource(source);
											setMetricsService('all');
										}}
										options={metricSources.options}
									/>
									{metricsSource !== 'all' ? (
										<Dropdown
											aria-label="Filter metrics by service"
											triggerSlotLabel="Service"
											triggerLabel={metricsService === 'all' ? 'All services' : metricsService}
											{...(metricServices.triggerCount !== undefined
												? { triggerCount: metricServices.triggerCount }
												: {})}
											value={metricsService}
											onChange={setMetricsService}
											options={metricServices.options}
										/>
									) : null}
									<SearchField
										value={metricsSearch}
										onChange={setMetricsSearch}
										placeholder="Search instruments by name or description…"
										aria-label="Search metrics"
									/>
								</>
							}
							end={filterBarActions}
						/>
						<MetricsView
							dataSource={dataSource}
							paused={isPaused}
							{...(metricsSource !== 'all' ? { sources: [metricsSource] } : {})}
							{...(metricsService !== 'all' ? { services: [metricsService] } : {})}
							{...(metricsSearch ? { search: metricsSearch } : {})}
							{...(endpointUrl !== undefined
								? { endpointUrl: endpointUrl.replace('/v1/traces', '/v1/metrics') }
								: {})}
						/>
					</>
				) : (
					<>
						{hasAnyTrace ? (
							<FilterBar
								filters={
									<>
										<Dropdown
											aria-label="Filter by source"
											triggerSlotLabel="Source"
											triggerLabel={selectedSource === 'all' ? 'All sources' : selectedSource}
											{...(traceSources.triggerCount !== undefined
												? { triggerCount: traceSources.triggerCount }
												: {})}
											value={selectedSource}
											onChange={(source) => {
												setSelectedSource(source);
												setSelectedService('all');
											}}
											options={traceSources.options}
										/>
										{selectedSource !== 'all' ? (
											<Dropdown
												aria-label="Filter by service"
												triggerSlotLabel="Service"
												triggerLabel={selectedService === 'all' ? 'All services' : selectedService}
												{...(traceServices.triggerCount !== undefined
													? { triggerCount: traceServices.triggerCount }
													: {})}
												value={selectedService}
												onChange={setSelectedService}
												options={traceServices.options}
											/>
										) : null}
										<ToggleChip pressed={errorsOnly} onPressedChange={setErrorsOnly} pressedTone="error">
											Errors only
										</ToggleChip>
										<Dropdown
											aria-label="Sort traces"
											triggerSlotLabel="Sort"
											triggerLabel={TRACE_SORT_PRESETS[traceSort].label}
											value={traceSort}
											onChange={(v) => setTraceSort(v as TraceSortKey)}
											options={TRACE_SORT_OPTIONS}
										/>
										<SearchField
											value={searchQuery}
											onChange={setSearchQuery}
											placeholder="Search traces or spans by name, attribute, or trace ID…"
											aria-label="Search traces"
										/>
									</>
								}
								end={filterBarActions}
							/>
						) : null}
						<Workbench
							left={<TraceList {...traceListProps} />}
							leftCollapsed={listCollapsed}
							rightCollapsed={!hasAnyTrace || wfCollapsed}
							right={
								trace && trace.spans.length > 0 ? (
									<Waterfall
										key={trace.traceId}
										trace={trace}
										onSpanSelect={setSelectedSpanId}
										{...(selectedSpanId !== undefined ? { selectedSpanId } : {})}
										onCollapse={() => {
											setListCollapsed(false);
											setWfCollapsed(true);
										}}
										{...(listCollapsed ? { onRestoreList: () => setListCollapsed(false) } : {})}
									/>
								) : (
									<div className="otelux-empty-state">
										<div className="otelux-empty-state__icon" aria-hidden>
											<WaterfallIcon size={28} />
										</div>
										<h2 className="otelux-empty-state__title">
											{selectedTraceId ? 'Loading trace…' : 'Select a trace to inspect its spans'}
										</h2>
										<p className="otelux-empty-state__body">
											{selectedTraceId
												? 'Fetching spans for the selected trace.'
												: 'Pick a trace from the list to view its waterfall and drill into spans.'}
										</p>
									</div>
								)
							}
						/>
					</>
				)}
			</AppShell>
			<Drawer
				open={selectedSpan !== undefined}
				onClose={() => setSelectedSpanId(undefined)}
				{...(selectedSpan ? { title: selectedSpan.name || '(unnamed)' } : {})}
				{...(selectedSpan
					? {
							accentVar: serviceColorVar(
								(selectedSpan.resource.attributes['service.name'] as string | undefined) ?? '',
							),
							kindLabel: SPAN_KIND_DRAWER_LABEL[selectedSpan.kind] ?? 'Span',
						}
					: {})}
			>
				{selectedSpan ? (
					<SpanDetail span={selectedSpan} onViewValue={(key, value) => setViewValue({ key, value })} />
				) : null}
			</Drawer>
			<ValueViewer
				open={viewValue !== null}
				onClose={() => setViewValue(null)}
				{...(viewValue !== null ? { title: viewValue.key, value: viewValue.value } : { value: '' })}
			/>
			<ConfirmDialog
				open={confirmClearOpen}
				title="Clear all telemetry?"
				message="This deletes every stored trace, log, and metric. It cannot be undone."
				confirmLabel="Clear data"
				destructive
				onConfirm={handleConfirmClear}
				onCancel={() => setConfirmClearOpen(false)}
			/>
		</div>
	);
}

function useSystemTheme(): ResolvedTheme {
	const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
			return;
		}
		const query = window.matchMedia('(prefers-color-scheme: light)');
		const update = (): void => setSystemTheme(query.matches ? 'light' : 'dark');
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	}, []);

	return systemTheme;
}

function getSystemTheme(): ResolvedTheme {
	if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
		return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
	}
	return 'dark';
}

function formatThemeName(theme: ResolvedTheme): string {
	return theme === 'light' ? 'Light' : 'Dark';
}

export const OTELUX_UI_VERSION = '0.1.0' as const;
