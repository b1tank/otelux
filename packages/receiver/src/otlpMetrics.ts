/**
 * OTLP/HTTP JSON decoder for metrics.
 *
 * Mirrors the trace/log decoders: camelCase fields, fixed64/uint64 sent as
 * JSON strings, attribute values wrapped in `AnyValue` envelopes. We accept
 * the JSON shape OpenTelemetry SDKs emit and normalize it to our internal
 * {@link Metric} union. Unknown fields are dropped silently — receivers
 * must be lenient.
 *
 * The load-bearing case is the Codex CLI metrics pipeline. A real export
 * looks like (truncated) — note Codex uses **delta** temporality
 * (`aggregationTemporality: 1`) and ships int64 point values as strings:
 *   {
 *     "resourceMetrics": [{
 *       "resource": { "attributes": [{ "key": "service.name",
 *                                       "value": { "stringValue": "codex" } }] },
 *       "scopeMetrics": [{
 *         "scope": { "name": "codex" },
 *         "metrics": [
 *           { "name": "codex.api_request", "unit": "{request}",
 *             "sum": { "isMonotonic": true, "aggregationTemporality": 1,
 *               "dataPoints": [{ "timeUnixNano": "1750000000000000000",
 *                                "asInt": "3",
 *                                "attributes": [{ "key": "http.response.status_code",
 *                                                 "value": { "intValue": "200" } }] }] } },
 *           { "name": "codex.turn.e2e_duration_ms", "unit": "ms",
 *             "histogram": { "aggregationTemporality": 1,
 *               "dataPoints": [{ "timeUnixNano": "1750000000000000000",
 *                                "count": "2", "sum": 1234.5,
 *                                "bucketCounts": ["1", "1", "0"],
 *                                "explicitBounds": [100, 500],
 *                                "min": 420, "max": 814 }] } }
 *         ]
 *       }]
 *     }]
 *   }
 */

import type {
	AggregationTemporality,
	HistogramDataPoint,
	InstrumentationScope,
	Metric,
	NumberDataPoint,
	Resource,
} from '@otelux/types';
import {
	type OtlpAttribute,
	type OtlpResource,
	type OtlpScope,
	decodeAttributes,
	decodeResource,
	decodeScope,
} from './otlp.js';

interface OtlpNumberDataPoint {
	startTimeUnixNano?: string;
	timeUnixNano?: string;
	// Per the OTLP JSON encoding exactly one of these is present; int64 rides
	// as a string to preserve range, doubles as a JSON number.
	asInt?: string | number;
	asDouble?: number;
	attributes?: OtlpAttribute[];
	flags?: number;
}

interface OtlpHistogramDataPoint {
	startTimeUnixNano?: string;
	timeUnixNano?: string;
	// uint64 counts ride as JSON strings; some SDKs emit plain numbers.
	count?: string | number;
	sum?: number;
	min?: number;
	max?: number;
	bucketCounts?: (string | number)[];
	explicitBounds?: number[];
	attributes?: OtlpAttribute[];
	flags?: number;
}

interface OtlpSum {
	dataPoints?: OtlpNumberDataPoint[];
	aggregationTemporality?: number;
	isMonotonic?: boolean;
}

interface OtlpGauge {
	dataPoints?: OtlpNumberDataPoint[];
}

interface OtlpHistogram {
	dataPoints?: OtlpHistogramDataPoint[];
	aggregationTemporality?: number;
}

interface OtlpMetric {
	name?: string;
	description?: string;
	unit?: string;
	sum?: OtlpSum;
	gauge?: OtlpGauge;
	histogram?: OtlpHistogram;
}

interface OtlpScopeMetrics {
	scope?: OtlpScope;
	metrics?: OtlpMetric[];
}

interface OtlpResourceMetrics {
	resource?: OtlpResource;
	scopeMetrics?: OtlpScopeMetrics[];
}

export interface OtlpExportMetricsServiceRequest {
	resourceMetrics?: OtlpResourceMetrics[];
}

/** Coerce a uint64-as-string (or number) to a JS number. */
function toCount(value: string | number | undefined): number {
	if (value === undefined) {
		return 0;
	}
	return typeof value === 'string' ? Number(value) : value;
}

function decodeTemporality(value: number | undefined): AggregationTemporality {
	// 1 = delta, 2 = cumulative; anything else is unspecified (0).
	return value === 1 || value === 2 ? value : 0;
}

