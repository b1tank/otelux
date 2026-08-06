import type {
	AggregationTemporality,
	AttributeMap,
	AttributeValue,
	HistogramDataPoint,
	InstrumentationScope,
	LogRecord,
	Metric,
	NumberDataPoint,
	Resource,
	Span,
	SpanEvent,
	SpanLink,
	Trace,
} from '@otelux/types';
import type {
	GetMetricPointsResult,
	InvokeMessage,
	InvokeResultFor,
	ListLogsResult,
	ListMetricInstrumentsResult,
	ListResourceFacetsResult,
	ListTracesResult,
	LoadSampleDataResult,
	McpStatus,
	ReceiverStatus,
	RuntimeApiStatus,
	Settings,
	StoragePathInfo,
	StorageUsageInfo,
	UpdateSettingsResult,
} from './index.js';
import type {
	RuntimeInitializeResult,
	RuntimeRpcMethod,
	RuntimeStatusResult,
} from './runtimeRpc.js';
import {
	ProtocolValidationError,
	parseMcpStatus,
	parseReceiverStatus,
	parseRuntimeApiStatus,
	parseSettings,
} from './validation.js';

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const DECIMAL_ID = /^[1-9]\d*$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

type Decoder<T> = (value: unknown, path?: string) => T;

export interface RuntimeRpcResultMap {
	'runtime/initialize': RuntimeInitializeResult;
	'runtime/getStatus': RuntimeStatusResult;
	'runtime/getSettings': Settings;
	'runtime/updateSettings': UpdateSettingsResult;
	'runtime/loadSampleData': LoadSampleDataResult;
	'runtime/clearData': null;
	'telemetry/listTraces': ListTracesResult;
	'telemetry/getTrace': Trace;
	'telemetry/getTraceWaterfall': Trace;
	'telemetry/getSpan': Span;
	'telemetry/listLogs': ListLogsResult;
	'telemetry/getLog': LogRecord;
	'telemetry/listMetricInstruments': ListMetricInstrumentsResult;
	'telemetry/getMetricPoints': GetMetricPointsResult;
	'telemetry/getFacets': ListResourceFacetsResult;
}

export type RuntimeRpcResultFor<M extends RuntimeRpcMethod> = RuntimeRpcResultMap[M];
export type InvokeKind = InvokeMessage['kind'];
export type InvokeMessageFor<K extends InvokeKind> = Extract<InvokeMessage, { kind: K }>;
export type InvokeResultForKind<K extends InvokeKind> = InvokeResultFor<InvokeMessageFor<K>>;

function fail(path: string, code: string, message: string): never {
	throw new ProtocolValidationError(path, code, message);
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return fail(path, 'type', 'expected an object');
	}
	return value as Record<string, unknown>;
}

function text(value: unknown, path: string, maximum = 2_048): string {
	if (typeof value !== 'string') return fail(path, 'type', 'expected a string');
	if (value.length > maximum)
		return fail(path, 'max_length', `must be at most ${maximum} characters`);
	return value;
}

function nonempty(value: unknown, path: string, maximum = 2_048): string {
	const result = text(value, path, maximum);
	if (result.length === 0) return fail(path, 'length', 'must not be empty');
	return result;
}

function isoDate(value: unknown, path: string): string {
	const result = nonempty(value, path, 64);
	if (!Number.isFinite(Date.parse(result)))
		return fail(path, 'date_time', 'expected an ISO-8601 date-time');
	return result;
}

function finite(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value))
		return fail(path, 'type', 'expected a finite number');
	return value;
}

function integer(value: unknown, path: string, minimum = 0, maximum = MAX_SAFE): number {
	const result = finite(value, path);
	if (!Number.isInteger(result)) return fail(path, 'type', 'expected an integer');
	if (result < minimum || result > maximum)
		return fail(path, 'range', `must be between ${minimum} and ${maximum}`);
	return result;
}

function bigint(value: unknown, path: string): bigint {
	if (typeof value !== 'bigint') return fail(path, 'type', 'expected a bigint');
	return value;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') return fail(path, 'type', 'expected a boolean');
	return value;
}

function literal<T extends string | number | boolean | null>(
	value: unknown,
	expected: T,
	path: string,
): T {
	if (value !== expected) return fail(path, 'literal', `expected ${String(expected)}`);
	return expected;
}

