/**
 * OTLP/HTTP protobuf decoder.
 *
 * OTelux accepts the OTLP protobuf encoding (`Content-Type:
 * application/x-protobuf`) in addition to JSON — it is the default wire format
 * for most OpenTelemetry SDK exporters, so refusing it turns away real senders.
 *
 * Rather than pull in a protobuf runtime or generated code, this module decodes
 * the wire format directly into the same intermediate `Otlp*ServiceRequest`
 * objects the JSON decoder in `otlp.ts` produces, then hands them to the shared
 * `decodeExport*ServiceRequest` functions. That keeps the OTLP→internal mapping
 * (attributes, enums, lenient handling) in one place.
 *
 * Two representation differences between the encodings are normalized here so
 * the JSON decoders see a uniform shape:
 *  - IDs (`trace_id`, `span_id`) are raw `bytes` on the wire; JSON carries them
 *    as hex strings, so we hex-encode.
 *  - 64-bit timestamps/counts are `fixed64`/`sfixed64`; JSON carries them as
 *    decimal strings, so we stringify the decoded BigInt.
 *
 * Field numbers follow the OTLP proto definitions:
 *   https://github.com/open-telemetry/opentelemetry-proto/tree/main/opentelemetry/proto
 *
 * Unknown fields are skipped so newer producers never break an older receiver.
 */

import type {
	OtlpAnyValue,
	OtlpAttribute,
	OtlpExportTraceServiceRequest,
	OtlpResource,
	OtlpScope,
} from './otlp.js';
import type { OtlpExportLogsServiceRequest } from './otlpLogs.js';
import type { OtlpExportMetricsServiceRequest } from './otlpMetrics.js';

// Protobuf wire types (https://protobuf.dev/programming-guides/encoding/#structure).
const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

const textDecoder = new TextDecoder();

/**
 * Minimal protobuf field reader over a byte buffer. Reads only the wire-level
 * primitives OTLP uses; higher-level message structure is walked by the
 * per-message functions below.
 */
class ProtoReader {
	private pos = 0;
	private readonly view: DataView;

	constructor(private readonly buf: Uint8Array) {
		this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	}

	get eof(): boolean {
		return this.pos >= this.buf.length;
	}

	/** Read a base-128 varint as an unsigned 64-bit BigInt. */
	readVarint(): bigint {
		let result = 0n;
		let shift = 0n;
		// A 64-bit varint is at most 10 bytes.
		for (let i = 0; i < 10; i++) {
			const byte = this.buf[this.pos++];
			if (byte === undefined) {
				throw new Error('protobuf: truncated varint');
			}
			result |= BigInt(byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) {
				return result;
			}
			shift += 7n;
		}
		throw new Error('protobuf: varint exceeds 10 bytes');
	}

	/** Read a field tag, returning its field number and wire type. */
	readTag(): { field: number; wire: number } {
		const tag = this.readVarint();
		return { field: Number(tag >> 3n), wire: Number(tag & 0x7n) };
	}

	/** Read a length-delimited chunk (string/bytes/embedded message). */
	readLengthDelimited(): Uint8Array {
		const len = Number(this.readVarint());
		const start = this.pos;
		const end = start + len;
		if (end > this.buf.length) {
			throw new Error('protobuf: length-delimited field overruns buffer');
		}
		this.pos = end;
		return this.buf.subarray(start, end);
	}

	readString(): string {
		return textDecoder.decode(this.readLengthDelimited());
	}

	/** Unsigned 64-bit little-endian (fixed64). */
	readFixed64(): bigint {
		const lo = BigInt(this.view.getUint32(this.pos, true));
		const hi = BigInt(this.view.getUint32(this.pos + 4, true));
		this.pos += 8;
		return (hi << 32n) | lo;
	}

	readDouble(): number {
		const v = this.view.getFloat64(this.pos, true);
		this.pos += 8;
		return v;
	}

	readFixed32(): number {
		const v = this.view.getUint32(this.pos, true);
		this.pos += 4;
		return v;
	}

