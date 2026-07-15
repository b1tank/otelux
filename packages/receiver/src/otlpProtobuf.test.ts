import type { LogRecord, Metric, Span } from '@otelux/types';
import { describe, expect, it } from 'vitest';
import { decodeExportTraceServiceRequest } from './otlp.js';
import { decodeExportLogsServiceRequest } from './otlpLogs.js';
import { decodeExportMetricsServiceRequest } from './otlpMetrics.js';
import {
	decodeLogsRequestFromProtobuf,
	decodeMetricsRequestFromProtobuf,
	decodeTraceRequestFromProtobuf,
} from './otlpProtobuf.js';
import { ProtoWriter, hexToBytes } from './protoTestEncoder.js';

const TRACE_ID = 'abcdef1234567890abcdef1234567890';
const SPAN_ID = '1111111111111111';

// AnyValue { string_value = 1 }
function anyString(s: string): ProtoWriter {
	return new ProtoWriter().stringField(1, s);
}
// AnyValue { int_value = 3 }
function anyInt(v: number): ProtoWriter {
	return new ProtoWriter().varintField(3, v);
}
// KeyValue { key = 1, value = 2 }
function keyValue(key: string, value: ProtoWriter): ProtoWriter {
	return new ProtoWriter().stringField(1, key).messageField(2, value);
}
// Resource { attributes = 1 } with a single service.name.
function resource(serviceName: string): ProtoWriter {
	return new ProtoWriter().messageField(1, keyValue('service.name', anyString(serviceName)));
}
// InstrumentationScope { name = 1 }
function scope(name: string): ProtoWriter {
	return new ProtoWriter().stringField(1, name);
}

describe('decodeTraceRequestFromProtobuf', () => {
	it('decodes a span with attributes and status to the same shape as JSON', () => {
		const span = new ProtoWriter()
			.bytesField(1, hexToBytes(TRACE_ID)) // trace_id
			.bytesField(2, hexToBytes(SPAN_ID)) // span_id
			.stringField(5, 'GET /users') // name
			.varintField(6, 2) // kind = Server
			.fixed64Field(7, 1_700_000_000_000_000_000n) // start_time_unix_nano
			.fixed64Field(8, 1_700_000_000_045_000_000n) // end_time_unix_nano
			.messageField(9, keyValue('http.method', anyString('GET'))) // attribute (string)
			.messageField(9, keyValue('http.status_code', anyInt(200))) // attribute (int64)
			.messageField(15, new ProtoWriter().varintField(3, 1)); // status.code = Ok
		const scopeSpans = new ProtoWriter().messageField(1, scope('http')).messageField(2, span);
		const resourceSpans = new ProtoWriter()
			.messageField(1, resource('api'))
			.messageField(2, scopeSpans);
		const bytes = new ProtoWriter().messageField(1, resourceSpans).finish();

		const spans = decodeExportTraceServiceRequest(decodeTraceRequestFromProtobuf(bytes));

		const expected: Span = {
			traceId: TRACE_ID,
			spanId: SPAN_ID,
			name: 'GET /users',
			kind: 2,
			startTimeUnixNano: 1_700_000_000_000_000_000n,
			endTimeUnixNano: 1_700_000_000_045_000_000n,
			status: { code: 1 },
			attributes: { 'http.method': 'GET', 'http.status_code': 200n },
			resource: { attributes: { 'service.name': 'api' } },
			scope: { name: 'http' },
		};
		expect(spans).toEqual([expected]);
	});
});

