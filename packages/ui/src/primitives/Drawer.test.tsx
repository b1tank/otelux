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

	it('does not render a dim backdrop (design parity)', () => {
		const { container } = render(
			<Drawer open={true} onClose={() => {}} title="t">
				x
			</Drawer>,
		);
		expect(container.querySelector('.otelux-drawer__backdrop')).toBeNull();
	});

	it('renders accent dot and kind tag when provided', () => {
		const { container, getByText } = render(
			<Drawer
				open={true}
				onClose={() => {}}
				title="GET /api"
				accentVar="var(--otelux-svc-3)"
				kindLabel="Client"
			>
				x
			</Drawer>,
		);
		expect(container.querySelector('.otelux-drawer__dot')).toBeTruthy();
		expect(getByText('Client')).toBeTruthy();
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
