import { contextBridge, ipcRenderer } from 'electron';
import {
	type InvokeMessage,
	OTELUX_EVENT_CHANNEL,
	OTELUX_INVOKE_CHANNEL,
	type OteluxEvent,
} from '../shared/ipc.js';

// Replaced at build time by electron-vite `define` with this package's
// version (see electron.vite.config.ts). Declared here so `tsc` — which
// does not apply the bundler define — still type-checks the preload.
declare const __OTELUX_APP_VERSION__: string;

/**
 * Narrow contextBridge surface. The renderer never touches `ipcRenderer`
 * directly — only this typed adapter, so sandbox+contextIsolation stay
 * meaningful. The shape mirrors the IPC contract in `shared/ipc.ts`.
 */
const bridge = {
	version: __OTELUX_APP_VERSION__,
	runtime: {
		electron: process.versions.electron ?? '-',
		chromium: process.versions.chrome ?? '-',
		node: process.versions.node,
		platform: `${process.platform} ${process.arch}`,
	},
	invoke: (message: InvokeMessage): Promise<unknown> => {
		return ipcRenderer.invoke(OTELUX_INVOKE_CHANNEL, message);
	},
	/**
	 * Subscribe to engine change events. Returns an unsubscribe function;
	 * callers MUST call it when the listener is no longer needed or the
	 * renderer will leak a Node `EventEmitter` listener.
	 */
	onEvent: (listener: (event: OteluxEvent) => void): (() => void) => {
		const handler = (_event: Electron.IpcRendererEvent, payload: OteluxEvent): void => {
			listener(payload);
		};
		ipcRenderer.on(OTELUX_EVENT_CHANNEL, handler);
		return () => {
			ipcRenderer.removeListener(OTELUX_EVENT_CHANNEL, handler);
		};
	},
};

export type OteluxBridge = typeof bridge;

contextBridge.exposeInMainWorld('otelux', bridge);
