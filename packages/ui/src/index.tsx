/**
 * React components for the OTelux viewer.
 *
 * Phase 0 ships a single trivial component so the package compiles, the
 * peer-dep boundary is enforced, and CI has something to render. Real
 * components (Waterfall, TraceList, SpanDetail, LogsTable, MetricChart,
 * Toolbar, Settings, theme tokens) land in Phase 1.
 */

import type { DataSource } from '@otelux/protocol';
import type { JSX } from 'react';

export interface OTeluxWorkbenchProps {
	dataSource: DataSource;
	/** Optional theme override. Defaults to `host` which reads CSS variables. */
	theme?: 'host' | 'light' | 'dark';
}

export function OTeluxWorkbench(props: OTeluxWorkbenchProps): JSX.Element {
	const { dataSource, theme = 'host' } = props;
	return (
		<div className="otelux-workbench" data-theme={theme} data-source={dataSource.kind}>
			<p>OTelux Workbench — Phase 0 placeholder</p>
		</div>
	);
}

export const OTELUX_UI_VERSION = '0.0.0' as const;
