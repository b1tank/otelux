/**
 * @vitest-environment jsdom
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilterBar } from './FilterBar.js';

describe('FilterBar', () => {
	it('renders only the filters slot when end is not provided', () => {
		const { container } = render(<FilterBar filters={<span data-testid="f" />} />);
		const root = container.firstElementChild as HTMLElement;
		expect(root.children.length).toBe(1);
		expect(root.children[0]?.className).toBe('otelux-filter-bar__filters');
	});

	it('renders end slot when provided', () => {
		const { container } = render(
			<FilterBar filters={<span />} end={<button type="button">Clear</button>} />,
		);
		const root = container.firstElementChild as HTMLElement;
		expect(root.children.length).toBe(2);
		expect(root.children[1]?.className).toBe('otelux-filter-bar__end');
	});
});