/**
 * Resolve a data point's timestamp. Prefer the explicit `timeUnixNano`;
 * fall back to `startTimeUnixNano` when the explicit value is unset/"0"
 * (mirrors the lenient handling logs need for Codex).
 */
function pointTime(
	timeUnixNano: string | undefined,
	startTimeUnixNano: string | undefined,
): bigint {
	const explicit = timeUnixNano && timeUnixNano !== '0' ? timeUnixNano : undefined;
	const time = explicit ?? startTimeUnixNano;
	return time ? BigInt(time) : 0n;
}

function decodeNumberDataPoint(dp: OtlpNumberDataPoint): NumberDataPoint {
	// Exactly one of asDouble/asInt is set per spec; default to 0 if neither.
	const value =
		typeof dp.asDouble === 'number' ? dp.asDouble : dp.asInt !== undefined ? Number(dp.asInt) : 0;
	return {
		timeUnixNano: pointTime(dp.timeUnixNano, dp.startTimeUnixNano),
		value,
		attributes: decodeAttributes(dp.attributes),
		...(dp.startTimeUnixNano ? { startTimeUnixNano: BigInt(dp.startTimeUnixNano) } : {}),
		...(dp.flags !== undefined ? { flags: dp.flags } : {}),
	};
}

function decodeHistogramDataPoint(dp: OtlpHistogramDataPoint): HistogramDataPoint {
	return {
		timeUnixNano: pointTime(dp.timeUnixNano, dp.startTimeUnixNano),
		count: toCount(dp.count),
		bucketCounts: (dp.bucketCounts ?? []).map(toCount),
		explicitBounds: dp.explicitBounds ?? [],
		attributes: decodeAttributes(dp.attributes),
		...(dp.startTimeUnixNano ? { startTimeUnixNano: BigInt(dp.startTimeUnixNano) } : {}),
		...(typeof dp.sum === 'number' ? { sum: dp.sum } : {}),
		...(typeof dp.min === 'number' ? { min: dp.min } : {}),
		...(typeof dp.max === 'number' ? { max: dp.max } : {}),
		...(dp.flags !== undefined ? { flags: dp.flags } : {}),
	};
}

function decodeMetric(
	m: OtlpMetric,
	resource: Resource,
	scope: InstrumentationScope,
): Metric | undefined {
	const name = m.name;
	if (!name) {
		return undefined;
	}
	const base = {
		name,
		resource,
		scope,
		...(m.description ? { description: m.description } : {}),
		...(m.unit ? { unit: m.unit } : {}),
	};
	if (m.sum) {
		return {
			...base,
			type: 'sum',
			isMonotonic: m.sum.isMonotonic ?? false,
			temporality: decodeTemporality(m.sum.aggregationTemporality),
			dataPoints: (m.sum.dataPoints ?? []).map(decodeNumberDataPoint),
		};
	}
	if (m.gauge) {
		return {
			...base,
			type: 'gauge',
			dataPoints: (m.gauge.dataPoints ?? []).map(decodeNumberDataPoint),
		};
	}
	if (m.histogram) {
		return {
			...base,
			type: 'histogram',
			temporality: decodeTemporality(m.histogram.aggregationTemporality),
			dataPoints: (m.histogram.dataPoints ?? []).map(decodeHistogramDataPoint),
		};
	}
	// ExponentialHistogram / Summary are not modelled yet — drop silently.
	return undefined;
}

/**
 * Decode an OTLP/HTTP JSON `ExportMetricsServiceRequest` into our internal
 * {@link Metric} union. Drops metrics with no name and instrument kinds we
 * do not model yet (exponential histogram, summary).
 */
export function decodeExportMetricsServiceRequest(
	payload: OtlpExportMetricsServiceRequest,
): Metric[] {
	const metrics: Metric[] = [];
	for (const rm of payload.resourceMetrics ?? []) {
		const resource = decodeResource(rm.resource);
		for (const sm of rm.scopeMetrics ?? []) {
			const scope = decodeScope(sm.scope);
			for (const m of sm.metrics ?? []) {
				const decoded = decodeMetric(m, resource, scope);
				if (decoded) {
					metrics.push(decoded);
				}
			}
		}
	}
	return metrics;
}
