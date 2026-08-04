import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WireCodecError, decodeWire, encodeWire, parseWireJson, stringifyWire } from './index.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'wire');
const fixture = (name: string): string => readFileSync(join(fixtureDirectory, name), 'utf8');

describe('wire codec', () => {
	it('round-trips nested bigint values without confusing strings', () => {
		const value = {
			timestamp: 1_700_000_000_000_000_000n,
			attribute: '1700000000000000000',
			array: [1n, -2n, 3.5, true, null],
		};
		const encoded = encodeWire(value);
		expect(encoded).toEqual({
			timestamp: { $bigint: '1700000000000000000' },
			attribute: '1700000000000000000',
			array: [{ $bigint: '1' }, { $bigint: '-2' }, 3.5, true, null],
		});
		expect(decodeWire(encoded)).toEqual(value);
		expect(parseWireJson(stringifyWire(value))).toEqual(value);
	});

	it('decodes old fixtures and tolerates compatible ordinary future fields', () => {
		const old = parseWireJson(fixture('v1-old.json')) as Record<string, unknown>;
		const future = parseWireJson(fixture('v1-compatible-future.json')) as Record<string, unknown>;
		expect(old.startTimeUnixNano).toBe(1_700_000_000_000_000_000n);
		expect(future.startTimeUnixNano).toBe(old.startTimeUnixNano);
		expect(future.futureMetadata).toEqual({ producer: 'fixture', revision: 2 });
	});

	it('rejects malformed and non-canonical bigint tags', () => {
		expect(() => parseWireJson(fixture('v1-malformed-bigint.json'))).toThrow(
			'expected only a string $bigint field',
		);
		expect(() => decodeWire({ $bigint: '01' })).toThrow('expected canonical base-10 integer text');
		expect(() => decodeWire({ $bigint: '+1' })).toThrow('expected canonical base-10 integer text');
	});

	it('rejects non-finite numbers, unsupported objects, values, and cycles', () => {
		expect(() => encodeWire(Number.NaN)).toThrow('numbers must be finite');
		expect(() => encodeWire(Number.POSITIVE_INFINITY)).toThrow('numbers must be finite');
		expect(() => encodeWire(new Date())).toThrow('only plain objects are supported');
		expect(() => encodeWire(undefined)).toThrow('cannot encode undefined');
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		expect(() => encodeWire(cyclic)).toThrow('cyclic values are not supported');
	});

	it('enforces depth, node, string, and JSON character budgets', () => {
		expect(() => encodeWire({ a: { b: 1 } }, { maxDepth: 1 })).toThrow('exceeded depth 1');
		expect(() => encodeWire([1, 2, 3], { maxNodes: 3 })).toThrow('exceeded 3 values');
		expect(() => encodeWire('abcd', { maxStringLength: 3 })).toThrow('string exceeds 3 characters');
		expect(() => parseWireJson('{"a":1}', { maxJsonCharacters: 6 })).toThrow(
			'JSON exceeds 6 characters',
		);
	});

	it('reports malformed JSON with a stable error code and path', () => {
		try {
			parseWireJson('{');
		} catch (error) {
			expect(error).toBeInstanceOf(WireCodecError);
			expect(error).toMatchObject({ code: 'invalid_json', path: '$' });
			return;
		}
		throw new Error('expected malformed JSON to fail');
	});

	it('preserves potentially special JSON keys as own data properties', () => {
		const decoded = decodeWire(JSON.parse('{"__proto__":{"polluted":true}}')) as Record<
			string,
			unknown
		>;
		expect(Object.hasOwn(decoded, '__proto__')).toBe(true);
		expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
	});
});
