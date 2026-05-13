/**
 * In-process DataSource backed by an @otelux/engine instance.
 *
 * Used by Electron's renderer-over-IPC bridge and by the future web demo.
 * For VS Code embedders, prefer @otelux/adapter-vscode.
 */

import type { Engine } from '@otelux/engine';
import type { DataSource } from '@otelux/protocol';

export function createDirectDataSource(engine: Engine): DataSource {
	return engine;
}

export const OTELUX_ADAPTER_DIRECT_VERSION = '0.0.0' as const;
