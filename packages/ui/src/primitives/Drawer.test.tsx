/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './Drawer.js';

describe('Drawer', () => {
	it('renders nothing when closed', () => {
		const { container } = render(
			<Drawer open={false} onClose={() => {}} title="Hello">
				body
			</Drawer>,
		);
		expect(container.querySelector('.otelux-drawer')).toBeNull();
	});

	it('renders a labelled dialog with the title and body when open', () => {
		const { getByRole, getByText } = render(
			<Drawer open={true} onClose={() => {}} title="Span detail">
				<div>some body</div>
			</Drawer>,
		);
		const dialog = getByRole('dialog');
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(getByText('Span detail')).toBeTruthy();
		expect(getByText('some body')).toBeTruthy();
	});

	it('falls back to aria-label when no title is provided', () => {
		const { getByRole } = render(
			<Drawer open={true} onClose={() => {}} ariaLabel="Tools">
				x
			</Drawer>,
		);
		expect(getByRole('dialog').getAttribute('aria-label')).toBe('Tools');
	});

	it('fires onClose when the close button is clicked', () => {
		const onClose = vi.fn();
		const { getByLabelText } = render(
			<Drawer open={true} onClose={onClose} title="t">
				x
			</Drawer>,
		);
		fireEvent.click(getByLabelText('Close'));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('fires onClose when the backdrop is clicked', () => {
		const onClose = vi.fn();
		const { getByLabelText } = render(
			<Drawer open={true} onClose={onClose} title="t">
				x
			</Drawer>,
		);
		fireEvent.click(getByLabelText('Close drawer'));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('fires onClose when Escape is pressed', () => {
		const onClose = vi.fn();
		render(
			<Drawer open={true} onClose={onClose} title="t">
				x
			</Drawer>,
		);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
