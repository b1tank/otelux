/**
 * OTLP/HTTP JSON decoder.
 *
 * The OTLP protobuf JSON encoding for traces is documented at
 * https://opentelemetry.io/docs/specs/otlp/#protobuf-payload — fields use
 * camelCase, fixed64 values are sent as JSON strings to preserve range,
 * and attribute values are wrapped in `AnyValue` envelopes
 * (`{ stringValue: ... } | { intValue: "42" } | { boolValue: ... }` etc).
 *
 * We accept the JSON shape that OpenTelemetry SDKs (Node, Python, Go, …)
 * actually emit and normalize it to our internal Span model. Any field
 * we cannot decode is dropped silently — receivers must be lenient.
 *
 * Example body (truncated):
 *   {
 *     "resourceSpans": [{
 *       "resource": { "attributes": [{ "key": "service.name",
 *                                       "value": { "stringValue": "api" } }] },
 *       "scopeSpans": [{
 *         "scope": { "name": "http" },
 *         "spans": [{
 *           "traceId": "abcdef…", "spanId": "1111…",
 *           "name": "GET /", "kind": 1,
 *           "startTimeUnixNano": "1700000000000000000",
 *           "endTimeUnixNano":   "1700000000045000000",
 *           "status": { "code": 1 },
 *           "attributes": [{ "key": "http.method",
 *                            "value": { "stringValue": "GET" } }]
 *         }]
 *       }]
 *     }]
 *   }
 */

import type {
	AttributeMap,
	AttributeValue,
	InstrumentationScope,
	Resource,
	Span,
	SpanEvent,
	SpanKind,
	SpanLink,
	SpanStatus,
} from '@otelux/types';

interface OtlpAnyValue {
	stringValue?: string;
	intValue?: string | number;
	doubleValue?: number;
	boolValue?: boolean;
	arrayValue?: { values?: OtlpAnyValue[] };
}

interface OtlpAttribute {
	key?: string;
	value?: OtlpAnyValue;
}

interface OtlpResource {
	attributes?: OtlpAttribute[];
	droppedAttributesCount?: number;
}

interface OtlpScope {
	name?: string;
	version?: string;
	attributes?: OtlpAttribute[];
}

interface OtlpEvent {
	timeUnixNano?: string;
	name?: string;
	attributes?: OtlpAttribute[];
	droppedAttributesCount?: number;
}

interface OtlpLink {
	traceId?: string;
	spanId?: string;
	traceState?: string;
	attributes?: OtlpAttribute[];
	droppedAttributesCount?: number;
}

interface OtlpStatus {
	code?: number;
	message?: string;
}

interface OtlpSpan {
	traceId?: string;
	spanId?: string;
	parentSpanId?: string;
	traceState?: string;
	name?: string;
	kind?: number;
	startTimeUnixNano?: string;
	endTimeUnixNano?: string;
	attributes?: OtlpAttribute[];
	events?: OtlpEvent[];
	links?: OtlpLink[];
	status?: OtlpStatus;
	droppedAttributesCount?: number;
	droppedEventsCount?: number;
	droppedLinksCount?: number;
}

interface OtlpScopeSpans {
	scope?: OtlpScope;
	spans?: OtlpSpan[];
}

