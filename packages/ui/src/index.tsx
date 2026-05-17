/**
 * `@otelux/ui` — composed React workbench.
 *
 * `OTeluxWorkbench` is the single entry point hosts (Electron renderer,
 * vscode webview, vscode-dev workbench) mount. It owns the redesigned
 * layout (rail + topbar + filterbar + resizable workbench + drawer)
 * and consumes any `DataSource`.
 *
 * Layered import discipline: this file is the only composition surface
 * permitted to depend on both `layout/` and `domain/`. Individual
 * domain components MUST NOT import each other.
 */

import type { DataSource } from '@otelux/protocol';
import type { AttributeValue, Span, SpanId, Trace, TraceId } from '@otelux/types';
import { SpanKind } from '@otelux/types';
import { type JSX, useMemo, useState } from 'react';
import { SpanDetail, TraceList, Waterfall } from './domain/index.js';
import { serviceColorVar, serviceIndex } from './format.js';
import { AppShell, FilterBar, Rail, type RailItem, Topbar, Workbench } from './layout/index.js';
import {
	BarChart3Icon,
	Drawer,
	Dropdown,
	type DropdownOption,
	GithubIcon,
	LogsIcon,
	OTeluxLogo,
	SearchField,
	SettingsIcon,
	ToggleChip,
	ValueViewer,
	WaterfallIcon,
} from './primitives/index.js';
import { useDataSourceQuery } from './useDataSourceQuery.js';

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
	theme?: 'dark' | 'light';
	/**
	 * OTLP/HTTP traces endpoint shown in the empty-state hint. Hosts
	 * that know the live bind (desktop app with a configurable port,
	 * vscode webview proxied through the extension) should pass the
	 * real URL so users copy-paste the right thing.
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
}

// The rail's "Metrics" and "Logs" pillars are intentional placeholders
// for future telemetry surfaces — they exist in the rail so the icon
// bar stays anchored at three pillars (Traces / Metrics / Logs) even
// before those views ship. They are disabled until the surfaces land.
const RAIL_ITEMS: readonly RailItem[] = [
	{ id: 'traces', label: 'Traces', icon: <WaterfallIcon size={18} /> },
	{
		id: 'metrics',
		label: 'Metrics (coming soon)',
		icon: <BarChart3Icon size={18} />,
		disabled: true,
	},
	{ id: 'logs', label: 'Logs (coming soon)', icon: <LogsIcon size={18} />, disabled: true },
];

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

export function OTeluxWorkbench(props: OTeluxWorkbenchProps): JSX.Element {
	const { dataSource, theme = 'dark', endpointUrl, topbarEnd, onOpenSettings } = props;
	const [selectedTraceId, setSelectedTraceIdRaw] = useState<TraceId | undefined>(undefined);
	const [selectedSpanId, setSelectedSpanId] = useState<SpanId | undefined>(undefined);
	const [errorsOnly, setErrorsOnly] = useState(false);
	const [selectedService, setSelectedService] = useState<string>('all');
	const [searchQuery, setSearchQuery] = useState<string>('');
	// Pane collapse state. Mutually exclusive (collapsing one side
	// auto-uncollapses the other) so the workbench never ends up with
	// nothing visible. The Workbench layout's invariant requires at most
	// one of `leftCollapsed` / `rightCollapsed` to be true at any time.
	const [listCollapsed, setListCollapsed] = useState(false);
	const [wfCollapsed, setWfCollapsed] = useState(false);
	const [viewValue, setViewValue] = useState<ViewValueTarget | null>(null);

	// Switching traces clears the span selection so the drawer never
	// renders a span that no longer belongs to the active trace.
	const setSelectedTraceId = (id: TraceId): void => {
		setSelectedTraceIdRaw(id);
		setSelectedSpanId(undefined);
	};

	const traceQuery = useDataSourceQuery<Trace | undefined>(
		dataSource,
		async (ds) => {
			if (!selectedTraceId) {
				return undefined;
			}
			return ds.getTrace({ traceId: selectedTraceId });
		},
		`trace:${selectedTraceId ?? ''}`,
	);

	const trace = traceQuery.value;

	// Unfiltered probe used for two purposes:
	//   1. detect cold-start (hasAnyTrace) so we can hide the FilterBar
	//      and collapse the right pane before any data arrives.
	//   2. populate the Service dropdown with available services and
	//      per-service counts. Counts are derived from the row sample;
	//      good enough for milestone 1 — a future iteration can move
	//      this to a dedicated `listServices()` data source method.
	//
	// limit=500 caps the work; trace counts above that round down in
	// the dropdown but never affect the filtered TraceList itself
	// (which has its own query).
	const summaryProbe = useDataSourceQuery(
		dataSource,
		(ds) => ds.listTraces({ limit: 500, sortBy: 'startTime', sortDirection: 'desc' }),
		'workbench:summary-probe',
	);
	const summaryRows = summaryProbe.value?.rows ?? [];
	const hasAnyTrace = summaryRows.length > 0;

	const { serviceCounts, sortedServices } = useMemo(() => {
		const counts = new Map<string, number>();
		for (const row of summaryRows) {
			for (const s of row.services) {
				counts.set(s, (counts.get(s) ?? 0) + 1);
			}
		}
		// Order by count descending, then alphabetically so the dropdown
		// reads stably even when two services tie.
		const sorted = Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([name]) => name);
		return { serviceCounts: counts, sortedServices: sorted };
	}, [summaryRows]);

	const serviceOptions = useMemo<readonly DropdownOption[]>(() => {
		const opts: DropdownOption[] = [];
		// When a specific service is filtered we surface an "All services"
		// entry at the top so the user can clear back to the unfiltered
		// view. The count here is the number of distinct services in scope
		// (matching the trigger badge), so users can immediately tell how
		// many services the unfiltered list spans. The absence of a colored
		// dot is itself the visual cue that this row is the "all" peer;
		// when the filter is already 'all', the row is redundant with the
		// trigger label and omitted.
		if (selectedService !== 'all') {
			opts.push({
				value: 'all',
				label: 'All services',
				count: sortedServices.length,
			});
		}
		for (const name of sortedServices) {
			opts.push({
				value: name,
				label: name,
				count: serviceCounts.get(name) ?? 0,
				colorIndex: serviceIndex(name),
			});
		}
		return opts;
	}, [sortedServices, serviceCounts, selectedService]);

	// Trigger badge: when no service is filtered, show how many distinct
	// services contribute to the visible trace set (matches the count
	// the user would see if they opened the dropdown and counted rows).
	// When a specific service is filtered, show how many traces touch
	// that service — useful for confirming the filter took effect.
	const serviceTriggerCount =
		selectedService === 'all' ? sortedServices.length : serviceCounts.get(selectedService);

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
		...(selectedService !== 'all' ? { services: [selectedService] } : {}),
		...(searchQuery ? { search: searchQuery } : {}),
		...(selectedTraceId !== undefined ? { selectedTraceId } : {}),
		...(endpointUrl !== undefined ? { endpointUrl } : {}),
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

	return (
		<div className="otelux-workbench-root" data-theme={theme} data-source={dataSource.kind}>
			<AppShell
				rail={
					<Rail
						items={RAIL_ITEMS}
						activeId="traces"
						onActivate={(id) => {
							if (id === 'settings' && onOpenSettings) {
								onOpenSettings();
							}
						}}
						footerItems={[
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
					start={<h1 className="otelux-topbar__title">Traces</h1>}
					{...(topbarEnd !== undefined ? { end: topbarEnd } : {})}
				/>
				{hasAnyTrace ? (
					<FilterBar
						filters={
							<>
								<Dropdown
									aria-label="Filter by service"
									triggerSlotLabel="Service"
									triggerLabel={selectedService === 'all' ? 'All services' : selectedService}
									triggerIcon={
										selectedService === 'all' ? undefined : (
											<span
												className="otelux-dropdown__color-dot"
												style={{
													background: `var(--otelux-svc-${serviceIndex(selectedService)})`,
												}}
												aria-hidden
											/>
										)
									}
									{...(serviceTriggerCount !== undefined ? { triggerCount: serviceTriggerCount } : {})}
									value={selectedService}
									onChange={setSelectedService}
									options={serviceOptions}
								/>
								<ToggleChip pressed={errorsOnly} onPressedChange={setErrorsOnly} pressedTone="error">
									Errors only
								</ToggleChip>
								<SearchField
									value={searchQuery}
									onChange={setSearchQuery}
									placeholder="Search traces or spans by name, attribute, or trace ID…"
									aria-label="Search traces"
								/>
							</>
						}
					/>
				) : null}
				<Workbench
					left={<TraceList {...traceListProps} />}
					leftCollapsed={listCollapsed}
					rightCollapsed={!hasAnyTrace || wfCollapsed}
					right={
						trace && trace.spans.length > 0 ? (
							<Waterfall
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
		</div>
	);
}

export const OTELUX_UI_VERSION = '0.1.0' as const;
