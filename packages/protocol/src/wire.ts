export type WireScalar = null | boolean | number | string;
export type WireBigInt = { readonly $bigint: string };
export type WireValue =
	| WireScalar
	| WireBigInt
	| readonly WireValue[]
	| { readonly [key: string]: WireValue };

export interface WireCodecLimits {
	readonly maxDepth?: number;
	readonly maxNodes?: number;
	readonly maxStringLength?: number;
	readonly maxJsonCharacters?: number;
}

const DEFAULT_LIMITS = {
	maxDepth: 32,
	maxNodes: 100_000,
	maxStringLength: 1_048_576,
	maxJsonCharacters: 4_194_304,
} as const;
const BIGINT_PATTERN = /^-?(0|[1-9][0-9]*)$/;

export class WireCodecError extends Error {
	readonly code: string;
	readonly path: string;

	constructor(path: string, code: string, message: string) {
		super(`${path}: ${message}`);
		this.name = 'WireCodecError';
		this.path = path;
		this.code = code;
	}
}

interface ResolvedWireCodecLimits {
	readonly maxDepth: number;
	readonly maxNodes: number;
	readonly maxStringLength: number;
	readonly maxJsonCharacters: number;
}

interface CodecState {
	readonly limits: ResolvedWireCodecLimits;
	nodes: number;
	readonly ancestors: WeakSet<object>;
}

function limits(options: WireCodecLimits): ResolvedWireCodecLimits {
	return {
		maxDepth: positiveInteger(options.maxDepth, DEFAULT_LIMITS.maxDepth, 'maxDepth'),
		maxNodes: positiveInteger(options.maxNodes, DEFAULT_LIMITS.maxNodes, 'maxNodes'),
		maxStringLength: positiveInteger(
			options.maxStringLength,
			DEFAULT_LIMITS.maxStringLength,
			'maxStringLength',
		),
		maxJsonCharacters: positiveInteger(
			options.maxJsonCharacters,
			DEFAULT_LIMITS.maxJsonCharacters,
			'maxJsonCharacters',
		),
	};
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value <= 0) {
		throw new WireCodecError('$', 'invalid_limit', `${name} must be a positive integer`);
	}
	return value;
}

function visit(state: CodecState, path: string, depth: number): void {
	state.nodes++;
	if (state.nodes > state.limits.maxNodes) {
		throw new WireCodecError(path, 'max_nodes', `exceeded ${state.limits.maxNodes} values`);
	}
	if (depth > state.limits.maxDepth) {
		throw new WireCodecError(path, 'max_depth', `exceeded depth ${state.limits.maxDepth}`);
	}
}

function checkedString(value: string, state: CodecState, path: string): string {
	if (value.length > state.limits.maxStringLength) {
		throw new WireCodecError(
			path,
			'max_string_length',
			`string exceeds ${state.limits.maxStringLength} characters`,
		);
	}
	return value;
}

function childPath(path: string, key: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key)
		? `${path}.${key}`
		: `${path}[${JSON.stringify(key)}]`;
}

function withAncestor<T>(state: CodecState, value: object, path: string, run: () => T): T {
	if (state.ancestors.has(value)) {
		throw new WireCodecError(path, 'cycle', 'cyclic values are not supported');
	}
	state.ancestors.add(value);
	try {
		return run();
	} finally {
		state.ancestors.delete(value);
	}
}

export function encodeWire(value: unknown, options: WireCodecLimits = {}): WireValue {
	const state: CodecState = { limits: limits(options), nodes: 0, ancestors: new WeakSet() };
	return encode(value, '$', 0, state);
}

function encode(value: unknown, path: string, depth: number, state: CodecState): WireValue {
	visit(state, path, depth);
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'string') return checkedString(value, state, path);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new WireCodecError(path, 'non_finite_number', 'numbers must be finite');
		}
		return value;
	}
	if (typeof value === 'bigint') return { $bigint: value.toString(10) };
	if (Array.isArray(value)) {
		return withAncestor(state, value, path, () =>
			value.map((entry, index) => encode(entry, `${path}[${index}]`, depth + 1, state)),
		);
	}
	if (typeof value !== 'object' || value === undefined) {
		throw new WireCodecError(path, 'unsupported_type', `cannot encode ${typeof value}`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new WireCodecError(path, 'unsupported_object', 'only plain objects are supported');
	}
	return withAncestor(state, value, path, () => {
		const result: Record<string, WireValue> = {};
		for (const [key, entry] of Object.entries(value)) {
			checkedString(key, state, childPath(path, key));
			define(result, key, encode(entry, childPath(path, key), depth + 1, state));
		}
		return result;
	});
}

export function decodeWire(value: unknown, options: WireCodecLimits = {}): unknown {
	const state: CodecState = { limits: limits(options), nodes: 0, ancestors: new WeakSet() };
	return decode(value, '$', 0, state);
}

function decode(value: unknown, path: string, depth: number, state: CodecState): unknown {
	visit(state, path, depth);
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'string') return checkedString(value, state, path);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new WireCodecError(path, 'non_finite_number', 'numbers must be finite');
		}
		return value;
	}
	if (Array.isArray(value)) {
		return withAncestor(state, value, path, () =>
			value.map((entry, index) => decode(entry, `${path}[${index}]`, depth + 1, state)),
		);
	}
	if (typeof value !== 'object' || value === undefined) {
		throw new WireCodecError(path, 'unsupported_type', `cannot decode ${typeof value}`);
	}
	return withAncestor(state, value, path, () => {
		const input = value as Record<string, unknown>;
		if ('$bigint' in input) {
			if (Object.keys(input).length !== 1 || typeof input.$bigint !== 'string') {
				throw new WireCodecError(path, 'invalid_bigint_tag', 'expected only a string $bigint field');
			}
			checkedString(input.$bigint, state, `${path}.$bigint`);
			if (!BIGINT_PATTERN.test(input.$bigint)) {
				throw new WireCodecError(
					`${path}.$bigint`,
					'invalid_bigint',
					'expected canonical base-10 integer text',
				);
			}
			return BigInt(input.$bigint);
		}
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(input)) {
			checkedString(key, state, childPath(path, key));
			define(result, key, decode(entry, childPath(path, key), depth + 1, state));
		}
		return result;
	});
}

function define(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

export function stringifyWire(value: unknown, options: WireCodecLimits = {}): string {
	return JSON.stringify(encodeWire(value, options));
}

export function parseWireJson(text: string, options: WireCodecLimits = {}): unknown {
	const resolved = limits(options);
	if (text.length > resolved.maxJsonCharacters) {
		throw new WireCodecError(
			'$',
			'max_json_characters',
			`JSON exceeds ${resolved.maxJsonCharacters} characters`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new WireCodecError('$', 'invalid_json', 'malformed JSON');
	}
	return decodeWire(parsed, resolved);
}