	/** Advance past a field of the given wire type without decoding it. */
	skip(wire: number): void {
		switch (wire) {
			case WIRE_VARINT:
				this.readVarint();
				break;
			case WIRE_FIXED64:
				this.pos += 8;
				break;
			case WIRE_LEN:
				this.readLengthDelimited();
				break;
			case WIRE_FIXED32:
				this.pos += 4;
				break;
			default:
				throw new Error(`protobuf: unsupported wire type ${wire}`);
		}
	}
}

function bytesToHex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) {
		out += b.toString(16).padStart(2, '0');
	}
	return out;
}

// opentelemetry.proto.common.v1.AnyValue
function readAnyValue(bytes: Uint8Array): OtlpAnyValue {
	const out: OtlpAnyValue = {};
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1: // string_value
				out.stringValue = r.readString();
				break;
			case 2: // bool_value
				out.boolValue = r.readVarint() !== 0n;
				break;
			case 3: // int_value (int64, two's-complement varint)
				out.intValue = BigInt.asIntN(64, r.readVarint()).toString();
				break;
			case 4: // double_value
				out.doubleValue = r.readDouble();
				break;
			case 5: // array_value
				out.arrayValue = readArrayValue(r.readLengthDelimited());
				break;
			// 6 kvlist_value and 7 bytes_value are not modelled by decodeAnyValue.
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.common.v1.ArrayValue
function readArrayValue(bytes: Uint8Array): { values: OtlpAnyValue[] } {
	const values: OtlpAnyValue[] = [];
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		if (field === 1 && wire === WIRE_LEN) {
			values.push(readAnyValue(r.readLengthDelimited()));
		} else {
			r.skip(wire);
		}
	}
	return { values };
}

// opentelemetry.proto.common.v1.KeyValue
function readKeyValue(bytes: Uint8Array): OtlpAttribute {
	const out: OtlpAttribute = {};
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				out.key = r.readString();
				break;
			case 2:
				out.value = readAnyValue(r.readLengthDelimited());
				break;
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.resource.v1.Resource
function readResource(bytes: Uint8Array): OtlpResource {
	const attributes: OtlpAttribute[] = [];
	const out: OtlpResource = { attributes };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				attributes.push(readKeyValue(r.readLengthDelimited()));
				break;
			case 2:
				out.droppedAttributesCount = Number(r.readVarint());
				break;
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.common.v1.InstrumentationScope
function readScope(bytes: Uint8Array): OtlpScope {
	const attributes: OtlpAttribute[] = [];
	const out: OtlpScope = {};
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				out.name = r.readString();
				break;
			case 2:
				out.version = r.readString();
				break;
			case 3:
				attributes.push(readKeyValue(r.readLengthDelimited()));
				break;
			// 4 dropped_attributes_count is not carried on OtlpScope.
			default:
				r.skip(wire);
		}
	}
	if (attributes.length > 0) {
		out.attributes = attributes;
	}
	return out;
}

interface WireSpan {
	traceId?: string;
	spanId?: string;
	parentSpanId?: string;
	traceState?: string;
	name?: string;
	kind?: number;
	startTimeUnixNano?: string;
	endTimeUnixNano?: string;
	attributes?: OtlpAttribute[];
	events?: WireSpanEvent[];
	links?: WireSpanLink[];
	status?: { code?: number; message?: string };
	droppedAttributesCount?: number;
	droppedEventsCount?: number;
	droppedLinksCount?: number;
}

interface WireSpanEvent {
	timeUnixNano?: string;
	name?: string;
	attributes?: OtlpAttribute[];
	droppedAttributesCount?: number;
}

interface WireSpanLink {
	traceId?: string;
	spanId?: string;
	traceState?: string;
	attributes?: OtlpAttribute[];
	droppedAttributesCount?: number;
}

