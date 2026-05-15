/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton, ToggleChip } from './index.js';

describe('IconButton', () => {
	it('uses aria-label as default title', () => {
		const { getByLabelText } = render(<IconButton aria-label="Close">×</IconButton>);
		const btn = getByLabelText('Close');
		expect(btn.getAttribute('title')).toBe('Close');
	});

	it('respects an explicit title', () => {
		const { getByLabelText } = render(
			<IconButton aria-label="Close" title="Close (Esc)">
				×
			</IconButton>,
		);
		expect(getByLabelText('Close').getAttribute('title')).toBe('Close (Esc)');
	});

	it('defaults to type="button" so it never submits enclosing forms', () => {
		const { getByLabelText } = render(<IconButton aria-label="x">x</IconButton>);
		expect(getByLabelText('x').getAttribute('type')).toBe('button');
	});
});

describe('ToggleChip', () => {
	it('exposes aria-pressed and toggles on click', () => {
		const onPressedChange = vi.fn();
		const { getByRole, rerender } = render(
			<ToggleChip pressed={false} onPressedChange={onPressedChange}>
				Errors only
			</ToggleChip>,
		);
		const btn = getByRole('button', { name: 'Errors only' });
		expect(btn.getAttribute('aria-pressed')).toBe('false');
		fireEvent.click(btn);
		expect(onPressedChange).toHaveBeenCalledWith(true);

		rerender(
			<ToggleChip pressed={true} onPressedChange={onPressedChange}>
				Errors only
			</ToggleChip>,
		);
		expect(getByRole('button', { name: 'Errors only' }).getAttribute('aria-pressed')).toBe('true');
	});

	it('applies the pressedTone class', () => {
		const { container } = render(
			<ToggleChip pressed={true} pressedTone="error" onPressedChange={() => {}}>
				Errors only
			</ToggleChip>,
		);
		expect(container.firstElementChild?.className).toContain('otelux-toggle-chip--error');
	});
});
