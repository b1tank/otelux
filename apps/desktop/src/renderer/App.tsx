import { OTeluxWorkbench } from '@otelux/ui';
import { type JSX, useCallback, useMemo, useState } from 'react';
import type { PartialSettings, UpdateSettingsResult } from '../shared/ipc.js';
import { EndpointBar } from './components/EndpointBar.js';
import { SettingsModal } from './components/SettingsModal.js';
import { useMcpStatus, useReceiverStatus, useSettings, useStoragePath } from './hooks.js';
import { createIpcDataSource } from './ipcDataSource.js';

export function App(): JSX.Element {
	const bridge = useMemo(() => {
		const b = window.otelux;
		if (!b) {
			throw new Error('OTelux: preload bridge missing on window.otelux');
		}
		return b;
	}, []);

	const dataSource = useMemo(() => createIpcDataSource(bridge), [bridge]);
	const status = useReceiverStatus(bridge);
	const mcpStatus = useMcpStatus(bridge);
	const settings = useSettings(bridge);
	const storagePath = useStoragePath(bridge);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const endpointUrl = useMemo<string | undefined>(() => {
		if (status?.kind === 'running') {
			return `http://${status.host}:${status.port}/v1/traces`;
		}
		if (settings) {
			return `http://127.0.0.1:${settings.otlp.port}/v1/traces`;
		}
		return undefined;
	}, [status, settings]);

	const onSaveSettings = useCallback(
		async (patch: PartialSettings): Promise<UpdateSettingsResult> => {
			return (await bridge.invoke({ kind: 'updateSettings', patch })) as UpdateSettingsResult;
		},
		[bridge],
	);

	const onLoadSampleData = useCallback((): void => {
		void bridge.invoke({ kind: 'loadSampleData' });
	}, [bridge]);

	const onClearData = useCallback((): void => {
		void bridge.invoke({ kind: 'clearData' });
	}, [bridge]);

	return (
		<main className="app">
			<OTeluxWorkbench
				dataSource={dataSource}
				{...(endpointUrl !== undefined ? { endpointUrl } : {})}
				topbarEnd={<EndpointBar status={status} mcpStatus={mcpStatus} />}
				onOpenSettings={() => setSettingsOpen(true)}
				onLoadSampleData={onLoadSampleData}
				onClearData={onClearData}
			/>
			{settingsOpen && settings ? (
				<SettingsModal
					settings={settings}
					{...(status?.kind === 'running' || status?.kind === 'error'
						? { currentPort: status.port }
						: {})}
					{...(mcpStatus !== undefined ? { mcpStatus } : {})}
					{...(storagePath !== undefined ? { storagePath } : {})}
					onSave={onSaveSettings}
					onClose={() => setSettingsOpen(false)}
				/>
			) : null}
		</main>
	);
}
