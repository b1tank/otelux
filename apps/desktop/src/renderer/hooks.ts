import { useEffect, useState } from 'react';
import type { ReceiverStatus, Settings } from '../shared/ipc.js';
import type { OteluxWindowBridge } from './ipcDataSource.js';

/**
 * Subscribe to the main process's reified receiver status. Returns
 * `undefined` until the first `getReceiverStatus` reply arrives, then
 * tracks every subsequent `receiver-status-changed` push.
 */
export function useReceiverStatus(bridge: OteluxWindowBridge): ReceiverStatus | undefined {
	const [status, setStatus] = useState<ReceiverStatus>();
	useEffect(() => {
		let cancelled = false;
		void bridge.invoke({ kind: 'getReceiverStatus' }).then((result) => {
			if (!cancelled) {
				setStatus(result as ReceiverStatus);
			}
		});
		const off = bridge.onEvent((event) => {
			if (event.kind === 'receiver-status-changed') {
				setStatus(event.status);
			}
		});
		return () => {
			cancelled = true;
			off();
		};
	}, [bridge]);
	return status;
}

/**
 * Subscribe to the persisted user settings. Returns `undefined` until
 * the first `getSettings` reply arrives.
 */
export function useSettings(bridge: OteluxWindowBridge): Settings | undefined {
	const [settings, setSettings] = useState<Settings>();
	useEffect(() => {
		let cancelled = false;
		void bridge.invoke({ kind: 'getSettings' }).then((result) => {
			if (!cancelled) {
				setSettings(result as Settings);
			}
		});
		const off = bridge.onEvent((event) => {
			if (event.kind === 'settings-changed') {
				setSettings(event.settings);
			}
		});
		return () => {
			cancelled = true;
			off();
		};
	}, [bridge]);
	return settings;
}
