import { describe, expect, it } from 'vitest';
import { OTELUX_TYPES_VERSION } from './index.js';

describe('@otelux/types', () => {
	it('exports a version constant', () => {
		expect(OTELUX_TYPES_VERSION).toBe('0.0.0');
	});
});
