import { describe, expect, it } from 'vitest';
import { OTELUX_PROTOCOL_VERSION } from './index.js';

describe('@otelux/protocol', () => {
	it('exports a version constant', () => {
		expect(OTELUX_PROTOCOL_VERSION).toBe('0.0.0');
	});
});
