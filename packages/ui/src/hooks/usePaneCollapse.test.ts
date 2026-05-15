/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePaneCollapse } from './usePaneCollapse.js';

describe('usePaneCollapse', () => {
	it('starts with both visible by default', () => {
		const { result } = renderHook(() => usePaneCollapse());
		expect(result.current.listCollapsed).toBe(false);
		expect(result.current.wfCollapsed).toBe(false);
	});

	it('collapsing list forces wf visible (invariant 1)', () => {
		const { result } = renderHook(() => usePaneCollapse());
		act(() => result.current.collapse('list'));
		expect(result.current.listCollapsed).toBe(true);
		expect(result.current.wfCollapsed).toBe(false);

		// Now collapse wf: list must auto-restore.
		act(() => result.current.collapse('wf'));
		expect(result.current.listCollapsed).toBe(false);
		expect(result.current.wfCollapsed).toBe(true);
	});

	it('toggle behaves the same way (closing one always shows the other)', () => {
		const { result } = renderHook(() => usePaneCollapse());
		act(() => result.current.toggle('list'));
		expect(result.current.listCollapsed).toBe(true);
		expect(result.current.wfCollapsed).toBe(false);

		// Toggle list again — restores list.
		act(() => result.current.toggle('list'));
		expect(result.current.listCollapsed).toBe(false);

		// Toggle wf — collapses wf.
		act(() => result.current.toggle('wf'));
		expect(result.current.wfCollapsed).toBe(true);

		// Now toggle list (currently visible) — collapsing list must show wf.
		act(() => result.current.toggle('list'));
		expect(result.current.listCollapsed).toBe(true);
		expect(result.current.wfCollapsed).toBe(false);
	});

	it('restore re-shows a pane without affecting the other', () => {
		const { result } = renderHook(() => usePaneCollapse({ initialListCollapsed: true }));
		expect(result.current.listCollapsed).toBe(true);
		act(() => result.current.restore('list'));
		expect(result.current.listCollapsed).toBe(false);
		expect(result.current.wfCollapsed).toBe(false);
	});

	it('falls back to both-visible if config asks to collapse both', () => {
		const { result } = renderHook(() =>
			usePaneCollapse({ initialListCollapsed: true, initialWfCollapsed: true }),
		);
		expect(result.current.listCollapsed).toBe(false);
		expect(result.current.wfCollapsed).toBe(false);
	});
});