// opentelemetry.proto.trace.v1.Status
function readStatus(bytes: Uint8Array): { code?: number; message?: string } {
	const out: { code?: number; message?: string } = {};
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 2:
				out.message = r.readString();
				break;
			case 3:
				out.code = Number(r.readVarint());
				break;
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.trace.v1.Span.Event
function readSpanEvent(bytes: Uint8Array): WireSpanEvent {
	const attributes: OtlpAttribute[] = [];
	const out: WireSpanEvent = { attributes };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				out.timeUnixNano = r.readFixed64().toString();
				break;
			case 2:
				out.name = r.readString();
				break;
			case 3:
				attributes.push(readKeyValue(r.readLengthDelimited()));
				break;
			case 4:
				out.droppedAttributesCount = Number(r.readVarint());
				break;
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.trace.v1.Span.Link
function readSpanLink(bytes: Uint8Array): WireSpanLink {
	const attributes: OtlpAttribute[] = [];
	const out: WireSpanLink = { attributes };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				out.traceId = bytesToHex(r.readLengthDelimited());
				break;
			case 2:
				out.spanId = bytesToHex(r.readLengthDelimited());
				break;
			case 3:
				out.traceState = r.readString();
				break;
			case 4:
				attributes.push(readKeyValue(r.readLengthDelimited()));
				break;
			case 5:
				out.droppedAttributesCount = Number(r.readVarint());
				break;
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.trace.v1.Span
function readSpan(bytes: Uint8Array): WireSpan {
	const attributes: OtlpAttribute[] = [];
	const events: WireSpanEvent[] = [];
	const links: WireSpanLink[] = [];
	const out: WireSpan = { attributes, events, links };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				out.traceId = bytesToHex(r.readLengthDelimited());
				break;
			case 2:
				out.spanId = bytesToHex(r.readLengthDelimited());
				break;
			case 3:
				out.traceState = r.readString();
				break;
			case 4:
				out.parentSpanId = bytesToHex(r.readLengthDelimited());
				break;
			case 5:
				out.name = r.readString();
				break;
			case 6:
				out.kind = Number(r.readVarint());
				break;
			case 7:
				out.startTimeUnixNano = r.readFixed64().toString();
				break;
			case 8:
				out.endTimeUnixNano = r.readFixed64().toString();
				break;
			case 9:
				attributes.push(readKeyValue(r.readLengthDelimited()));
				break;
			case 10:
				out.droppedAttributesCount = Number(r.readVarint());
				break;
			case 11:
				events.push(readSpanEvent(r.readLengthDelimited()));
				break;
			case 12:
				out.droppedEventsCount = Number(r.readVarint());
				break;
			case 13:
				links.push(readSpanLink(r.readLengthDelimited()));
				break;
			case 14:
				out.droppedLinksCount = Number(r.readVarint());
				break;
			case 15:
				out.status = readStatus(r.readLengthDelimited());
				break;
			// 16 flags is not carried on our Span model.
			default:
				r.skip(wire);
		}
	}
	return out;
}

/** Decode an OTLP protobuf `ExportTraceServiceRequest` into the JSON shape. */
export function decodeTraceRequestFromProtobuf(bytes: Uint8Array): OtlpExportTraceServiceRequest {
	const resourceSpans: NonNullable<OtlpExportTraceServiceRequest['resourceSpans']> = [];
	const top = new ProtoReader(bytes);
	while (!top.eof) {
		const { field, wire } = top.readTag();
		if (field === 1 && wire === WIRE_LEN) {
			resourceSpans.push(readResourceSpans(top.readLengthDelimited()));
		} else {
			top.skip(wire);
		}
	}
	return { resourceSpans };
}

function readResourceSpans(
	bytes: Uint8Array,
): NonNullable<OtlpExportTraceServiceRequest['resourceSpans']>[number] {
	const scopeSpans: Array<{ scope?: OtlpScope; spans?: WireSpan[] }> = [];
	let resource: OtlpResource | undefined;
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				resource = readResource(r.readLengthDelimited());
				break;
			case 2:
				scopeSpans.push(readScopeSpans(r.readLengthDelimited()));
				break;
			default:
				r.skip(wire);
		}
	}
	return { ...(resource ? { resource } : {}), scopeSpans };
}

