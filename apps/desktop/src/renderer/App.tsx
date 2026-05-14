import { OTeluxWorkbench } from '@otelux/ui';
import { type JSX, useCallback, useMemo, useState } from 'react';
import type { PartialSettings, UpdateSettingsResult } from '../shared/ipc.js';
import { EndpointBar } from './components/EndpointBar.js';
import { SettingsModal } from './components/SettingsModal.js';
import { useReceiverStatus, useSettings } from './hooks.js';
import { createIpcDataSource } from './ipcDataSource.js';

export function App(): JSX.Element {
	// Build the bridge-backed DataSource once per renderer. If the bridge
	// is missing (e.g. the preload script failed to load) we surface a
	// loud error here instead of silently showing an empty workbench.
	const bridge = useMemo(() => {
		const b = window.otelux;
		if (!b) {
			throw new Error('OTelux: preload bridge missing on window.otelux');
		}
		return b;
	}, []);

	const dataSource = useMemo(() => createIpcDataSource(bridge), [bridge]);
	const status = useReceiverStatus(bridge);
	const settings = useSettings(bridge);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const onSavePort = useCallback(
		async (port: number): Promise<UpdateSettingsResult> => {
			const patch: PartialSettings = { otlp: { port } };
			return (await bridge.invoke({ kind: 'updateSettings', patch })) as UpdateSettingsResult;
		},
		[bridge],
	);

	return (
		<main className="app">
			<header className="app-header">
				<h1>OTelux</h1>
				<p className="app-subtitle">Local OpenTelemetry workbench</p>
			</header>
			<EndpointBar status={status} onOpenSettings={() => setSettingsOpen(true)} />
			<section className="app-body">
				<OTeluxWorkbench dataSource={dataSource} theme="dark" />
			</section>
			{settingsOpen && settings ? (
				<SettingsModal settings={settings} onSave={onSavePort} onClose={() => setSettingsOpen(false)} />
			) : null}
		</main>
	);
}
