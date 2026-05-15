/**
 * Pure geometry helpers for the {@link Waterfall} view.
 *
 * Extracted to a separate module so the math can be exercised in unit
 * tests without rendering React or assembling fake Span trees.
 */

/**
 * Choose a "nice" tick interval close to `targetTicks` ticks across a
 * range of `totalNs` nanoseconds. Returns a power-of-10 multiple of
 * {1, 2, 5} measured in nanoseconds. Mirrors the d3-time tick selection
 * approach but for a single linear scale.
 *
 * Examples (totalNs, targetTicks):
 *   ( 12_500_000, 5 ) -> 2_000_000  (i.e. 2 ms)
 *   ( 1_500,       5 ) -> 200       (i.e. 200 ns)
 *   ( 900_000_000, 5 ) -> 200_000_000 (200 ms)
 */
export function chooseTickIntervalNs(totalNs: number, targetTicks: number): number {
	if (totalNs <= 0 || targetTicks <= 0) {
		return 1;
	}
	const rough = totalNs / targetTicks;
	const exponent = Math.floor(Math.log10(rough));
	const pow10 = 10 ** exponent;
	const mantissa = rough / pow10;
	// Snap up to the next "nice" multiplier so we never produce *more*
	// ticks than requested.
	let nice: 1 | 2 | 5 | 10;
	if (mantissa <= 1) {
		nice = 1;
	} else if (mantissa <= 2) {
		nice = 2;
	} else if (mantissa <= 5) {
		nice = 5;
	} else {
		nice = 10;
	}
	return nice * pow10;
}

/**
 * Generate tick offsets (nanoseconds from trace start) at the chosen
 * interval, inclusive of 0 and excluding any tick beyond `totalNs`.
 */
export function makeRulerTicks(totalNs: number, targetTicks: number): readonly number[] {
	const step = chooseTickIntervalNs(totalNs, targetTicks);
	const ticks: number[] = [];
	for (let v = 0; v <= totalNs + 1e-9; v += step) {
		ticks.push(v);
		// Guard against floating-point drift on very small intervals.
		if (ticks.length > 1024) {
			break;
		}
	}
	return ticks;
}

/**
 * Format a tick label using the largest unit that keeps the number
 * compact. Mirrors `formatDuration` from `../format.ts` but stays in
 * nanoseconds-as-number rather than bigint to avoid conversion churn in
 * the render hot path.
 */
export function formatRulerTick(ns: number): string {
	if (ns === 0) {
		return '0';
	}
	if (ns >= 1_000_000_000) {
		return `${stripZeros(ns / 1_000_000_000)}s`;
	}
	if (ns >= 1_000_000) {
		return `${stripZeros(ns / 1_000_000)}ms`;
	}
	if (ns >= 1_000) {
		return `${stripZeros(ns / 1_000)}µs`;
	}
	return `${stripZeros(ns)}ns`;
}

function stripZeros(n: number): string {
	// Print at most 2 decimals, then drop trailing zeros so 2.00 -> "2".
	const s = n.toFixed(2);
	return s.replace(/\.?0+$/, '');
}

/**
 * Map a nanosecond offset into a pixel x within the bar area, clamped
 * so out-of-range values still render on-screen.
 */
export function timeToX(
	ns: number,
	totalNs: number,
	barAreaStart: number,
	barAreaWidth: number,
): number {
	const denom = totalNs > 0 ? totalNs : 1;
	const t = Math.max(0, Math.min(1, ns / denom));
	return barAreaStart + t * barAreaWidth;
}
