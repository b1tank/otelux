import { type Storage, createEngine } from '@otelux/engine';
import { describe, expect, it } from 'vitest';
import { OTELUX_RECEIVER_VERSION, createReceiver } from './index.js';

function memoryStorage(): Storage {
	return { kind: 'otelux/storage', close() {} };
}

describe('@otelux/receiver', () => {
	it('defaults to OTLP/HTTP port 4318', () => {
		const engine = createEngine({ storage: memoryStorage() });
		const receiver = createReceiver({ engine });
		expect(receiver.port).toBe(4318);
	});

	it('exports a version constant', () => {
		expect(OTELUX_RECEIVER_VERSION).toBe('0.0.0');
	});
});