interface OtlpResourceSpans {
	resource?: OtlpResource;
	scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpExportTraceServiceRequest {
	resourceSpans?: OtlpResourceSpans[];
}

function decodeAnyValue(v: OtlpAnyValue | undefined): AttributeValue | undefined {
	if (!v) {
		return undefined;
	}
	if (typeof v.stringValue === 'string') {
		return v.stringValue;
	}
	if (v.intValue !== undefined) {
		// OTLP sends int64 as a JSON string to preserve range; some SDKs
		// emit it as a number. Either is valid per the spec.
		return typeof v.intValue === 'string' ? BigInt(v.intValue) : v.intValue;
	}
	if (typeof v.doubleValue === 'number') {
		return v.doubleValue;
	}
	if (typeof v.boolValue === 'boolean') {
		return v.boolValue;
	}
	if (v.arrayValue?.values) {
		const decoded: AttributeValue[] = [];
		for (const item of v.arrayValue.values) {
			const d = decodeAnyValue(item);
			if (d !== undefined) {
				decoded.push(d);
			}
		}
		// AttributeValue arrays must be homogeneous per OTLP — preserve the
		// first non-empty element's type. If mixed, return as string array.
		if (decoded.length === 0) {
			return [] as readonly string[];
		}
		const first = decoded[0];
		if (typeof first === 'string') {
			return decoded.filter((d): d is string => typeof d === 'string');
		}
		if (typeof first === 'number') {
			return decoded.filter((d): d is number => typeof d === 'number');
		}
		if (typeof first === 'bigint') {
			return decoded.filter((d): d is bigint => typeof d === 'bigint');
		}
		if (typeof first === 'boolean') {
			return decoded.filter((d): d is boolean => typeof d === 'boolean');
		}
	}
	return undefined;
}

function decodeAttributes(attrs: OtlpAttribute[] | undefined): AttributeMap {
	const out: Record<string, AttributeValue> = {};
	if (!attrs) {
		return out;
	}
	for (const a of attrs) {
		if (!a.key) {
			continue;
		}
		const decoded = decodeAnyValue(a.value);
		if (decoded !== undefined) {
			out[a.key] = decoded;
		}
	}
	return out;
}

function decodeResource(r: OtlpResource | undefined): Resource {
	return {
		attributes: decodeAttributes(r?.attributes),
		...(r?.droppedAttributesCount !== undefined
			? { droppedAttributesCount: r.droppedAttributesCount }
			: {}),
	};
}

function decodeScope(s: OtlpScope | undefined): InstrumentationScope {
	return {
		name: s?.name ?? '',
		...(s?.version ? { version: s.version } : {}),
		...(s?.attributes ? { attributes: decodeAttributes(s.attributes) } : {}),
	};
}

function decodeStatus(s: OtlpStatus | undefined): SpanStatus {
	const code = s?.code === 1 || s?.code === 2 ? s.code : 0;
	return {
		code: code as 0 | 1 | 2,
		...(s?.message ? { message: s.message } : {}),
	};
}

function decodeEvent(e: OtlpEvent): SpanEvent {
	return {
		timeUnixNano: BigInt(e.timeUnixNano ?? '0'),
		name: e.name ?? '',
		attributes: decodeAttributes(e.attributes),
		...(e.droppedAttributesCount !== undefined
			? { droppedAttributesCount: e.droppedAttributesCount }
			: {}),
	};
}

function decodeLink(l: OtlpLink): SpanLink {
	return {
		traceId: l.traceId ?? '',
		spanId: l.spanId ?? '',
		attributes: decodeAttributes(l.attributes),
		...(l.traceState ? { traceState: l.traceState } : {}),
		...(l.droppedAttributesCount !== undefined
			? { droppedAttributesCount: l.droppedAttributesCount }
			: {}),
	};
}

/**
 * Decode an OTLP/HTTP JSON `ExportTraceServiceRequest` into our internal
 * Span model. Drops spans missing required identifiers — those would
 * never survive a join anyway.
 */
export function decodeExportTraceServiceRequest(payload: OtlpExportTraceServiceRequest): Span[] {
	const spans: Span[] = [];
	for (const rs of payload.resourceSpans ?? []) {
		const resource = decodeResource(rs.resource);
		for (const ss of rs.scopeSpans ?? []) {
			const scope = decodeScope(ss.scope);
			for (const s of ss.spans ?? []) {
				if (!s.traceId || !s.spanId || !s.startTimeUnixNano || !s.endTimeUnixNano) {
					continue;
				}
				const kind = (s.kind ?? 0) as SpanKind;
				const span: Span = {
					traceId: s.traceId,
					spanId: s.spanId,
					name: s.name ?? '',
					kind,
					startTimeUnixNano: BigInt(s.startTimeUnixNano),
					endTimeUnixNano: BigInt(s.endTimeUnixNano),
					status: decodeStatus(s.status),
					attributes: decodeAttributes(s.attributes),
					resource,
					scope,
					...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
					...(s.traceState ? { traceState: s.traceState } : {}),
					...(s.events && s.events.length > 0 ? { events: s.events.map(decodeEvent) } : {}),
					...(s.links && s.links.length > 0 ? { links: s.links.map(decodeLink) } : {}),
					...(s.droppedAttributesCount !== undefined
						? { droppedAttributesCount: s.droppedAttributesCount }
						: {}),
					...(s.droppedEventsCount !== undefined ? { droppedEventsCount: s.droppedEventsCount } : {}),
					...(s.droppedLinksCount !== undefined ? { droppedLinksCount: s.droppedLinksCount } : {}),
				};
				spans.push(span);
			}
		}
	}
	return spans;
}
