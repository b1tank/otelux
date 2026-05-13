import { describe, expect, it } from 'vitest';
import { createNodeSqliteStorage, OTELUX_ENGINE_NODE_VERSION } from './index.js';

describe('@otelux/engine-node', () => {
	it('creates an in-memory storage stub', () => {
		const storage = createNodeSqliteStorage({ path: ':memory:' });
		expect(storage.kind).toBe('otelux/storage');
		storage.close();
	});

	it('exports a version constant', () => {
		expect(OTELUX_ENGINE_NODE_VERSION).toBe('0.0.0');
	});
});
