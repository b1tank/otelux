/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDisclosure } from './useDisclosure.js';

describe('useDisclosure', () => {
	it('toggles open / closed', () => {
		const { result } = renderHook(() => useDisclosure());
		expect(result.current.open).toBe(false);
		act(() => result.current.onOpen());
		expect(result.current.open).toBe(true);
		act(() => result.current.onClose());
		expect(result.current.open).toBe(false);
		act(() => result.current.onToggle());
		expect(result.current.open).toBe(true);
	});

	it('exposes matching aria-controls / content id', () => {
		const { result } = renderHook(() => useDisclosure());
		expect(result.current.triggerProps['aria-controls']).toBe(result.current.contentProps.id);
		expect(result.current.contentId).toBe(result.current.contentProps.id);
	});

	it('aria-expanded mirrors open state', () => {
		const { result } = renderHook(() => useDisclosure());
		expect(result.current.triggerProps['aria-expanded']).toBe(false);
		act(() => result.current.onOpen());
		expect(result.current.triggerProps['aria-expanded']).toBe(true);
	});

	it('closes on Escape', () => {
		const { result } = renderHook(() => useDisclosure({ initialOpen: true }));
		expect(result.current.open).toBe(true);
		act(() => {
			fireEvent.keyDown(document, { key: 'Escape' });
		});
		expect(result.current.open).toBe(false);
	});

	it('disableEscape keeps it open', () => {
		const { result } = renderHook(() => useDisclosure({ initialOpen: true, disableEscape: true }));
		act(() => {
			fireEvent.keyDown(document, { key: 'Escape' });
		});
		expect(result.current.open).toBe(true);
	});

	it('closes on outside click; ignores trigger and content clicks', () => {
		function Harness(): JSX.Element {
			const d = useDisclosure<HTMLButtonElement, HTMLDivElement>({ initialOpen: true });
			return (
				<div>
					<button type="button" {...d.triggerProps}>
						trigger
					</button>
					{d.open && (
						<div {...d.contentProps} data-testid="content">
							menu
						</div>
					)}
					<span data-testid="outside">outside</span>
					<span data-testid="open-flag">{String(d.open)}</span>
				</div>
			);
		}
		const { getByTestId, getByText } = render(<Harness />);
		expect(getByTestId('open-flag').textContent).toBe('true');

		// Clicking inside content does not close.
		fireEvent.mouseDown(getByTestId('content'));
		expect(getByTestId('open-flag').textContent).toBe('true');

		// Clicking the trigger does not close (toggle is the trigger's job).
		fireEvent.mouseDown(getByText('trigger'));
		expect(getByTestId('open-flag').textContent).toBe('true');

		// Clicking outside closes.
		fireEvent.mouseDown(getByTestId('outside'));
		expect(getByTestId('open-flag').textContent).toBe('false');
	});
});
