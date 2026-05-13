/**
 * The DataSource interface is the load-bearing contract between
 * @otelux/ui and any backend (in-process engine, postMessage bridge,
 * Tauri IPC, etc.).
 *
 * Phase 0 ships only the type-level skeleton. Real query/result shapes
 * land alongside engine work in Phase 1.
 */

export interface Disposable {
	dispose(): void;
}

export interface DataSource {
	/** Sentinel used so adapters can verify they implement the right contract. */
	readonly kind: 'otelux/datasource';
}

export const OTELUX_PROTOCOL_VERSION = '0.0.0' as const;
