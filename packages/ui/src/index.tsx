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
import { type JSX, useEffect, useState } from 'react';
import { SpanDetail, TraceList, Waterfall } from './domain/index.js';
import { AppShell, FilterBar, Rail, type RailItem, Topbar, Workbench } from './layout/index.js';
import {
	ActivityIcon,
	Drawer,
	ListIcon,
	SettingsIcon,
	ToggleChip,
	ValueViewer,
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
}

const RAIL_ITEMS: readonly RailItem[] = [
	{ id: 'traces', label: 'Traces', icon: <ListIcon size={18} /> },
];
const RAIL_FOOTER: readonly RailItem[] = [
	{ id: 'activity', label: 'Activity', icon: <ActivityIcon size={18} />, disabled: true },
	{ id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} />, disabled: true },
];

interface ViewValueTarget {
	key: string;
	value: AttributeValue;
}

export function OTeluxWorkbench(props: OTeluxWorkbenchProps): JSX.Element {
	const { dataSource, theme = 'dark', endpointUrl, topbarEnd } = props;
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

	// Auto-select the root span when a new trace lands so the detail
	// drawer is never blank when a user lands on a trace.
	useEffect(() => {
		if (trace && !selectedSpanId && trace.rootSpan) {
			setSelectedSpanId(trace.rootSpan.spanId);
		}
	}, [trace, selectedSpanId]);

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
					<Rail items={RAIL_ITEMS} activeId="traces" onActivate={() => {}} footerItems={RAIL_FOOTER} />
				}
			>
				<Topbar
					start={<span className="otelux-workbench-root__brand">OTelux</span>}
					{...(topbarEnd !== undefined ? { end: topbarEnd } : {})}
				/>
				<FilterBar
					filters={
						<ToggleChip pressed={errorsOnly} onPressedChange={setErrorsOnly} pressedTone="error">
							Errors only
						</ToggleChip>
					}
				/>
				<Workbench
					left={<TraceList {...traceListProps} />}
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
