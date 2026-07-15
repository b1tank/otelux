/**
 * @vitest-environment jsdom
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResultFooter } from './ResultFooter.js';

describe('ResultFooter', () => {
	it('pluralizes the noun and shows Live by default', () => {
		const { container } = render(<ResultFooter count={3} noun="trace" paused={false} />);
		expect(container.textContent).toContain('Showing 3 traces');
		expect(container.textContent).toContain('Live');
		expect(container.querySelector('.otelux-result-footer__state--paused')).toBeNull();
	});

	it('uses the singular noun for a single item', () => {
		const { container } = render(<ResultFooter count={1} noun="instrument" paused={false} />);
		expect(container.textContent).toContain('Showing 1 instrument');
	});

	it('marks the paused state', () => {
		const { container } = render(<ResultFooter count={0} noun="log" paused />);
		expect(container.textContent).toContain('Paused');
		expect(container.querySelector('.otelux-result-footer__state--paused')).toBeTruthy();
	});
});