function enumeration<T extends string | number>(
	value: unknown,
	allowed: readonly T[],
	path: string,
): T {
	if (!allowed.includes(value as T))
		return fail(path, 'enum', `expected one of ${allowed.join(', ')}`);
	return value as T;
}

function array<T>(
	value: unknown,
	path: string,
	maximum: number,
	decode: (entry: unknown, path: string) => T,
): readonly T[] {
	if (!Array.isArray(value)) return fail(path, 'type', 'expected an array');
	if (value.length > maximum)
		return fail(path, 'max_items', `must contain at most ${maximum} items`);
	return value.map((entry, index) => decode(entry, `${path}[${index}]`));
}

function optional<T>(
	input: Record<string, unknown>,
	key: string,
	path: string,
	decode: (value: unknown, path: string) => T,
): T | undefined {
	if (!(key in input)) return undefined;
	if (input[key] === undefined)
		return fail(`${path}.${key}`, 'type', 'explicit undefined is not allowed');
	return decode(input[key], `${path}.${key}`);
}

function identifier(value: unknown, path: string, pattern: RegExp, label: string): string {
	const result = text(value, path, 64);
	if (!pattern.test(result))
		return fail(path, 'format', `expected a lowercase hexadecimal ${label}`);
	return result;
}

function decimalId(value: unknown, path: string): string {
	const result = text(value, path, 32);
	if (!DECIMAL_ID.test(result)) return fail(path, 'format', 'expected a decimal ID');
	return result;
}

function attributeValue(value: unknown, path: string): AttributeValue {
	if (typeof value === 'string') return text(value, path, 1_048_576);
	if (typeof value === 'number') return finite(value, path);
	if (typeof value === 'bigint' || typeof value === 'boolean') return value;
	if (!Array.isArray(value)) return fail(path, 'type', 'expected an attribute scalar or array');
	if (value.length > 10_000) return fail(path, 'max_items', 'must contain at most 10000 items');
	if (value.length === 0) return [] as readonly string[];
	const kind = typeof value[0];
	if (!['string', 'number', 'bigint', 'boolean'].includes(kind))
		return fail(`${path}[0]`, 'type', 'expected an attribute scalar');
	return value.map((entry, index) => {
		const matches =
			(kind === 'string' && typeof entry === 'string') ||
			(kind === 'number' && typeof entry === 'number') ||
			(kind === 'bigint' && typeof entry === 'bigint') ||
			(kind === 'boolean' && typeof entry === 'boolean');
		if (!matches) return fail(`${path}[${index}]`, 'type', 'attribute arrays must be homogeneous');
		return kind === 'number' ? finite(entry, `${path}[${index}]`) : entry;
	}) as AttributeValue;
}

