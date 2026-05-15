/**
 * @vitest-environment jsdom
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Workbench } from './Workbench.js';

describe('Workbench', () => {
	it('renders both panes and a splitter by default', () => {
		const { getByRole, getByTestId } = render(
			<Workbench
				left={<div data-testid="L">L</div>}
				right={<div data-testid="R">R</div>}
				initialLeftWidth={400}
			/>,
		);
		expect(getByTestId('L')).toBeTruthy();
		expect(getByTestId('R')).toBeTruthy();
		const sep = getByRole('separator');
		expect(sep.getAttribute('aria-valuenow')).toBe('400');
	});

	it('hides the left pane and the splitter when leftCollapsed', () => {
		const { queryByRole, container } = render(
			<Workbench left={<div>L</div>} right={<div>R</div>} leftCollapsed initialLeftWidth={400} />,
		);
		expect(queryByRole('separator')).toBeNull();
		const leftPane = container.querySelector('.otelux-workbench__pane--left') as HTMLElement;
		expect(leftPane.style.display).toBe('none');
	});

	it('hides the right pane and the splitter when rightCollapsed', () => {
		const { queryByRole, container } = render(
			<Workbench left={<div>L</div>} right={<div>R</div>} rightCollapsed initialLeftWidth={400} />,
		);
		expect(queryByRole('separator')).toBeNull();
		const rightPane = container.querySelector('.otelux-workbench__pane--right') as HTMLElement;
		expect(rightPane.style.display).toBe('none');
	});
});
