import { describe, expect, it } from 'vitest';
import { desktopStartupErrorMessage } from './startupError.js';

describe('Desktop startup errors', () => {
	it('gives an actionable version mismatch without replacing the owner', () => {
		expect(
			desktopStartupErrorMessage({
				code: 'incompatible-version',
				message: 'Runtime version 1.0.0 does not match host version 2.0.0',
			}),
		).toContain('Stop the existing prerelease runtime');
	});

	it('does not expose arbitrary internal errors', () => {
		expect(desktopStartupErrorMessage(new Error('secret token SQL'))).not.toContain('secret');
	});
});