function attributes(value: unknown, path: string): AttributeMap {
	const input = object(value, path);
	if (Object.keys(input).length > 10_000)
		return fail(path, 'max_properties', 'must contain at most 10000 attributes');
	const result: Record<string, AttributeValue> = {};
	for (const [key, entry] of Object.entries(input)) {
		Object.defineProperty(result, key, {
			value: attributeValue(entry, `${path}.${key}`),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return result;
}

function resource(value: unknown, path: string): Resource {
	const input = object(value, path);
	const droppedAttributesCount = optional(input, 'droppedAttributesCount', path, integer);
	return {
		attributes: attributes(input.attributes, `${path}.attributes`),
		...(droppedAttributesCount !== undefined ? { droppedAttributesCount } : {}),
	};
}

function scope(value: unknown, path: string): InstrumentationScope {
	const input = object(value, path);
	const version = optional(input, 'version', path, text);
	const scopeAttributes = optional(input, 'attributes', path, attributes);
	return {
		name: text(input.name, `${path}.name`),
		...(version !== undefined ? { version } : {}),
		...(scopeAttributes !== undefined ? { attributes: scopeAttributes } : {}),
	};
}

function spanStatus(value: unknown, path: string): Span['status'] {
	const input = object(value, path);
	const message = optional(input, 'message', path, text);
	return {
		code: enumeration(input.code, [0, 1, 2], `${path}.code`),
		...(message !== undefined ? { message } : {}),
	};
}

function spanEvent(value: unknown, path: string): SpanEvent {
	const input = object(value, path);
	const eventAttributes = optional(input, 'attributes', path, attributes);
	const droppedAttributesCount = optional(input, 'droppedAttributesCount', path, integer);
	return {
		name: text(input.name, `${path}.name`),
		timeUnixNano: bigint(input.timeUnixNano, `${path}.timeUnixNano`),
		...(eventAttributes !== undefined ? { attributes: eventAttributes } : {}),
		...(droppedAttributesCount !== undefined ? { droppedAttributesCount } : {}),
	};
}

function spanLink(value: unknown, path: string): SpanLink {
	const input = object(value, path);
	const traceState = optional(input, 'traceState', path, text);
	const linkAttributes = optional(input, 'attributes', path, attributes);
	const droppedAttributesCount = optional(input, 'droppedAttributesCount', path, integer);
	return {
		traceId: identifier(input.traceId, `${path}.traceId`, TRACE_ID, 'trace ID'),
		spanId: identifier(input.spanId, `${path}.spanId`, SPAN_ID, 'span ID'),
		...(traceState !== undefined ? { traceState } : {}),
		...(linkAttributes !== undefined ? { attributes: linkAttributes } : {}),
		...(droppedAttributesCount !== undefined ? { droppedAttributesCount } : {}),
	};
}

export function parseSpan(value: unknown, path = '$.result'): Span {
	const input = object(value, path);
	const parentSpanId = optional(input, 'parentSpanId', path, (v, p) =>
		identifier(v, p, SPAN_ID, 'span ID'),
	);
	const events = optional(input, 'events', path, (v, p) => array(v, p, 10_000, spanEvent));
	const links = optional(input, 'links', path, (v, p) => array(v, p, 10_000, spanLink));
	const traceState = optional(input, 'traceState', path, text);
	const droppedAttributesCount = optional(input, 'droppedAttributesCount', path, integer);
	const droppedEventsCount = optional(input, 'droppedEventsCount', path, integer);
	const droppedLinksCount = optional(input, 'droppedLinksCount', path, integer);
	return {
		traceId: identifier(input.traceId, `${path}.traceId`, TRACE_ID, 'trace ID'),
		spanId: identifier(input.spanId, `${path}.spanId`, SPAN_ID, 'span ID'),
		...(parentSpanId !== undefined ? { parentSpanId } : {}),
		name: text(input.name, `${path}.name`),
		kind: enumeration(input.kind, [0, 1, 2, 3, 4, 5], `${path}.kind`),
		startTimeUnixNano: bigint(input.startTimeUnixNano, `${path}.startTimeUnixNano`),
		endTimeUnixNano: bigint(input.endTimeUnixNano, `${path}.endTimeUnixNano`),
		status: spanStatus(input.status, `${path}.status`),
		attributes: attributes(input.attributes, `${path}.attributes`),
		...(events !== undefined ? { events } : {}),
		...(links !== undefined ? { links } : {}),
		...(traceState !== undefined ? { traceState } : {}),
		...(droppedAttributesCount !== undefined ? { droppedAttributesCount } : {}),
		...(droppedEventsCount !== undefined ? { droppedEventsCount } : {}),
		...(droppedLinksCount !== undefined ? { droppedLinksCount } : {}),
		resource: resource(input.resource, `${path}.resource`),
		scope: scope(input.scope, `${path}.scope`),
	};
}

export function parseTrace(value: unknown, path = '$.result'): Trace {
	const input = object(value, path);
	const rootSpan = optional(input, 'rootSpan', path, parseSpan);
	return {
		traceId: identifier(input.traceId, `${path}.traceId`, TRACE_ID, 'trace ID'),
		...(rootSpan !== undefined ? { rootSpan } : {}),
		spans: array(input.spans, `${path}.spans`, 100_000, parseSpan),
		startTimeUnixNano: bigint(input.startTimeUnixNano, `${path}.startTimeUnixNano`),
		endTimeUnixNano: bigint(input.endTimeUnixNano, `${path}.endTimeUnixNano`),
		durationNanos: bigint(input.durationNanos, `${path}.durationNanos`),
		services: array(input.services, `${path}.services`, 10_000, text),
		spanCount: integer(input.spanCount, `${path}.spanCount`),
		errorCount: integer(input.errorCount, `${path}.errorCount`),
	};
}

export function parseLogRecord(value: unknown, path = '$.result'): LogRecord {
	const input = object(value, path);
	const observedTimeUnixNano = optional(input, 'observedTimeUnixNano', path, bigint);
	const severityText = optional(input, 'severityText', path, text);
	const eventName = optional(input, 'eventName', path, text);
	const body = optional(input, 'body', path, attributeValue);
	const droppedAttributesCount = optional(input, 'droppedAttributesCount', path, integer);
	const flags = optional(input, 'flags', path, integer);
	const traceId = optional(input, 'traceId', path, (v, p) => identifier(v, p, TRACE_ID, 'trace ID'));
	const spanId = optional(input, 'spanId', path, (v, p) => identifier(v, p, SPAN_ID, 'span ID'));
	return {
		timeUnixNano: bigint(input.timeUnixNano, `${path}.timeUnixNano`),
		...(observedTimeUnixNano !== undefined ? { observedTimeUnixNano } : {}),
		severityNumber: integer(input.severityNumber, `${path}.severityNumber`, 0, 24),
		...(severityText !== undefined ? { severityText } : {}),
		...(eventName !== undefined ? { eventName } : {}),
		...(body !== undefined ? { body } : {}),
		attributes: attributes(input.attributes, `${path}.attributes`),
		...(droppedAttributesCount !== undefined ? { droppedAttributesCount } : {}),
		...(flags !== undefined ? { flags } : {}),
		...(traceId !== undefined ? { traceId } : {}),
		...(spanId !== undefined ? { spanId } : {}),
		resource: resource(input.resource, `${path}.resource`),
		scope: scope(input.scope, `${path}.scope`),
	};
}

function numberPoint(value: unknown, path: string): NumberDataPoint {
	const input = object(value, path);
	const startTimeUnixNano = optional(input, 'startTimeUnixNano', path, bigint);
	const flags = optional(input, 'flags', path, integer);
	return {
		...(startTimeUnixNano !== undefined ? { startTimeUnixNano } : {}),
		timeUnixNano: bigint(input.timeUnixNano, `${path}.timeUnixNano`),
		value: finite(input.value, `${path}.value`),
		attributes: attributes(input.attributes, `${path}.attributes`),
		...(flags !== undefined ? { flags } : {}),
	};
}

function histogramPoint(value: unknown, path: string): HistogramDataPoint {
	const input = object(value, path);
	const startTimeUnixNano = optional(input, 'startTimeUnixNano', path, bigint);
	const sum = optional(input, 'sum', path, finite);
	const min = optional(input, 'min', path, finite);
	const max = optional(input, 'max', path, finite);
	const flags = optional(input, 'flags', path, integer);
	return {
		...(startTimeUnixNano !== undefined ? { startTimeUnixNano } : {}),
		timeUnixNano: bigint(input.timeUnixNano, `${path}.timeUnixNano`),
		count: integer(input.count, `${path}.count`),
		...(sum !== undefined ? { sum } : {}),
		...(min !== undefined ? { min } : {}),
		...(max !== undefined ? { max } : {}),
		bucketCounts: array(input.bucketCounts, `${path}.bucketCounts`, 10_000, integer),
		explicitBounds: array(input.explicitBounds, `${path}.explicitBounds`, 10_000, finite),
		attributes: attributes(input.attributes, `${path}.attributes`),
		...(flags !== undefined ? { flags } : {}),
	};
}

export function parseMetric(value: unknown, path = '$.result', maximumPoints = 1_000): Metric {
	const input = object(value, path);
	const type = enumeration(input.type, ['sum', 'gauge', 'histogram'] as const, `${path}.type`);
	const description = optional(input, 'description', path, text);
	const unit = optional(input, 'unit', path, text);
	const common = {
		name: text(input.name, `${path}.name`),
		...(description !== undefined ? { description } : {}),
		...(unit !== undefined ? { unit } : {}),
		resource: resource(input.resource, `${path}.resource`),
		scope: scope(input.scope, `${path}.scope`),
	};
	if (type === 'gauge')
		return {
			...common,
			type,
			dataPoints: array(input.dataPoints, `${path}.dataPoints`, maximumPoints, numberPoint),
		};
	const temporality = enumeration(
		input.temporality,
		[0, 1, 2],
		`${path}.temporality`,
	) as AggregationTemporality;
	if (type === 'sum')
		return {
			...common,
			type,
			isMonotonic: boolean(input.isMonotonic, `${path}.isMonotonic`),
			temporality,
			dataPoints: array(input.dataPoints, `${path}.dataPoints`, maximumPoints, numberPoint),
		};
	return {
		...common,
		type,
		temporality,
		dataPoints: array(input.dataPoints, `${path}.dataPoints`, maximumPoints, histogramPoint),
	};
}

export function parseListTracesResult(value: unknown, path = '$.result'): ListTracesResult {
	const input = object(value, path);
	const totalCountIsExact = optional(input, 'totalCountIsExact', path, boolean);
	const nextCursor = optional(input, 'nextCursor', path, (v, p) => text(v, p, 512));
	return {
		rows: array(input.rows, `${path}.rows`, 200, (entry, rowPath) => {
			const row = object(entry, rowPath);
			return {
				traceId: identifier(row.traceId, `${rowPath}.traceId`, TRACE_ID, 'trace ID'),
				rootName: text(row.rootName, `${rowPath}.rootName`),
				startTimeUnixNano: bigint(row.startTimeUnixNano, `${rowPath}.startTimeUnixNano`),
				durationNanos: bigint(row.durationNanos, `${rowPath}.durationNanos`),
				services: array(row.services, `${rowPath}.services`, 10_000, text),
				spanCount: integer(row.spanCount, `${rowPath}.spanCount`),
				errorCount: integer(row.errorCount, `${rowPath}.errorCount`),
			};
		}),
		totalCount: integer(input.totalCount, `${path}.totalCount`),
		...(totalCountIsExact !== undefined ? { totalCountIsExact } : {}),
		...(nextCursor !== undefined ? { nextCursor } : {}),
	};
}

export function parseListLogsResult(value: unknown, path = '$.result'): ListLogsResult {
	const input = object(value, path);
	const totalCountIsExact = optional(input, 'totalCountIsExact', path, boolean);
	const nextCursor = optional(input, 'nextCursor', path, (v, p) => text(v, p, 512));
	return {
		rows: array(input.rows, `${path}.rows`, 500, (entry, rowPath) => {
			const row = object(entry, rowPath);
			const severityText = optional(row, 'severityText', rowPath, text);
			const eventName = optional(row, 'eventName', rowPath, text);
			const serviceName = optional(row, 'serviceName', rowPath, text);
			const traceId = optional(row, 'traceId', rowPath, (v, p) =>
				identifier(v, p, TRACE_ID, 'trace ID'),
			);
			const spanId = optional(row, 'spanId', rowPath, (v, p) => identifier(v, p, SPAN_ID, 'span ID'));
			return {
				logId: decimalId(row.logId, `${rowPath}.logId`),
				timeUnixNano: bigint(row.timeUnixNano, `${rowPath}.timeUnixNano`),
				severityNumber: integer(row.severityNumber, `${rowPath}.severityNumber`, 0, 24),
				...(severityText !== undefined ? { severityText } : {}),
				...(eventName !== undefined ? { eventName } : {}),
				message: text(row.message, `${rowPath}.message`, 4_096),
				...(serviceName !== undefined ? { serviceName } : {}),
				...(traceId !== undefined ? { traceId } : {}),
				...(spanId !== undefined ? { spanId } : {}),
			};
		}),
		totalCount: integer(input.totalCount, `${path}.totalCount`),
		...(totalCountIsExact !== undefined ? { totalCountIsExact } : {}),
		...(nextCursor !== undefined ? { nextCursor } : {}),
	};
}

export function parseListMetricInstrumentsResult(
	value: unknown,
	path = '$.result',
): ListMetricInstrumentsResult {
	const input = object(value, path);
	return {
		rows: array(input.rows, `${path}.rows`, 500, (entry, rowPath) => {
			const row = object(entry, rowPath);
			const description = optional(row, 'description', rowPath, text);
			const unit = optional(row, 'unit', rowPath, text);
			const isMonotonic = optional(row, 'isMonotonic', rowPath, boolean);
			const temporality = optional(
				row,
				'temporality',
				rowPath,
				(v, p) => enumeration(v, [0, 1, 2], p) as AggregationTemporality,
			);
			const sourceName = optional(row, 'sourceName', rowPath, text);
			const serviceName = optional(row, 'serviceName', rowPath, text);
			const latest = optional(row, 'latest', rowPath, (v, p) => {
				const item = object(v, p);
				const kind = enumeration(item.kind, ['number', 'histogram'] as const, `${p}.kind`);
				if (kind === 'number')
					return {
						kind,
						timeUnixNano: bigint(item.timeUnixNano, `${p}.timeUnixNano`),
						value: finite(item.value, `${p}.value`),
					};
				const sum = optional(item, 'sum', p, finite);
				return {
					kind,
					timeUnixNano: bigint(item.timeUnixNano, `${p}.timeUnixNano`),
					count: integer(item.count, `${p}.count`),
					...(sum !== undefined ? { sum } : {}),
				};
			});
			return {
				instrumentId: decimalId(row.instrumentId, `${rowPath}.instrumentId`),
				name: text(row.name, `${rowPath}.name`),
				...(description !== undefined ? { description } : {}),
				...(unit !== undefined ? { unit } : {}),
				type: enumeration(row.type, ['sum', 'gauge', 'histogram'] as const, `${rowPath}.type`),
				...(isMonotonic !== undefined ? { isMonotonic } : {}),
				...(temporality !== undefined ? { temporality } : {}),
				...(sourceName !== undefined ? { sourceName } : {}),
				...(serviceName !== undefined ? { serviceName } : {}),
				meterName: text(row.meterName, `${rowPath}.meterName`),
				pointCount: integer(row.pointCount, `${rowPath}.pointCount`),
				...(latest !== undefined ? { latest } : {}),
			};
		}),
		totalCount: integer(input.totalCount, `${path}.totalCount`),
	};
}

export function parseGetMetricPointsResult(
	value: unknown,
	path = '$.result',
): GetMetricPointsResult {
	const input = object(value, path);
	const nextCursor = optional(input, 'nextCursor', path, (v, p) => text(v, p, 128));
	const truncatedAttributes = optional(input, 'truncatedAttributes', path, (v, p) =>
		array(v, p, 1_000, (entry, itemPath) => {
			const item = object(entry, itemPath);
			return {
				pointIndex: integer(item.pointIndex, `${itemPath}.pointIndex`, 0, 999),
				truncatedOrOmittedAttributeCount: integer(
					item.truncatedOrOmittedAttributeCount,
					`${itemPath}.truncatedOrOmittedAttributeCount`,
				),
			};
		}),
	);
	const resourceAttributesTruncated = optional(input, 'resourceAttributesTruncated', path, integer);
	const scopeAttributesTruncated = optional(input, 'scopeAttributesTruncated', path, integer);
	const metadataTruncated = optional(input, 'metadataTruncated', path, boolean);
	const histogramBucketsTruncated = optional(input, 'histogramBucketsTruncated', path, (v, p) =>
		array(v, p, 1_000, (entry, itemPath) => integer(entry, itemPath, 0, 999)),
	);
	return {
		metric: parseMetric(input.metric, `${path}.metric`, 1_000),
		totalPointCount: integer(input.totalPointCount, `${path}.totalPointCount`),
		...(nextCursor !== undefined ? { nextCursor } : {}),
		...(truncatedAttributes !== undefined ? { truncatedAttributes } : {}),
		...(resourceAttributesTruncated !== undefined ? { resourceAttributesTruncated } : {}),
		...(scopeAttributesTruncated !== undefined ? { scopeAttributesTruncated } : {}),
		...(metadataTruncated !== undefined ? { metadataTruncated } : {}),
		...(histogramBucketsTruncated !== undefined ? { histogramBucketsTruncated } : {}),
	};
}

export function parseListResourceFacetsResult(
	value: unknown,
	path = '$.result',
): ListResourceFacetsResult {
	const input = object(value, path);
	return {
		rows: array(input.rows, `${path}.rows`, 500, (entry, rowPath) => {
			const row = object(entry, rowPath);
			return {
				name: text(row.name, `${rowPath}.name`, 512),
				count: integer(row.count, `${rowPath}.count`),
			};
		}),
	};
}

function selected(
	input: Record<string, unknown>,
	allowed: readonly string[],
): Record<string, unknown> {
	return Object.fromEntries(allowed.filter((key) => key in input).map((key) => [key, input[key]]));
}

function parseResultSettings(value: unknown, path = '$.result'): Settings {
	const input = object(value, path);
	const result = selected(input, ['version', 'otlp', 'mcp', 'retention', 'storage']);
	for (const section of ['otlp', 'mcp', 'retention', 'storage'] as const) {
		if (section in result) {
			const sectionInput = object(result[section], `${path}.${section}`);
			const keys =
				section === 'otlp'
					? ['port']
					: section === 'mcp'
						? ['enabled', 'port']
						: section === 'retention'
							? ['maxAgeHours', 'maxSizeMb']
							: ['dbPath'];
			result[section] = selected(sectionInput, keys);
		}
	}
	return parseSettings(result, path);
}

function parseResultReceiverStatus(value: unknown, path = '$.result'): ReceiverStatus {
	const input = object(value, path);
	const result = selected(input, ['kind', 'port', 'host', 'pressure', 'message']);
	if ('pressure' in result) {
		result.pressure = selected(object(result.pressure, `${path}.pressure`), [
			'overloadedTraces',
			'overloadedLogs',
			'overloadedMetrics',
		]);
	}
	return parseReceiverStatus(result, path);
}

function parseResultMcpStatus(value: unknown, path = '$.result'): McpStatus {
	return parseMcpStatus(selected(object(value, path), ['kind', 'port', 'host', 'message']), path);
}

function parseResultApiStatus(value: unknown, path = '$.result'): RuntimeApiStatus {
	return parseRuntimeApiStatus(
		selected(object(value, path), ['kind', 'host', 'port', 'message']),
		path,
	);
}

function parseInitialize(value: unknown, path = '$.result'): RuntimeInitializeResult {
	const input = object(value, path);
	const runtime = object(input.runtime, `${path}.runtime`);
	const capabilities = object(input.capabilities, `${path}.capabilities`);
	const limits = object(input.limits, `${path}.limits`);
	return {
		protocolVersion: literal(input.protocolVersion, '2.0.0', `${path}.protocolVersion`),
		runtime: {
			name: literal(runtime.name, 'otelux-runtime', `${path}.runtime.name`),
			version: nonempty(runtime.version, `${path}.runtime.version`, 64),
		},
		capabilities: {
			queries: literal(capabilities.queries, true, `${path}.capabilities.queries`),
			settings: literal(capabilities.settings, true, `${path}.capabilities.settings`),
			sampleData: literal(capabilities.sampleData, true, `${path}.capabilities.sampleData`),
			clearData: literal(capabilities.clearData, true, `${path}.capabilities.clearData`),
			events: literal(capabilities.events, true, `${path}.capabilities.events`),
		},
		limits: {
			traces: literal(limits.traces, 200, `${path}.limits.traces`),
			logs: literal(limits.logs, 500, `${path}.limits.logs`),
			metrics: literal(limits.metrics, 500, `${path}.limits.metrics`),
			metricPoints: literal(limits.metricPoints, 1_000, `${path}.limits.metricPoints`),
		},
	};
}

function parseStatus(value: unknown, path = '$.result'): RuntimeStatusResult {
	const input = object(value, path);
	const api = optional(input, 'api', path, parseResultApiStatus);
	return {
		runtimeVersion: nonempty(input.runtimeVersion, `${path}.runtimeVersion`, 64),
		protocolVersion: nonempty(input.protocolVersion, `${path}.protocolVersion`, 64),
		instanceId: nonempty(input.instanceId, `${path}.instanceId`, 128),
		pid: integer(input.pid, `${path}.pid`, 1),
		startedAt: isoDate(input.startedAt, `${path}.startedAt`),
		dataDirectory: text(input.dataDirectory, `${path}.dataDirectory`, 4_096),
		databasePath: text(input.databasePath, `${path}.databasePath`, 4_096),
		receiver: parseResultReceiverStatus(input.receiver, `${path}.receiver`),
		mcp: parseResultMcpStatus(input.mcp, `${path}.mcp`),
		...(api !== undefined ? { api } : {}),
	};
}

function parseUpdateSettings(value: unknown, path = '$.result'): UpdateSettingsResult {
	const input = object(value, path);
	const ok = boolean(input.ok, `${path}.ok`);
	return ok
		? {
				ok,
				settings: parseResultSettings(input.settings, `${path}.settings`),
				status: parseResultReceiverStatus(input.status, `${path}.status`),
				mcpStatus: parseResultMcpStatus(input.mcpStatus, `${path}.mcpStatus`),
			}
		: { ok, error: text(input.error, `${path}.error`) };
}

function parseCounts(value: unknown, path = '$.result'): LoadSampleDataResult {
	const input = object(value, path);
	return {
		traces: integer(input.traces, `${path}.traces`),
		logs: integer(input.logs, `${path}.logs`),
		metrics: integer(input.metrics, `${path}.metrics`),
	};
}

function parseStoragePath(value: unknown, path = '$.result'): StoragePathInfo {
	const input = object(value, path);
	return {
		activePath: text(input.activePath, `${path}.activePath`, 4_096),
		defaultPath: text(input.defaultPath, `${path}.defaultPath`, 4_096),
	};
}
function parseStorageUsage(value: unknown, path = '$.result'): StorageUsageInfo {
	const input = object(value, path);
	return {
		activePath: text(input.activePath, `${path}.activePath`, 4_096),
		retentionBytes: integer(input.retentionBytes, `${path}.retentionBytes`),
		databaseFileBytes: integer(input.databaseFileBytes, `${path}.databaseFileBytes`),
		walBytes: integer(input.walBytes, `${path}.walBytes`),
		sharedMemoryBytes: integer(input.sharedMemoryBytes, `${path}.sharedMemoryBytes`),
		totalBytes: integer(input.totalBytes, `${path}.totalBytes`),
	};
}

export const runtimeRpcResultDecoders = {
	'runtime/initialize': parseInitialize,
	'runtime/getStatus': parseStatus,
	'runtime/getSettings': parseResultSettings,
	'runtime/updateSettings': parseUpdateSettings,
	'runtime/loadSampleData': parseCounts,
	'runtime/clearData': (value: unknown, path = '$.result') => literal(value, null, path),
	'telemetry/listTraces': parseListTracesResult,
	'telemetry/getTrace': parseTrace,
	'telemetry/getTraceWaterfall': parseTrace,
	'telemetry/getSpan': parseSpan,
	'telemetry/listLogs': parseListLogsResult,
	'telemetry/getLog': parseLogRecord,
	'telemetry/listMetricInstruments': parseListMetricInstrumentsResult,
	'telemetry/getMetricPoints': parseGetMetricPointsResult,
	'telemetry/getFacets': parseListResourceFacetsResult,
} satisfies { [M in RuntimeRpcMethod]: Decoder<RuntimeRpcResultMap[M]> };

export const invokeResultDecoders = {
	listTraces: parseListTracesResult,
	getTrace: parseTrace,
	getTraceWaterfall: parseTrace,
	getSpanDetails: parseSpan,
	listLogs: parseListLogsResult,
	getLogDetails: parseLogRecord,
	listMetricInstruments: parseListMetricInstrumentsResult,
	getMetricPoints: parseGetMetricPointsResult,
	listResourceFacets: parseListResourceFacetsResult,
	getSettings: parseResultSettings,
	updateSettings: parseUpdateSettings,
	getReceiverStatus: parseResultReceiverStatus,
	getMcpStatus: parseResultMcpStatus,
	getStoragePath: parseStoragePath,
	getStorageUsage: parseStorageUsage,
	loadSampleData: parseCounts,
	clearData: (value: unknown, path = '$.result') => {
		if (value !== undefined) fail(path, 'type', 'expected undefined');
		return undefined;
	},
} satisfies { [K in InvokeKind]: Decoder<InvokeResultForKind<K>> };

export function parseRuntimeRpcResult<M extends RuntimeRpcMethod>(
	method: M,
	value: unknown,
): RuntimeRpcResultFor<M> {
	return (runtimeRpcResultDecoders[method] as Decoder<RuntimeRpcResultFor<M>>)(value, '$.result');
}

export function parseInvokeResult<K extends InvokeKind>(
	kind: K,
	value: unknown,
): InvokeResultForKind<K> {
	return (invokeResultDecoders[kind] as Decoder<InvokeResultForKind<K>>)(value, '$.result');
}
