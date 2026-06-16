/**
 * OpenTelemetry data-model TypeScript types.
 *
 * These mirror the OTLP wire format
 * (https://opentelemetry.io/docs/specs/otlp/) and serve as the canonical
 * in-memory representation across `@otelux/*`. Trace types shipped in
 * Milestone 1; log records land in Phase 2; metrics/profiles follow.
 */

/** Wire times are unsigned-fixed64 nanoseconds since Unix epoch. */
export type Nanoseconds = bigint;

/** Hex-encoded 16-byte trace identifier. */
export type TraceId = string;

/** Hex-encoded 8-byte span identifier. */
export type SpanId = string;

export type AttributeValue =
	| string
	| number
	| bigint
	| boolean
	| readonly string[]
	| readonly number[]
	| readonly bigint[]
	| readonly boolean[];

export type AttributeMap = Readonly<Record<string, AttributeValue>>;

export interface Resource {
	attributes: AttributeMap;
	droppedAttributesCount?: number;
}

export interface InstrumentationScope {
	name: string;
	version?: string;
	attributes?: AttributeMap;
}

/**
 * Mirrors OTLP `Span.SpanKind`. Numeric values match the proto enum so
 * decoding from wire payloads stays trivial.
 */
export const SpanKind = {
	Unspecified: 0,
	Internal: 1,
	Server: 2,
	Client: 3,
	Producer: 4,
	Consumer: 5,
} as const;

export type SpanKind = (typeof SpanKind)[keyof typeof SpanKind];

export const SpanStatusCode = {
	Unset: 0,
	Ok: 1,
	Error: 2,
} as const;

export type SpanStatusCode = (typeof SpanStatusCode)[keyof typeof SpanStatusCode];

export interface SpanStatus {
	code: SpanStatusCode;
	message?: string;
}

export interface SpanEvent {
	name: string;
	timeUnixNano: Nanoseconds;
	attributes?: AttributeMap;
	droppedAttributesCount?: number;
}

export interface SpanLink {
	traceId: TraceId;
	spanId: SpanId;
	traceState?: string;
	attributes?: AttributeMap;
	droppedAttributesCount?: number;
}

/**
 * Canonical in-memory Span. Attributes are kept on the span itself for fast
 * iteration; resource and scope are carried alongside so consumers can avoid
 * joining tables for common UI queries.
 */
export interface Span {
	traceId: TraceId;
	spanId: SpanId;
	parentSpanId?: SpanId;
	name: string;
	kind: SpanKind;
	startTimeUnixNano: Nanoseconds;
	endTimeUnixNano: Nanoseconds;
	status: SpanStatus;
	attributes: AttributeMap;
	events?: readonly SpanEvent[];
	links?: readonly SpanLink[];
	traceState?: string;
	droppedAttributesCount?: number;
	droppedEventsCount?: number;
	droppedLinksCount?: number;
	resource: Resource;
	scope: InstrumentationScope;
}

/** Computed view over a set of spans sharing the same `traceId`. */
export interface Trace {
	traceId: TraceId;
	rootSpan?: Span;
	spans: readonly Span[];
	startTimeUnixNano: Nanoseconds;
	endTimeUnixNano: Nanoseconds;
	durationNanos: bigint;
	services: readonly string[];
	spanCount: number;
	errorCount: number;
}

/**
 * Mirrors OTLP `LogRecord.SeverityNumber`
 * (https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber).
 * Numeric values match the proto enum so decoding stays trivial. Codex
 * emits its business events (including `codex.user_prompt`, which carries
 * the raw prompt text) at INFO = 9.
 */
export const SeverityNumber = {
	Unspecified: 0,
	Trace: 1,
	Debug: 5,
	Info: 9,
	Warn: 13,
	Error: 17,
	Fatal: 21,
} as const;

export type SeverityNumber = number;

/**
 * Canonical in-memory log record. Like {@link Span}, attributes are kept on
 * the record and resource/scope are carried alongside so the UI can render
 * a row without joining.
 *
 * Note for the Codex workload: the human-readable payload rides
 * `attributes` (e.g. `event.name`, `prompt`, `model`), not `body` — so log
 * queries must be able to free-text search attribute values, not just body.
 */
export interface LogRecord {
	timeUnixNano: Nanoseconds;
	observedTimeUnixNano?: Nanoseconds;
	severityNumber: SeverityNumber;
	severityText?: string;
	/** OTLP 1.x `event_name`. Codex also mirrors this as the `event.name` attribute. */
	eventName?: string;
	/** OTLP `body` AnyValue, normalized. Usually a string; absent for attribute-only events. */
	body?: AttributeValue;
	attributes: AttributeMap;
	droppedAttributesCount?: number;
	flags?: number;
	traceId?: TraceId;
	spanId?: SpanId;
	resource: Resource;
	scope: InstrumentationScope;
}

export const OTELUX_TYPES_VERSION = '0.0.0' as const;
