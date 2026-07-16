/**
 * In-process DataSource backed by an @otelux/engine instance.
 *
 * Used by hosts and tests that intentionally run the workbench and engine in
 * the same process.
 */

import type { Engine } from '@otelux/engine';
import type { DataSource } from '@otelux/protocol';

export function createDirectDataSource(engine: Engine): DataSource {
	return engine;
}

export const OTELUX_ADAPTER_DIRECT_VERSION = '0.0.0' as const;
