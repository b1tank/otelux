/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clampWidth, useResizable } from './useResizable.js';

describe('clampWidth', () => {
	it('clamps to min and max', () => {
		expect(clampWidth(50, 100, 400)).toBe(100);
		expect(clampWidth(500, 100, 400)).toBe(400);
		expect(clampWidth(200, 100, 400)).toBe(200);
	});

	it('handles inverted bounds by returning min (defensive)', () => {
		expect(clampWidth(200, 400, 100)).toBe(400);
	});
});

describe('useResizable', () => {
	beforeEach(() => {
		localStorage.clear();
	});
	afterEach(() => {
		localStorage.clear();
	});

	it('starts at the initial width clamped to min/max', () => {
		const { result } = renderHook(() => useResizable({ initial: 360, min: 280, max: 640 }));
		expect(result.current.width).toBe(360);

		const { result: tooSmall } = renderHook(() => useResizable({ initial: 100, min: 280, max: 640 }));
		expect(tooSmall.current.width).toBe(280);
	});

	it('keyboard nudges by step (default 8)', () => {
		const { result } = renderHook(() => useResizable({ initial: 360, min: 280, max: 640 }));
		act(() => {
			result.current.onKeyDown({
				key: 'ArrowRight',
				preventDefault: () => {},
				shiftKey: false,
			} as never);
		});
		expect(result.current.width).toBe(368);
	});

	it('Shift+arrow nudges by step*4', () => {
		const { result } = renderHook(() => useResizable({ initial: 360, min: 280, max: 640, step: 10 }));
		act(() => {
			result.current.onKeyDown({
				key: 'ArrowLeft',
				preventDefault: () => {},
				shiftKey: true,
			} as never);
		});
		expect(result.current.width).toBe(320);
	});

	it('Home and End jump to min and max', () => {
		const { result } = renderHook(() => useResizable({ initial: 360, min: 280, max: 640 }));
		act(() => {
			result.current.onKeyDown({ key: 'Home', preventDefault: () => {}, shiftKey: false } as never);
		});
		expect(result.current.width).toBe(280);
		act(() => {
			result.current.onKeyDown({ key: 'End', preventDefault: () => {}, shiftKey: false } as never);
		});
		expect(result.current.width).toBe(640);
	});

	it('persists to localStorage when storageKey is set and committed', () => {
		const KEY = 'otelux-test:list-w';
		const { result } = renderHook(() =>
			useResizable({ initial: 360, min: 280, max: 640, storageKey: KEY }),
		);
		act(() => {
			result.current.onKeyDown({ key: 'End', preventDefault: () => {}, shiftKey: false } as never);
		});
		expect(localStorage.getItem(KEY)).toBe('640');
	});

	it('reads persisted value on mount and clamps it', () => {
		const KEY = 'otelux-test:list-w-2';
		localStorage.setItem(KEY, '9999');
		const { result } = renderHook(() =>
			useResizable({ initial: 360, min: 280, max: 640, storageKey: KEY }),
		);
		expect(result.current.width).toBe(640);
	});
});