describe('decodeLogsRequestFromProtobuf', () => {
	it('decodes a log record, falling back to observed time when explicit is unset', () => {
		const record = new ProtoWriter()
			.varintField(2, 9) // severity_number = INFO
			.stringField(3, 'INFO') // severity_text
			.messageField(6, keyValue('prompt', anyString('summarize the repo'))) // attribute
			.fixed64Field(11, 1_750_000_000_000_000_000n) // observed_time_unix_nano
			.stringField(12, 'codex.user_prompt'); // event_name
		const scopeLogs = new ProtoWriter().messageField(1, scope('codex')).messageField(2, record);
		const resourceLogs = new ProtoWriter()
			.messageField(1, resource('codex_exec'))
			.messageField(2, scopeLogs);
		const bytes = new ProtoWriter().messageField(1, resourceLogs).finish();

		const logs = decodeExportLogsServiceRequest(decodeLogsRequestFromProtobuf(bytes));

		const expected: LogRecord = {
			timeUnixNano: 1_750_000_000_000_000_000n,
			observedTimeUnixNano: 1_750_000_000_000_000_000n,
			severityNumber: 9,
			severityText: 'INFO',
			eventName: 'codex.user_prompt',
			attributes: { prompt: 'summarize the repo' },
			resource: { attributes: { 'service.name': 'codex_exec' } },
			scope: { name: 'codex' },
		};
		expect(logs).toEqual([expected]);
	});
});

describe('decodeMetricsRequestFromProtobuf', () => {
	it('decodes sum and histogram instruments with their data points', () => {
		// Sum { data_points = 1, aggregation_temporality = 2, is_monotonic = 3 }
		const sumPoint = new ProtoWriter()
			.fixed64Field(3, 1_750_000_000_000_000_000n) // time_unix_nano
			.fixed64Field(6, 5); // as_int (sfixed64)
		const sum = new ProtoWriter()
			.messageField(1, sumPoint)
			.varintField(2, 1) // delta
			.varintField(3, 1); // is_monotonic = true
		const sumMetric = new ProtoWriter()
			.stringField(1, 'codex.tokens') // name
			.stringField(3, '{token}') // unit
			.messageField(7, sum); // sum

		// Histogram { data_points = 1, aggregation_temporality = 2 }
		const histPoint = new ProtoWriter()
			.fixed64Field(3, 1_750_000_000_000_000_000n) // time_unix_nano
			.fixed64Field(4, 2) // count
			.doubleField(5, 30) // sum
			.packedFixed64Field(6, [0, 1, 1]) // bucket_counts
			.packedDoubleField(7, [10, 20]) // explicit_bounds
			.doubleField(11, 10) // min
			.doubleField(12, 20); // max
		const histogram = new ProtoWriter().messageField(1, histPoint).varintField(2, 1);
		const histMetric = new ProtoWriter().stringField(1, 'codex.dur_ms').messageField(9, histogram);

		const scopeMetrics = new ProtoWriter()
			.messageField(1, scope('codex-meter'))
			.messageField(2, sumMetric)
			.messageField(2, histMetric);
		const resourceMetrics = new ProtoWriter()
			.messageField(1, resource('codex'))
			.messageField(2, scopeMetrics);
		const bytes = new ProtoWriter().messageField(1, resourceMetrics).finish();

		const metrics = decodeExportMetricsServiceRequest(decodeMetricsRequestFromProtobuf(bytes));

		const res = { attributes: { 'service.name': 'codex' } };
		const scp = { name: 'codex-meter' };
		const expected: Metric[] = [
			{
				name: 'codex.tokens',
				unit: '{token}',
				type: 'sum',
				isMonotonic: true,
				temporality: 1,
				resource: res,
				scope: scp,
				dataPoints: [{ timeUnixNano: 1_750_000_000_000_000_000n, value: 5, attributes: {} }],
			},
			{
				name: 'codex.dur_ms',
				type: 'histogram',
				temporality: 1,
				resource: res,
				scope: scp,
				dataPoints: [
					{
						timeUnixNano: 1_750_000_000_000_000_000n,
						count: 2,
						sum: 30,
						min: 10,
						max: 20,
						bucketCounts: [0, 1, 1],
						explicitBounds: [10, 20],
						attributes: {},
					},
				],
			},
		];
		expect(metrics).toEqual(expected);
	});
});
