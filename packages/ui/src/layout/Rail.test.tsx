/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Rail, type RailItem } from './Rail.js';

const ITEMS: ReadonlyArray<RailItem> = [
	{ id: 'traces', label: 'Traces', icon: <span /> },
	{ id: 'metrics', label: 'Metrics', icon: <span />, disabled: true },
	{ id: 'logs', label: 'Logs', icon: <span /> },
];

const FOOTER: ReadonlyArray<RailItem> = [{ id: 'settings', label: 'Settings', icon: <span /> }];

describe('Rail', () => {
	it('renders items and footer in vertical tablist semantics', () => {
		const { getByRole, getAllByRole } = render(
			<Rail items={ITEMS} footerItems={FOOTER} activeId="traces" onActivate={() => {}} />,
		);
		const list = getByRole('tablist');
		expect(list.getAttribute('aria-orientation')).toBe('vertical');
		const tabs = getAllByRole('tab');
		// 3 main + 1 footer
		expect(tabs.length).toBe(4);
	});

	it('marks the active item via aria-selected', () => {
		const { getByLabelText } = render(<Rail items={ITEMS} activeId="logs" onActivate={() => {}} />);
		expect(getByLabelText('Traces').getAttribute('aria-selected')).toBe('false');
		expect(getByLabelText('Logs').getAttribute('aria-selected')).toBe('true');
	});

	it('fires onActivate on click and disables disabled items', () => {
		const onActivate = vi.fn();
		const { getByLabelText } = render(<Rail items={ITEMS} onActivate={onActivate} />);
		fireEvent.click(getByLabelText('Traces'));
		expect(onActivate).toHaveBeenCalledWith('traces');
		const metrics = getByLabelText('Metrics') as HTMLButtonElement;
		expect(metrics.disabled).toBe(true);
		fireEvent.click(metrics);
		// click is a no-op on a disabled button — onActivate must not fire again.
		expect(onActivate).toHaveBeenCalledTimes(1);
	});
});
