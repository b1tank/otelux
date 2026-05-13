import { contextBridge } from 'electron';

/**
 * Phase 0 preload script. Establishes the contextBridge boundary; the real
 * DataSource bridge (over ipcRenderer) lands in Phase 1.
 */
contextBridge.exposeInMainWorld('otelux', {
	version: '0.0.0',
});
