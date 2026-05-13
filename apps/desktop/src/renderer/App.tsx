import type { DataSource } from '@otelux/protocol';
import { OTeluxWorkbench } from '@otelux/ui';
import type { JSX } from 'react';

// Placeholder DataSource. The real one — bridged from the main-process
// engine over IPC — replaces this when the IPC bridge lands.
const stubDataSource: DataSource = {
	kind: 'otelux/datasource',
	listTraces: async () => ({ rows: [], totalCount: 0 }),
	getTrace: async () => ({
		traceId: '',
		spans: [],
		startTimeUnixNano: 0n,
		endTimeUnixNano: 0n,
		durationNanos: 0n,
		services: [],
		spanCount: 0,
		errorCount: 0,
	}),
	getSpanDetails: async () => {
		throw new Error('no spans yet');
	},
	subscribe: () => ({ dispose: () => {} }),
};

export function App(): JSX.Element {
	return (
		<main className="app">
			<header className="app-header">
				<h1>OTelux</h1>
				<p className="app-subtitle">Local OpenTelemetry workbench</p>
			</header>
			<section className="app-body">
				<OTeluxWorkbench dataSource={stubDataSource} theme="dark" />
			</section>
		</main>
	);
}
