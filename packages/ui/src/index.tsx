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
import { type JSX, useState } from 'react';
import { SpanDetail, TraceList, Waterfall } from './domain/index.js';
import { AppShell, FilterBar, Rail, type RailItem, Topbar, Workbench } from './layout/index.js';
import {
	BarChart3Icon,
	Drawer,
	GithubIcon,
	LogsIcon,
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

interface ViewValueTarget {
	key: string;
	value: AttributeValue;
}

export function OTeluxWorkbench(props: OTeluxWorkbenchProps): JSX.Element {
	const { dataSource, theme = 'dark', endpointUrl, topbarEnd, onOpenSettings } = props;
	const [selectedTraceId, setSelectedTraceIdRaw] = useState<TraceId | undefined>(undefined);
	const [selectedSpanId, setSelectedSpanId] = useState<SpanId | undefined>(undefined);
	const [errorsOnly, setErrorsOnly] = useState(false);
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

	// Probe the data source for ANY trace, unfiltered, so we can tell
	// whether the workbench has ever seen data. This drives the
	// "cold start" UI: when no traces have arrived yet we collapse the
	// right pane and hide the FilterBar so the user sees a single
	// focused TraceList empty state rather than a half-populated app
	// with toggles that filter nothing.
	//
	// This is deliberately a separate query from the filter-aware list
	// inside TraceList — when the user toggles `errorsOnly` and the
	// filtered list goes empty, the FilterBar must stay visible so
	// they can undo the toggle. That requires a probe that ignores the
	// active filters.
	const emptyProbe = useDataSourceQuery(
		dataSource,
		(ds) => ds.listTraces({ limit: 1, sortBy: 'startTime', sortDirection: 'desc' }),
		'workbench:empty-probe',
	);
	const hasAnyTrace = (emptyProbe.value?.rows.length ?? 0) > 0;

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
		...(selectedTraceId !== undefined ? { selectedTraceId } : {}),
		...(endpointUrl !== undefined ? { endpointUrl } : {}),
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
						brand="⏚"
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
							<ToggleChip pressed={errorsOnly} onPressedChange={setErrorsOnly} pressedTone="error">
								Errors only
							</ToggleChip>
						}
					/>
				) : null}
				<Workbench
					left={<TraceList {...traceListProps} />}
					rightCollapsed={!hasAnyTrace}
					right={
						trace && trace.spans.length > 0 ? (
							<Waterfall
								trace={trace}
								onSpanSelect={setSelectedSpanId}
								{...(selectedSpanId !== undefined ? { selectedSpanId } : {})}
							/>
						) : (
							<div className="otelux-workbench-root__placeholder">
								{selectedTraceId ? 'Loading trace…' : 'Select a trace from the list to view its waterfall.'}
							</div>
						)
					}
				/>
			</AppShell>
			<Drawer
				open={selectedSpan !== undefined}
				onClose={() => setSelectedSpanId(undefined)}
				{...(selectedSpan ? { title: selectedSpan.name || '(unnamed)' } : {})}
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
