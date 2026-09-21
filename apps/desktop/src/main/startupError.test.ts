import { describe, expect, it } from 'vitest';
import { classifyDesktopStartupError, desktopStartupErrorMessage } from './startupError.js';

describe('Desktop startup errors', () => {
	it('explains missing packaged resources and the remediation', () => {
		expect(desktopStartupErrorMessage({ code: 'missing-resource' })).toContain('generated icons');
	});

	it('explains listener failures separately from runtime discovery', () => {
		expect(desktopStartupErrorMessage({ code: 'listener-bind' })).toContain('port conflict');
		expect(classifyDesktopStartupError({ code: 'EADDRINUSE' })).toBe('listener-bind');
	});

	it('classifies storage and renderer failures without exposing internals', () => {
		expect(classifyDesktopStartupError(new Error('SQLite migration failed'))).toBe('storage');
		expect(classifyDesktopStartupError(new Error('preload did-fail-load'))).toBe('renderer');
		expect(desktopStartupErrorMessage(new Error('SQLite secret token'))).not.toContain('secret');
	});

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
