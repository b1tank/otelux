import { OTeluxWorkbench } from '@otelux/ui';
import { type JSX, useMemo } from 'react';
import { createIpcDataSource } from './ipcDataSource.js';

export function App(): JSX.Element {
	// Build the bridge-backed DataSource once per renderer. If the bridge
	// is missing (e.g. the preload script failed to load) we surface a
	// loud error here instead of silently showing an empty workbench.
	const dataSource = useMemo(() => {
		const bridge = window.otelux;
		if (!bridge) {
			throw new Error('OTelux: preload bridge missing on window.otelux');
		}
		return createIpcDataSource(bridge);
	}, []);

	return (
		<main className="app">
			<header className="app-header">
				<h1>OTelux</h1>
				<p className="app-subtitle">Local OpenTelemetry workbench</p>
			</header>
			<section className="app-body">
				<OTeluxWorkbench dataSource={dataSource} theme="dark" />
			</section>
		</main>
	);
}