function readScopeSpans(bytes: Uint8Array): { scope?: OtlpScope; spans?: WireSpan[] } {
	const spans: WireSpan[] = [];
	let scope: OtlpScope | undefined;
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				scope = readScope(r.readLengthDelimited());
				break;
			case 2:
				spans.push(readSpan(r.readLengthDelimited()));
				break;
			default:
				r.skip(wire);
		}
	}
	return { ...(scope ? { scope } : {}), spans };
}

interface WireLogRecord {
	timeUnixNano?: string;
	observedTimeUnixNano?: string;
	severityNumber?: number;
	severityText?: string;
	eventName?: string;
	body?: OtlpAnyValue;
	attributes?: OtlpAttribute[];
	droppedAttributesCount?: number;
	flags?: number;
	traceId?: string;
	spanId?: string;
}

// opentelemetry.proto.logs.v1.LogRecord
function readLogRecord(bytes: Uint8Array): WireLogRecord {
	const attributes: OtlpAttribute[] = [];
	const out: WireLogRecord = { attributes };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				out.timeUnixNano = r.readFixed64().toString();
				break;
			case 2:
				out.severityNumber = Number(r.readVarint());
				break;
			case 3:
				out.severityText = r.readString();
				break;
			case 5:
				out.body = readAnyValue(r.readLengthDelimited());
				break;
			case 6:
				attributes.push(readKeyValue(r.readLengthDelimited()));
				break;
			case 7:
				out.droppedAttributesCount = Number(r.readVarint());
				break;
			case 8: // flags (fixed32)
				out.flags = r.readFixed32();
				break;
			case 9:
				out.traceId = bytesToHex(r.readLengthDelimited());
				break;
			case 10:
				out.spanId = bytesToHex(r.readLengthDelimited());
				break;
			case 11:
				out.observedTimeUnixNano = r.readFixed64().toString();
				break;
			case 12:
				out.eventName = r.readString();
				break;
			default:
				r.skip(wire);
		}
	}
	return out;
}

/** Decode an OTLP protobuf `ExportLogsServiceRequest` into the JSON shape. */
export function decodeLogsRequestFromProtobuf(bytes: Uint8Array): OtlpExportLogsServiceRequest {
	const resourceLogs: NonNullable<OtlpExportLogsServiceRequest['resourceLogs']> = [];
	const top = new ProtoReader(bytes);
	while (!top.eof) {
		const { field, wire } = top.readTag();
		if (field === 1 && wire === WIRE_LEN) {
			resourceLogs.push(readResourceLogs(top.readLengthDelimited()));
		} else {
			top.skip(wire);
		}
	}
	return { resourceLogs };
}

function readResourceLogs(
	bytes: Uint8Array,
): NonNullable<OtlpExportLogsServiceRequest['resourceLogs']>[number] {
	const scopeLogs: Array<{ scope?: OtlpScope; logRecords?: WireLogRecord[] }> = [];
	let resource: OtlpResource | undefined;
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				resource = readResource(r.readLengthDelimited());
				break;
			case 2:
				scopeLogs.push(readScopeLogs(r.readLengthDelimited()));
				break;
			default:
				r.skip(wire);
		}
	}
	return { ...(resource ? { resource } : {}), scopeLogs };
}

function readScopeLogs(bytes: Uint8Array): { scope?: OtlpScope; logRecords?: WireLogRecord[] } {
	const logRecords: WireLogRecord[] = [];
	let scope: OtlpScope | undefined;
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				scope = readScope(r.readLengthDelimited());
				break;
			case 2:
				logRecords.push(readLogRecord(r.readLengthDelimited()));
				break;
			default:
				r.skip(wire);
		}
	}
	return { ...(scope ? { scope } : {}), logRecords };
}

