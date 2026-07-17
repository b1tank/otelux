import { useEffect, useState } from 'react';
import type {
	McpStatus,
	ReceiverStatus,
	Settings,
	StoragePathInfo,
	StorageUsageInfo,
} from '../shared/ipc.js';
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

/**
 * Subscribe to the main process's reified MCP server status. Returns
 * `undefined` until the first `getMcpStatus` reply arrives, then tracks
 * every subsequent `mcp-status-changed` push. The disabled state is
 * returned as `{ kind: 'disabled' }` rather than undefined so the UI
 * can distinguish "user turned it off" from "still hydrating".
 */
export function useMcpStatus(bridge: OteluxWindowBridge): McpStatus | undefined {
	const [status, setStatus] = useState<McpStatus>();
	useEffect(() => {
		let cancelled = false;
		void bridge.invoke({ kind: 'getMcpStatus' }).then((result) => {
			if (!cancelled) {
				setStatus(result as McpStatus);
			}
		});
		const off = bridge.onEvent((event) => {
			if (event.kind === 'mcp-status-changed') {
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
 * Fetch the resolved storage location (active DB path + default path). The
 * active path only changes on restart, so this fetches once and does not
 * subscribe to any push event.
 */
export function useStoragePath(bridge: OteluxWindowBridge): StoragePathInfo | undefined {
	const [info, setInfo] = useState<StoragePathInfo>();
	useEffect(() => {
		let cancelled = false;
		void bridge.invoke({ kind: 'getStoragePath' }).then((result) => {
			if (!cancelled) {
				setInfo(result as StoragePathInfo);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [bridge]);
	return info;
}

/** Refresh SQLite usage while Settings is open and after telemetry changes. */
export function useStorageUsage(
	bridge: OteluxWindowBridge,
	enabled: boolean,
): StorageUsageInfo | undefined {
	const [usage, setUsage] = useState<StorageUsageInfo>();
	useEffect(() => {
		if (!enabled) {
			return;
		}
		return subscribeStorageUsage(bridge, setUsage, window);
	}, [bridge, enabled]);
	return usage;
}

interface StorageUsageTimer {
	setInterval(handler: () => void, timeout: number): number;
	clearInterval(id: number): void;
}

/** Own the event/timer refresh lifecycle independently from React. */
export function subscribeStorageUsage(
	bridge: OteluxWindowBridge,
	onUsage: (usage: StorageUsageInfo) => void,
	timer: StorageUsageTimer,
): () => void {
	let disposed = false;
	const refresh = (): void => {
		if (disposed) {
			return;
		}
		void bridge
			.invoke({ kind: 'getStorageUsage' })
			.then((result) => {
				if (!disposed) {
					onUsage(result as StorageUsageInfo);
				}
			})
			.catch(() => {
				// The runtime may be stopping or a transient stat can fail. Keep
				// the last coherent snapshot and retry on the next event/tick.
			});
	};
	refresh();
	const interval = timer.setInterval(refresh, 2_000);
	const off = bridge.onEvent(refresh);
	return () => {
		disposed = true;
		timer.clearInterval(interval);
		off();
	};
}
