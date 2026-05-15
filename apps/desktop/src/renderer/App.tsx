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

	// Show the live receiver URL in the empty-state hint so the user
	// copy-pastes the right thing (port may differ from the default
	// 4318 via settings or the `OTELUX_OTLP_PORT` env override). Fall
	// back to the persisted settings while the status is hydrating.
	const endpointUrl = useMemo<string | undefined>(() => {
		if (status?.kind === 'running') {
			return `http://${status.host}:${status.port}/v1/traces`;
		}
		if (settings) {
			return `http://127.0.0.1:${settings.otlp.port}/v1/traces`;
		}
		return undefined;
	}, [status, settings]);

	const onSavePort = useCallback(
		async (port: number): Promise<UpdateSettingsResult> => {
			const patch: PartialSettings = { otlp: { port } };
			return (await bridge.invoke({ kind: 'updateSettings', patch })) as UpdateSettingsResult;
		},
		[bridge],
	);

	return (
		<main className="app">
			<OTeluxWorkbench
				dataSource={dataSource}
				theme="dark"
				{...(endpointUrl !== undefined ? { endpointUrl } : {})}
				topbarEnd={<EndpointBar status={status} />}
				onOpenSettings={() => setSettingsOpen(true)}
			/>
			{settingsOpen && settings ? (
				<SettingsModal
					settings={settings}
					{...(status?.kind === 'running' || status?.kind === 'error'
						? { currentPort: status.port }
						: {})}
					onSave={onSavePort}
					onClose={() => setSettingsOpen(false)}
				/>
			) : null}
		</main>
	);
}
