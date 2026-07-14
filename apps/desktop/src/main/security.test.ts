import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl, isAllowedNavigation } from './security.js';

describe('isAllowedExternalUrl', () => {
	it('allows well-formed https URLs', () => {
		expect(isAllowedExternalUrl('https://example.com/docs')).toBe(true);
		expect(isAllowedExternalUrl('https://example.com:8443/path?q=1#h')).toBe(true);
	});

	it('rejects non-https schemes and malformed input', () => {
		expect(isAllowedExternalUrl('http://example.com')).toBe(false);
		expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
		expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
		expect(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
		expect(isAllowedExternalUrl('mailto:someone@example.com')).toBe(false);
		expect(isAllowedExternalUrl('not a url')).toBe(false);
		expect(isAllowedExternalUrl('')).toBe(false);
	});
});

describe('isAllowedNavigation', () => {
	const appUrl = 'file:///opt/otelux/resources/app/out/renderer/index.html';

	it('allows a reload to the exact app URL', () => {
		expect(isAllowedNavigation(appUrl, appUrl)).toBe(true);
	});

	it('denies navigation to any other destination', () => {
		expect(isAllowedNavigation('https://evil.example/', appUrl)).toBe(false);
		expect(
			isAllowedNavigation('file:///opt/otelux/resources/app/out/renderer/other.html', appUrl),
		).toBe(false);
		expect(isAllowedNavigation('file:///etc/passwd', appUrl)).toBe(false);
		expect(isAllowedNavigation('', appUrl)).toBe(false);
	});
});
