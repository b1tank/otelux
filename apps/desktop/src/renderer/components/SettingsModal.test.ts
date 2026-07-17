import { describe, expect, it } from 'vitest';
import { parseRetentionLimit } from './SettingsModal.js';

describe('parseRetentionLimit', () => {
	it('accepts only complete non-negative integer strings', () => {
		expect(parseRetentionLimit('0')).toBe(0);
		expect(parseRetentionLimit('512')).toBe(512);
		expect(parseRetentionLimit('1.5')).toBeUndefined();
		expect(parseRetentionLimit('-1')).toBeUndefined();
		expect(parseRetentionLimit('12hours')).toBeUndefined();
		expect(parseRetentionLimit('')).toBeUndefined();
	});
});