interface WireNumberDataPoint {
	startTimeUnixNano?: string;
	timeUnixNano?: string;
	asInt?: string;
	asDouble?: number;
	attributes?: OtlpAttribute[];
	flags?: number;
}

interface WireHistogramDataPoint {
	startTimeUnixNano?: string;
	timeUnixNano?: string;
	count?: string;
	sum?: number;
	min?: number;
	max?: number;
	bucketCounts?: string[];
	explicitBounds?: number[];
	attributes?: OtlpAttribute[];
	flags?: number;
}

// opentelemetry.proto.metrics.v1.NumberDataPoint
function readNumberDataPoint(bytes: Uint8Array): WireNumberDataPoint {
	const attributes: OtlpAttribute[] = [];
	const out: WireNumberDataPoint = { attributes };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 2:
				out.startTimeUnixNano = r.readFixed64().toString();
				break;
			case 3:
				out.timeUnixNano = r.readFixed64().toString();
				break;
			case 4: // as_double (double, oneof value)
				out.asDouble = r.readDouble();
				break;
			case 6: // as_int (sfixed64, oneof value)
				out.asInt = BigInt.asIntN(64, r.readFixed64()).toString();
				break;
			case 7:
				attributes.push(readKeyValue(r.readLengthDelimited()));
				break;
			case 8:
				out.flags = Number(r.readVarint());
				break;
			// 5 exemplars — skipped.
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.metrics.v1.HistogramDataPoint
function readHistogramDataPoint(bytes: Uint8Array): WireHistogramDataPoint {
	const attributes: OtlpAttribute[] = [];
	const bucketCounts: string[] = [];
	const explicitBounds: number[] = [];
	const out: WireHistogramDataPoint = { attributes };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 2:
				out.startTimeUnixNano = r.readFixed64().toString();
				break;
			case 3:
				out.timeUnixNano = r.readFixed64().toString();
				break;
			case 4: // count (fixed64)
				out.count = r.readFixed64().toString();
				break;
			case 5: // sum (double, optional)
				out.sum = r.readDouble();
				break;
			case 6: // bucket_counts (repeated fixed64: packed or unpacked)
				if (wire === WIRE_LEN) {
					const packed = new ProtoReader(r.readLengthDelimited());
					while (!packed.eof) {
						bucketCounts.push(packed.readFixed64().toString());
					}
				} else {
					bucketCounts.push(r.readFixed64().toString());
				}
				break;
			case 7: // explicit_bounds (repeated double: packed or unpacked)
				if (wire === WIRE_LEN) {
					const packed = new ProtoReader(r.readLengthDelimited());
					while (!packed.eof) {
						explicitBounds.push(packed.readDouble());
					}
				} else {
					explicitBounds.push(r.readDouble());
				}
				break;
			case 9:
				attributes.push(readKeyValue(r.readLengthDelimited()));
				break;
			case 10:
				out.flags = Number(r.readVarint());
				break;
			case 11: // min (double, optional)
				out.min = r.readDouble();
				break;
			case 12: // max (double, optional)
				out.max = r.readDouble();
				break;
			// 8 exemplars — skipped.
			default:
				r.skip(wire);
		}
	}
	if (bucketCounts.length > 0) {
		out.bucketCounts = bucketCounts;
	}
	if (explicitBounds.length > 0) {
		out.explicitBounds = explicitBounds;
	}
	return out;
}

interface WireMetric {
	name?: string;
	description?: string;
	unit?: string;
	sum?: {
		dataPoints?: WireNumberDataPoint[];
		aggregationTemporality?: number;
		isMonotonic?: boolean;
	};
	gauge?: { dataPoints?: WireNumberDataPoint[] };
	histogram?: { dataPoints?: WireHistogramDataPoint[]; aggregationTemporality?: number };
}

