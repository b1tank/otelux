/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog.js';

describe('ConfirmDialog', () => {
	it('renders nothing when closed', () => {
		const { container } = render(
			<ConfirmDialog
				open={false}
				title="Clear?"
				message="msg"
				onConfirm={() => {}}
				onCancel={() => {}}
			/>,
		);
		expect(container.querySelector('.otelux-confirm')).toBeNull();
	});

	it('shows the title, message, and confirms/cancels', () => {
		const onConfirm = vi.fn();
		const onCancel = vi.fn();
		const { getByText } = render(
			<ConfirmDialog
				open
				title="Clear all telemetry?"
				message="This cannot be undone."
				confirmLabel="Clear data"
				destructive
				onConfirm={onConfirm}
				onCancel={onCancel}
			/>,
		);
		getByText('Clear all telemetry?');
		getByText('This cannot be undone.');
		fireEvent.click(getByText('Clear data'));
		expect(onConfirm).toHaveBeenCalledTimes(1);
		fireEvent.click(getByText('Cancel'));
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('marks the confirm button destructive and cancels on Escape', () => {
		const onCancel = vi.fn();
		const { container } = render(
			<ConfirmDialog
				open
				title="t"
				message="m"
				destructive
				onConfirm={() => {}}
				onCancel={onCancel}
			/>,
		);
		expect(container.querySelector('.otelux-confirm__confirm--destructive')).toBeTruthy();
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
