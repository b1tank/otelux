import type { AttributeMap, AttributeValue } from '@otelux/types';

/**
 * JSON codec for OTLP attribute values.
 *
 * OTLP attributes are fully general (string, number, bool, int64, and
 * homogeneous arrays of those) — OTelux does not constrain them to any
 * semantic convention, so the store keeps them as JSON blobs rather than
 * exploding them into typed columns. Two wrinkles force a custom codec
 * instead of a bare `JSON.stringify`:
 *
 *  1. int64 attributes arrive as `bigint`, which `JSON.stringify` throws on.
 *  2. We must round-trip that `bigint` back out precisely (a `1e18` request
 *     id must not silently become a lossy double on read).
 *
 * bigints are therefore encoded as a tagged object `{ "$bigint": "123" }`
 * and restored by the reviver. The `$bigint` key cannot collide with a real
 * attribute because the map is keyed by attribute *name*, and this tag only
 * ever appears as a *value*; a user attribute value that is itself an object
 * is not representable in the OTLP attribute model, so any object we see on
 * read is one we wrote.
 */

const BIGINT_TAG = '$bigint';

interface TaggedBigInt {
	[BIGINT_TAG]: string;
}

function isTaggedBigInt(value: unknown): value is TaggedBigInt {
	return (
		typeof value === 'object' &&
		value !== null &&
		BIGINT_TAG in value &&
		typeof (value as Record<string, unknown>)[BIGINT_TAG] === 'string'
	);
}

/** Serialize an attribute map to a JSON string, encoding bigints losslessly. */
export function encodeAttributes(attributes: AttributeMap): string {
	return JSON.stringify(attributes, (_key, value) =>
		typeof value === 'bigint' ? { [BIGINT_TAG]: value.toString() } : value,
	);
}

/**
 * Parse an attribute map written by {@link encodeAttributes}. Returns an
 * empty map for `null`/empty input so callers never have to null-check.
 */
export function decodeAttributes(json: string | null | undefined): AttributeMap {
	if (json === null || json === undefined || json === '') {
		return {};
	}
	const parsed = JSON.parse(json, (_key, value) =>
		isTaggedBigInt(value) ? BigInt(value[BIGINT_TAG]) : value,
	);
	return parsed as AttributeMap;
}

/** Serialize an arbitrary body/AnyValue, or `null` when absent. */
export function encodeOptionalValue(value: AttributeValue | undefined): string | null {
	if (value === undefined) {
		return null;
	}
	return JSON.stringify(value, (_key, v) =>
		typeof v === 'bigint' ? { [BIGINT_TAG]: v.toString() } : v,
	);
}

/** Parse a value written by {@link encodeOptionalValue}. */
export function decodeOptionalValue(json: string | null | undefined): AttributeValue | undefined {
	if (json === null || json === undefined || json === '') {
		return undefined;
	}
	return JSON.parse(json, (_key, value) =>
		isTaggedBigInt(value) ? BigInt(value[BIGINT_TAG]) : value,
	) as AttributeValue;
}

/** Encode any JSON-serializable value (arrays of primitives) for storage. */
export function encodeJson(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		typeof v === 'bigint' ? { [BIGINT_TAG]: v.toString() } : v,
	);
}

/** Decode a value written by {@link encodeJson}. */
export function decodeJson<T>(json: string | null | undefined, fallback: T): T {
	if (json === null || json === undefined || json === '') {
		return fallback;
	}
	return JSON.parse(json, (_key, value) =>
		isTaggedBigInt(value) ? BigInt(value[BIGINT_TAG]) : value,
	) as T;
}

/**
 * Flatten an attribute value to a lowercase plain string for the log
 * search index. Mirrors the memory backend's free-text semantics, which
 * matches attribute *values* (and keys, appended by the caller) as
 * substrings — the Codex workload carries prompt/tool content in
 * attributes, not the log body.
 */
export function attributeValueToSearchText(value: AttributeValue): string {
	if (Array.isArray(value)) {
		return value.map((v) => String(v)).join(' ');
	}
	return String(value as string | number | bigint | boolean);
}
