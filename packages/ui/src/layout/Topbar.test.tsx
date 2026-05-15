/**
 * @vitest-environment jsdom
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Topbar } from './Topbar.js';

describe('Topbar', () => {
	it('renders all three slots in start/center/end order', () => {
		const { container } = render(
			<Topbar
				start={<span data-testid="s">s</span>}
				center={<span data-testid="c">c</span>}
				end={<span data-testid="e">e</span>}
			/>,
		);
		const root = container.firstElementChild as HTMLElement;
		expect(root.tagName).toBe('HEADER');
		expect(root.children[0]?.className).toContain('--start');
		expect(root.children[1]?.className).toContain('--center');
		expect(root.children[2]?.className).toContain('--end');
	});

	it('keeps slot containers even when content is missing', () => {
		const { container } = render(<Topbar />);
		const root = container.firstElementChild as HTMLElement;
		expect(root.children.length).toBe(3);
	});
});
