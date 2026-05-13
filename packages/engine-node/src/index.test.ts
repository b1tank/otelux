import { describe, expect, it } from 'vitest';
import { OTELUX_ENGINE_NODE_VERSION, createNodeSqliteStorage } from './index.js';

describe('@otelux/engine-node', () => {
	it('returns a Storage instance', () => {
		const storage = createNodeSqliteStorage({ path: ':memory:' });
		expect(storage.kind).toBe('otelux/storage');
		storage.close();
	});

	it('reports a version', () => {
		expect(OTELUX_ENGINE_NODE_VERSION).toBe('0.1.0');
	});
});
