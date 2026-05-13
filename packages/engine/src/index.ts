/**
 * Pure-TS OpenTelemetry engine. Ingest, query, layout, live subscription.
 *
 * Phase 0 ships only the engine factory and Storage adapter interface.
 * Ingest, query, layout, and subscription land in Phase 1 alongside the
 * waterfall port from the retired C++ core.
 */

import type { DataSource, Disposable } from '@otelux/protocol';

export interface Storage {
	readonly kind: 'otelux/storage';
	close(): Promise<void> | void;
}

export interface EngineOptions {
	storage: Storage;
}

export interface Engine extends DataSource {
	subscribe(handler: () => void): Disposable;
	close(): Promise<void>;
}

export function createEngine(options: EngineOptions): Engine {
	const { storage } = options;
	const listeners = new Set<() => void>();

	return {
		kind: 'otelux/datasource',
		subscribe(handler: () => void): Disposable {
			listeners.add(handler);
			return {
				dispose: () => {
					listeners.delete(handler);
				},
			};
		},
		async close(): Promise<void> {
			listeners.clear();
			await storage.close();
		},
	};
}

export const OTELUX_ENGINE_VERSION = '0.0.0' as const;
