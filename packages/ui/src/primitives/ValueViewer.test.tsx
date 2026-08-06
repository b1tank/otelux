/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ValueViewer } from './ValueViewer.js';

describe('ValueViewer', () => {
	it('renders nothing when closed', () => {
		const { container } = render(<ValueViewer open={false} onClose={() => {}} value="x" />);
		expect(container.querySelector('.otelux-value-viewer')).toBeNull();
	});

	it('renders a string value as plain text', () => {
		const { container, getByText } = render(
			<ValueViewer open={true} onClose={() => {}} title="http.url" value="/api/users" />,
		);
		expect(getByText('http.url')).toBeTruthy();
		const body = container.querySelector('.otelux-value-viewer__body');
		expect(body?.className).toContain('--text');
		const code = container.querySelector('.otelux-value-viewer__code');
		expect(code?.textContent).toBe('/api/users');
	});

	it('renders an array as pretty-printed JSON', () => {
		const { container } = render(
			<ValueViewer open={true} onClose={() => {}} title="tags" value={['a', 'b', 'c']} />,
		);
		const body = container.querySelector('.otelux-value-viewer__body');
		expect(body?.className).toContain('--json');
		const code = container.querySelector('.otelux-value-viewer__code');
		expect(code?.textContent).toBe('[\n  "a",\n  "b",\n  "c"\n]');
	});

	it('coerces bigint values to a decimal string', () => {
		const { container } = render(<ValueViewer open={true} onClose={() => {}} value={42n} />);
		const code = container.querySelector('.otelux-value-viewer__code');
		expect(code?.textContent).toBe('42');
	});

	it('fires onClose when close button, backdrop, or Escape are activated', () => {
		const onClose = vi.fn();
		const { getByLabelText, unmount } = render(
			<ValueViewer open={true} onClose={onClose} value="hi" />,
		);
		fireEvent.click(getByLabelText('Close'));
		expect(onClose).toHaveBeenCalledTimes(1);
		fireEvent.click(getByLabelText('Close value viewer'));
		expect(onClose).toHaveBeenCalledTimes(2);
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(3);
		unmount();
	});

	it('copies the rendered text to the clipboard', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		// jsdom does not implement the clipboard API; install a minimal fake.
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});
		const { getByRole, findByRole } = render(
			<ValueViewer open={true} onClose={() => {}} title="x" value="hi" />,
		);
		fireEvent.click(getByRole('button', { name: 'Copy' }));
		expect(writeText).toHaveBeenCalledWith('hi');
		// Await the post-clipboard state morph so React's act warning is satisfied.
		await findByRole('button', { name: 'Copied' });
	});

	it('falls back when the sandbox rejects navigator clipboard writes', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
		});
		const execCommand = vi.fn().mockReturnValue(true);
		Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
		const { getByRole, findByRole } = render(
			<ValueViewer open={true} onClose={() => {}} title="x" value="sandboxed" />,
		);
		fireEvent.click(getByRole('button', { name: 'Copy' }));
		await findByRole('button', { name: 'Copied' });
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	it('morphs the Copy button to "Copied" with a check icon after click', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText },
		});
		const { getByRole, findByRole } = render(
			<ValueViewer open={true} onClose={() => {}} title="x" value="hi" />,
		);
		fireEvent.click(getByRole('button', { name: 'Copy' }));
		// Wait for the clipboard promise to resolve and the state morph.
		const copied = await findByRole('button', { name: 'Copied' });
		expect(copied.className).toContain('is-copied');
	});
});
