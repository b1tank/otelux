/**
 * @vitest-environment jsdom
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell.js';

describe('AppShell', () => {
	it('renders rail and main slots in document order', () => {
		const { container } = render(
			<AppShell rail={<div data-testid="rail">rail</div>}>
				<div data-testid="main">main</div>
			</AppShell>,
		);
		const root = container.firstElementChild as HTMLElement;
		const rail = root.children[0] as HTMLElement;
		const main = root.children[1] as HTMLElement;
		expect(root.className).toBe('otelux-app-shell');
		expect(rail.tagName).toBe('ASIDE');
		expect(rail.className).toBe('otelux-app-shell__rail');
		expect(main.tagName).toBe('MAIN');
		expect(main.className).toBe('otelux-app-shell__main');
	});
});
