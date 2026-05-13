import type { JSX } from 'react';
import { OTeluxWorkbench } from '@otelux/ui';

// Phase 0 stub. The real DataSource (bridged from the main-process engine
// over IPC) plugs in here in Phase 1.
const stubDataSource = { kind: 'otelux/datasource' as const };

export function App(): JSX.Element {
	return (
		<main className="app">
			<header className="app-header">
				<h1>OTelux</h1>
				<p className="app-subtitle">Local OpenTelemetry workbench — Phase 0</p>
			</header>
			<section className="app-body">
				<OTeluxWorkbench dataSource={stubDataSource} theme="dark" />
			</section>
		</main>
	);
}
