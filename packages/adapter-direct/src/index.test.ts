import { type Storage, createEngine } from '@otelux/engine';
import { describe, expect, it } from 'vitest';
import { OTELUX_ADAPTER_DIRECT_VERSION, createDirectDataSource } from './index.js';

function memoryStorage(): Storage {
	return { kind: 'otelux/storage', close() {} };
}

describe('@otelux/adapter-direct', () => {
	it('returns the engine as a DataSource', () => {
		const engine = createEngine({ storage: memoryStorage() });
		const ds = createDirectDataSource(engine);
		expect(ds.kind).toBe('otelux/datasource');
	});

	it('exports a version constant', () => {
		expect(OTELUX_ADAPTER_DIRECT_VERSION).toBe('0.0.0');
	});
});
