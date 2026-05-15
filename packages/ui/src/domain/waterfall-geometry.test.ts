import { describe, expect, it } from 'vitest';
import {
	chooseTickIntervalNs,
	formatRulerTick,
	makeRulerTicks,
	timeToX,
} from './waterfall-geometry.js';

describe('chooseTickIntervalNs', () => {
	it('returns a nice 1/2/5 power-of-10 nanosecond step', () => {
		// ~12.5 ms / 5 ≈ 2.5 ms, rounds up to 5 ms? No — mantissa rule
		// snaps 2.5 -> 5 because 2 < 2.5 <= 5. Verify the contract.
		expect(chooseTickIntervalNs(12_500_000, 5)).toBe(5_000_000);
		expect(chooseTickIntervalNs(1_500, 5)).toBe(500);
		expect(chooseTickIntervalNs(900_000_000, 5)).toBe(200_000_000);
	});

	it('degrades gracefully for non-positive inputs', () => {
		expect(chooseTickIntervalNs(0, 5)).toBe(1);
		expect(chooseTickIntervalNs(100, 0)).toBe(1);
	});
});

describe('makeRulerTicks', () => {
	it('emits inclusive ticks at the chosen interval', () => {
		const ticks = makeRulerTicks(10_000_000, 5);
		// step = chooseTickIntervalNs(10ms, 5) = 2ms
		expect(ticks).toEqual([0, 2_000_000, 4_000_000, 6_000_000, 8_000_000, 10_000_000]);
	});

	it('starts at 0 even for very small ranges', () => {
		expect(makeRulerTicks(50, 5)[0]).toBe(0);
	});
});

describe('formatRulerTick', () => {
	it('uses the largest compact unit', () => {
		expect(formatRulerTick(0)).toBe('0');
		expect(formatRulerTick(750)).toBe('750ns');
		expect(formatRulerTick(1_500)).toBe('1.5µs');
		expect(formatRulerTick(2_000_000)).toBe('2ms');
		expect(formatRulerTick(1_500_000_000)).toBe('1.5s');
	});
});

describe('timeToX', () => {
	it('maps proportionally and clamps to the bar area', () => {
		expect(timeToX(0, 100, 280, 800)).toBe(280);
		expect(timeToX(50, 100, 280, 800)).toBe(680);
		expect(timeToX(100, 100, 280, 800)).toBe(1080);
		// Out-of-range clamps to the right edge.
		expect(timeToX(200, 100, 280, 800)).toBe(1080);
		// Negative clamps to the left edge.
		expect(timeToX(-50, 100, 280, 800)).toBe(280);
	});
});
