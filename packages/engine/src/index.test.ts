import { describe, expect, it } from 'vitest';
import { createEngine, OTELUX_ENGINE_VERSION, type Storage } from './index.js';

function memoryStorage(): Storage {
	return { kind: 'otelux/storage', close() {} };
}

describe('@otelux/engine', () => {
	it('creates an engine that exposes the DataSource contract', () => {
		const engine = createEngine({ storage: memoryStorage() });
		expect(engine.kind).toBe('otelux/datasource');
	});

	it('subscribe returns a disposable', () => {
		const engine = createEngine({ storage: memoryStorage() });
		const sub = engine.subscribe(() => {});
		expect(typeof sub.dispose).toBe('function');
		sub.dispose();
	});

	it('exports a version constant', () => {
		expect(OTELUX_ENGINE_VERSION).toBe('0.0.0');
	});
});
