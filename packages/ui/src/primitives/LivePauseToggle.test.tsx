/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LivePauseToggle } from './LivePauseToggle.js';

describe('LivePauseToggle', () => {
	it('shows Live and toggles on click', () => {
		const onToggle = vi.fn();
		const { getByRole } = render(<LivePauseToggle paused={false} onToggle={onToggle} />);
		const button = getByRole('button');
		expect(button.textContent).toContain('Live');
		expect(button.getAttribute('aria-pressed')).toBe('false');
		fireEvent.click(button);
		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it('shows Paused and reflects the pressed state', () => {
		const { getByRole } = render(<LivePauseToggle paused onToggle={() => {}} />);
		const button = getByRole('button');
		expect(button.textContent).toContain('Paused');
		expect(button.getAttribute('aria-pressed')).toBe('true');
	});
});
