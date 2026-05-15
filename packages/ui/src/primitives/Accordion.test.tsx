/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Accordion, type AccordionItem } from './Accordion.js';

function items(): AccordionItem[] {
	return [
		{ id: 'a', label: 'Section A', children: <div>body-a</div> },
		{ id: 'b', label: 'Section B', children: <div>body-b</div>, defaultOpen: true },
		{ id: 'c', label: 'Section C', children: <div>body-c</div>, badge: <span>3</span> },
	];
}

describe('Accordion', () => {
	it('honours defaultOpen on initial render', () => {
		const { queryByText } = render(<Accordion items={items()} />);
		expect(queryByText('body-a')).toBeNull();
		expect(queryByText('body-b')).not.toBeNull();
		expect(queryByText('body-c')).toBeNull();
	});

	it('toggles uncontrolled sections without closing other open ones', () => {
		const { getByText, queryByText } = render(<Accordion items={items()} />);
		fireEvent.click(getByText('Section A'));
		expect(queryByText('body-a')).not.toBeNull();
		// B was open via defaultOpen and must stay open.
		expect(queryByText('body-b')).not.toBeNull();
		// Toggle A back closed.
		fireEvent.click(getByText('Section A'));
		expect(queryByText('body-a')).toBeNull();
	});

	it('exposes aria-expanded matching the open state', () => {
		const { getByText } = render(<Accordion items={items()} />);
		const a = getByText('Section A').closest('button') as HTMLButtonElement;
		const b = getByText('Section B').closest('button') as HTMLButtonElement;
		expect(a.getAttribute('aria-expanded')).toBe('false');
		expect(b.getAttribute('aria-expanded')).toBe('true');
	});

	it('reports next open set in controlled mode without self-updating', () => {
		const onOpenChange = vi.fn();
		const { getByText, queryByText, rerender } = render(
			<Accordion items={items()} openIds={new Set(['b'])} onOpenChange={onOpenChange} />,
		);
		fireEvent.click(getByText('Section A'));
		expect(onOpenChange).toHaveBeenCalledTimes(1);
		const next = onOpenChange.mock.calls[0]?.[0] as ReadonlySet<string>;
		expect(next.has('a')).toBe(true);
		expect(next.has('b')).toBe(true);
		// Parent has not pushed new openIds yet, so a stays closed visually.
		expect(queryByText('body-a')).toBeNull();
		rerender(<Accordion items={items()} openIds={next} onOpenChange={onOpenChange} />);
		expect(queryByText('body-a')).not.toBeNull();
	});

	it('renders a badge when provided', () => {
		const { getByText } = render(<Accordion items={items()} />);
		expect(getByText('3')).toBeTruthy();
	});
});