// opentelemetry.proto.metrics.v1.Sum
function readSum(bytes: Uint8Array): NonNullable<WireMetric['sum']> {
	const dataPoints: WireNumberDataPoint[] = [];
	const out: NonNullable<WireMetric['sum']> = { dataPoints };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				dataPoints.push(readNumberDataPoint(r.readLengthDelimited()));
				break;
			case 2:
				out.aggregationTemporality = Number(r.readVarint());
				break;
			case 3:
				out.isMonotonic = r.readVarint() !== 0n;
				break;
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.metrics.v1.Gauge
function readGauge(bytes: Uint8Array): NonNullable<WireMetric['gauge']> {
	const dataPoints: WireNumberDataPoint[] = [];
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		if (field === 1 && wire === WIRE_LEN) {
			dataPoints.push(readNumberDataPoint(r.readLengthDelimited()));
		} else {
			r.skip(wire);
		}
	}
	return { dataPoints };
}

// opentelemetry.proto.metrics.v1.Histogram
function readHistogram(bytes: Uint8Array): NonNullable<WireMetric['histogram']> {
	const dataPoints: WireHistogramDataPoint[] = [];
	const out: NonNullable<WireMetric['histogram']> = { dataPoints };
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				dataPoints.push(readHistogramDataPoint(r.readLengthDelimited()));
				break;
			case 2:
				out.aggregationTemporality = Number(r.readVarint());
				break;
			default:
				r.skip(wire);
		}
	}
	return out;
}

// opentelemetry.proto.metrics.v1.Metric
function readMetric(bytes: Uint8Array): WireMetric {
	const out: WireMetric = {};
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				out.name = r.readString();
				break;
			case 2:
				out.description = r.readString();
				break;
			case 3:
				out.unit = r.readString();
				break;
			case 5:
				out.gauge = readGauge(r.readLengthDelimited());
				break;
			case 7:
				out.sum = readSum(r.readLengthDelimited());
				break;
			case 9:
				out.histogram = readHistogram(r.readLengthDelimited());
				break;
			// 10 exponential_histogram, 11 summary, 12 metadata — skipped.
			default:
				r.skip(wire);
		}
	}
	return out;
}

/** Decode an OTLP protobuf `ExportMetricsServiceRequest` into the JSON shape. */
export function decodeMetricsRequestFromProtobuf(
	bytes: Uint8Array,
): OtlpExportMetricsServiceRequest {
	const resourceMetrics: NonNullable<OtlpExportMetricsServiceRequest['resourceMetrics']> = [];
	const top = new ProtoReader(bytes);
	while (!top.eof) {
		const { field, wire } = top.readTag();
		if (field === 1 && wire === WIRE_LEN) {
			resourceMetrics.push(readResourceMetrics(top.readLengthDelimited()));
		} else {
			top.skip(wire);
		}
	}
	return { resourceMetrics };
}

function readResourceMetrics(
	bytes: Uint8Array,
): NonNullable<OtlpExportMetricsServiceRequest['resourceMetrics']>[number] {
	const scopeMetrics: Array<{ scope?: OtlpScope; metrics?: WireMetric[] }> = [];
	let resource: OtlpResource | undefined;
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				resource = readResource(r.readLengthDelimited());
				break;
			case 2:
				scopeMetrics.push(readScopeMetrics(r.readLengthDelimited()));
				break;
			default:
				r.skip(wire);
		}
	}
	return { ...(resource ? { resource } : {}), scopeMetrics };
}

function readScopeMetrics(bytes: Uint8Array): { scope?: OtlpScope; metrics?: WireMetric[] } {
	const metrics: WireMetric[] = [];
	let scope: OtlpScope | undefined;
	const r = new ProtoReader(bytes);
	while (!r.eof) {
		const { field, wire } = r.readTag();
		switch (field) {
			case 1:
				scope = readScope(r.readLengthDelimited());
				break;
			case 2:
				metrics.push(readMetric(r.readLengthDelimited()));
				break;
			default:
				r.skip(wire);
		}
	}
	return { ...(scope ? { scope } : {}), metrics };
}
