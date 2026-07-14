/**
 * Renderer trust-boundary predicates for the Electron main process.
 *
 * These are pure so they can be unit-tested without an Electron runtime;
 * `index.ts` wires them into the actual `will-navigate`, window-open, and
 * permission callbacks. The renderer only ever displays local telemetry
 * from bundled app content, so the safe defaults are strict: never
 * navigate the top frame away from the app, and only hand explicit HTTPS
 * links to the system browser.
 */

/**
 * Whether a URL may be opened in the system browser. Only well-formed
 * `https:` URLs qualify. This rejects `http:` (downgrade), `file:`
 * (local file disclosure), and script-bearing schemes such as
 * `javascript:` and `data:` that could run if a link ever reached the
 * shell. A value that does not parse as a URL is rejected.
 */
export function isAllowedExternalUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	return parsed.protocol === 'https:';
}

/**
 * Whether a top-frame navigation is allowed. The app is a single page
 * that never navigates its top frame; the only legitimate navigation is
 * a reload to the exact URL it was loaded from (`file://…/index.html`
 * when packaged, or the dev server URL). Anything else — a telemetry
 * value coercing a navigation, a redirect to a remote origin, a
 * `file://` traversal — is denied so external links must go through the
 * window-open handler instead.
 */
export function isAllowedNavigation(targetUrl: string, appUrl: string): boolean {
	return targetUrl === appUrl;
}
