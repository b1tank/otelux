/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Splitter } from './Splitter.js';

describe('Splitter', () => {
	it('exposes ARIA separator metadata', () => {
		const { getByRole } = render(
			<Splitter
				value={420.4}
				min={280}
				max={800}
				aria-label="Resize trace list"
				onPointerDown={() => {}}
				onKeyDown={() => {}}
			/>,
		);
		const sep = getByRole('separator');
		expect(sep.getAttribute('aria-orientation')).toBe('vertical');
		expect(sep.getAttribute('aria-valuenow')).toBe('420');
		expect(sep.getAttribute('aria-valuemin')).toBe('280');
		expect(sep.getAttribute('aria-valuemax')).toBe('800');
		expect(sep.getAttribute('aria-label')).toBe('Resize trace list');
		expect(sep.getAttribute('tabindex')).toBe('0');
	});

	it('forwards pointerdown and keydown handlers', () => {
		const onPointerDown = vi.fn();
		const onKeyDown = vi.fn();
		const { getByRole } = render(
			<Splitter
				value={400}
				min={280}
				max={800}
				aria-label="x"
				onPointerDown={onPointerDown}
				onKeyDown={onKeyDown}
			/>,
		);
		const sep = getByRole('separator');
		fireEvent.pointerDown(sep);
		fireEvent.keyDown(sep, { key: 'ArrowRight' });
		expect(onPointerDown).toHaveBeenCalledTimes(1);
		expect(onKeyDown).toHaveBeenCalledTimes(1);
	});
});
