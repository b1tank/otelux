/**
 * Formatting and color helpers shared across UI components.
 *
 * The engine works in nanoseconds (BigInt) to preserve OTLP fixed64 range.
 * UI rendering — pixels, durations on screen — uses plain numbers. Helpers
 * here gate the conversion so the boundary is consistent.
 */

const NS_PER_MS = 1_000_000n;
const NS_PER_S = 1_000_000_000n;

/** Format a duration (nanoseconds) for display: `123 µs` / `4.5 ms` / `1.2 s`. */
export function formatDuration(nanos: bigint): string {
	if (nanos < 1_000n) {
		return `${nanos}ns`;
	}
	if (nanos < 1_000_000n) {
		return `${(Number(nanos) / 1_000).toFixed(1)}µs`;
	}
	if (nanos < NS_PER_S) {
		return `${(Number(nanos) / 1_000_000).toFixed(1)}ms`;
	}
	return `${(Number(nanos) / Number(NS_PER_S)).toFixed(2)}s`;
}

/** Format a Unix-nanos timestamp as an ISO-ish wall-clock string. */
export function formatWallClock(unixNano: bigint): string {
	if (unixNano === 0n) {
		return '—';
	}
	const ms = Number(unixNano / NS_PER_MS);
	const d = new Date(ms);
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	const ss = String(d.getSeconds()).padStart(2, '0');
	const sss = String(d.getMilliseconds()).padStart(3, '0');
	return `${hh}:${mm}:${ss}.${sss}`;
}

/**
 * Deterministic color for a service name. Uses a small fixed palette so
 * the same service always renders in the same hue across components and
 * sessions. Hash is FNV-1a — non-cryptographic, fast, well-distributed.
 */
const SERVICE_PALETTE = [
	'#7aa2f7', // blue
	'#9ece6a', // green
	'#e0af68', // amber
	'#bb9af7', // violet
	'#f7768e', // red
	'#7dcfff', // cyan
	'#ff9e64', // orange
	'#73daca', // teal
];

export function colorForService(name: string): string {
	let hash = 2166136261;
	for (let i = 0; i < name.length; i++) {
		hash ^= name.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	const idx = (hash >>> 0) % SERVICE_PALETTE.length;
	return SERVICE_PALETTE[idx] ?? '#7aa2f7';
}

/**
 * Convert a nanosecond bigint to a number safely for screen math.
 * Trace durations comfortably fit; spans within those traces fit too.
 */
export function nanosToNumber(n: bigint): number {
	return Number(n);
}
