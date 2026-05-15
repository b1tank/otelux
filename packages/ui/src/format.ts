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
 * Human "time ago" for trace cards: `just now`, `12s ago`, `4m ago`,
 * `2h ago`, `3d ago`. The `nowMs` argument is injectable so tests are
 * deterministic; defaults to `Date.now()`.
 */
export function formatTimeAgo(unixNano: bigint, nowMs: number = Date.now()): string {
	if (unixNano === 0n) {
		return '—';
	}
	const thenMs = Number(unixNano / NS_PER_MS);
	const deltaSec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
	if (deltaSec < 5) {
		return 'just now';
	}
	if (deltaSec < 60) {
		return `${deltaSec}s ago`;
	}
	const min = Math.floor(deltaSec / 60);
	if (min < 60) {
		return `${min}m ago`;
	}
	const hr = Math.floor(min / 60);
	if (hr < 24) {
		return `${hr}h ago`;
	}
	const d = Math.floor(hr / 24);
	return `${d}d ago`;
}

/**
 * The fixed service palette. Eight distinct hues that map to
 * `--otelux-svc-1..8` in tokens.css. Keep these in sync — same index in
 * both places. Exported so consumers (e.g. an inline-SVG renderer that
 * can't use CSS vars in SVG `fill` attributes reliably) can read the
 * resolved color directly.
 */
export const SERVICE_PALETTE = [
	'#7aa2f7', // svc-1 blue
	'#9ece6a', // svc-2 green
	'#e0af68', // svc-3 amber
	'#bb9af7', // svc-4 violet
	'#f7768e', // svc-5 red
	'#7dcfff', // svc-6 cyan
	'#ff9e64', // svc-7 orange
	'#73daca', // svc-8 teal
] as const;

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/**
 * Deterministic 1-based index (1..8) for a service name. Hash is FNV-1a
 * — non-cryptographic, fast, well-distributed. The same name always
 * resolves to the same slot, in this process and across processes, so
 * a service is the same color in every row, header, and dropdown.
 */
export function serviceIndex(name: string): number {
	let hash = FNV_OFFSET;
	for (let i = 0; i < name.length; i++) {
		hash ^= name.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME);
	}
	return ((hash >>> 0) % SERVICE_PALETTE.length) + 1;
}

/** Deterministic color hex for a service name. Backed by `serviceIndex`. */
export function colorForService(name: string): string {
	const palette = SERVICE_PALETTE;
	const color = palette[serviceIndex(name) - 1];
	// serviceIndex always returns 1..palette.length, so this is total.
	return color ?? palette[0];
}

/**
 * The CSS variable name for a service's palette slot, e.g.
 * `var(--otelux-svc-3)`. Use this in inline `style` so the rendered
 * color follows the active theme (dark/light) without re-running the
 * hash on theme change.
 */
export function serviceColorVar(name: string): string {
	return `var(--otelux-svc-${serviceIndex(name)})`;
}

/**
 * Convert a nanosecond bigint to a number safely for screen math.
 * Trace durations comfortably fit; spans within those traces fit too.
 */
export function nanosToNumber(n: bigint): number {
	return Number(n);
}
