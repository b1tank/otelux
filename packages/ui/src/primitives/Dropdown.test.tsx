/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dropdown, type DropdownOption } from './Dropdown.js';

const OPTIONS: ReadonlyArray<DropdownOption> = [
	{ value: '', label: 'All services', count: 12 },
	{ kind: 'separator' },
	{ value: 'frontend', label: 'frontend', count: 5, colorIndex: 1 },
	{ value: 'api', label: 'api', count: 4, colorIndex: 2 },
	{ value: 'db', label: 'db', count: 3, colorIndex: 3, disabled: true },
];

function Harness(props: { initial?: string; onChange?: (v: string) => void }): JSX.Element {
	const [value, setValue] = useState<string>(props.initial ?? '');
	return (
		<Dropdown
			value={value}
			onChange={(v) => {
				setValue(v);
				props.onChange?.(v);
			}}
			options={OPTIONS}
			placeholder="Service"
		/>
	);
}

describe('Dropdown', () => {
	it('shows the placeholder/label of the matching option', () => {
		const { getByRole } = render(<Harness initial="frontend" />);
		expect(getByRole('button').textContent).toContain('frontend');
	});

	it('opens on click and lists options with selection state', () => {
		const { getByRole, getAllByRole, queryByRole } = render(<Harness initial="" />);
		expect(queryByRole('listbox')).toBeNull();
		fireEvent.click(getByRole('button'));
		const opts = getAllByRole('option');
		// 4 selectable options (db is disabled but still rendered)
		expect(opts.length).toBe(4);
		const selected = opts.find((o) => o.getAttribute('aria-selected') === 'true');
		expect(selected?.textContent).toContain('All services');
	});

	it('selects via mouse and closes', () => {
		const onChange = vi.fn();
		const { getByRole, getByText, queryByRole } = render(<Harness onChange={onChange} />);
		fireEvent.click(getByRole('button'));
		fireEvent.mouseDown(getByText('frontend'));
		expect(onChange).toHaveBeenCalledWith('frontend');
		expect(queryByRole('listbox')).toBeNull();
	});

	it('arrow keys navigate and Enter selects', () => {
		const onChange = vi.fn();
		const { getByRole, queryByRole } = render(<Harness onChange={onChange} />);
		const trigger = getByRole('button');
		fireEvent.click(trigger);
		const list = getByRole('listbox');
		fireEvent.keyDown(list, { key: 'ArrowDown' });
		fireEvent.keyDown(list, { key: 'Enter' });
		expect(onChange).toHaveBeenCalledWith('frontend');
		expect(queryByRole('listbox')).toBeNull();
	});

	it('Escape closes without selecting', () => {
		const onChange = vi.fn();
		const { getByRole, queryByRole } = render(<Harness onChange={onChange} />);
		fireEvent.click(getByRole('button'));
		act(() => {
			fireEvent.keyDown(document, { key: 'Escape' });
		});
		expect(onChange).not.toHaveBeenCalled();
		expect(queryByRole('listbox')).toBeNull();
	});
});
