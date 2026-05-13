import { contextBridge, ipcRenderer } from 'electron';
import {
	type InvokeMessage,
	OTELUX_EVENT_CHANNEL,
	OTELUX_INVOKE_CHANNEL,
	type OteluxEvent,
} from '../shared/ipc.js';

/**
 * Narrow contextBridge surface. The renderer never touches `ipcRenderer`
 * directly — only this typed adapter, so sandbox+contextIsolation stay
 * meaningful. The shape mirrors the IPC contract in `shared/ipc.ts`.
 */
const bridge = {
	version: '0.0.0',
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
