import type { LogRecord, Metric, Span } from '@otelux/types';
import { AggregationTemporality, SeverityNumber, SpanKind, SpanStatusCode } from '@otelux/types';

/**
 * Synthetic first-run telemetry.
 *
 * A brand-new user with no exporter wired up would otherwise land on an empty
 * workbench. `createDemoTelemetry` produces a small, coherent, and obviously
 * *sample* dataset — a distributed trace with an error, correlated logs across
 * severity levels, and a counter/histogram/gauge — so every surface (traces,
 * logs, metrics, span detail, filters, trace↔log correlation) can be explored
 * immediately. Service names are prefixed `otelux-demo-` and a banner log states
 * it is sample data, so it can never be mistaken for the user's real telemetry.
 *
 * The data is ingested through the normal engine path, so it persists and is
 * pruned by retention exactly like real telemetry; the user can clear it by
 * deleting the database or letting retention age it out.
 */

export interface DemoTelemetry {
	readonly spans: readonly Span[];
	readonly logs: readonly LogRecord[];
	readonly metrics: readonly Metric[];
}

export interface DemoTelemetryOptions {
	/** Wall-clock reference in Unix nanoseconds. Defaults to now. */
	readonly now?: bigint;
	/** OTLP port surfaced in the sample banner log. Defaults to 4319. */
	readonly otlpPort?: number;
}

// Fixed IDs so the demo trace is stable and its logs can reference it. These
// are plainly synthetic (repeating nibble patterns) rather than random.
const TRACE_CHECKOUT = 'de300000000000000000000000000001';
const TRACE_HEALTH = 'de300000000000000000000000000002';
const SPAN_WEB = 'de30000000000001';
const SPAN_API = 'de30000000000002';
const SPAN_DB = 'de30000000000003';
const SPAN_CACHE = 'de30000000000004';
const SPAN_HEALTH = 'de30000000000005';

const MS = 1_000_000n; // nanoseconds per millisecond

const WEB = { attributes: { 'service.name': 'otelux-demo-web', 'otelux.sample': true } } as const;
const API = { attributes: { 'service.name': 'otelux-demo-api', 'otelux.sample': true } } as const;
const DB = { attributes: { 'service.name': 'otelux-demo-db', 'otelux.sample': true } } as const;

const HTTP_SCOPE = { name: 'otelux.demo.http' } as const;
const DB_SCOPE = { name: 'otelux.demo.db' } as const;

export function createDemoTelemetry(options: DemoTelemetryOptions = {}): DemoTelemetry {
	const now = options.now ?? BigInt(Date.now()) * MS;
	const port = options.otlpPort ?? 4319;
	// Anchor the checkout trace to ~2 seconds ago so it reads as "just now".
	const base = now - 2_000n * MS;

	const spans: Span[] = [
		{
			traceId: TRACE_CHECKOUT,
			spanId: SPAN_WEB,
			name: 'GET /checkout',
			kind: SpanKind.Server,
			startTimeUnixNano: base,
			endTimeUnixNano: base + 120n * MS,
			status: { code: SpanStatusCode.Ok },
			attributes: {
				'http.request.method': 'GET',
				'http.route': '/checkout',
				'http.response.status_code': 200n,
				'url.path': '/checkout',
			},
			resource: WEB,
			scope: HTTP_SCOPE,
		},
		{
			traceId: TRACE_CHECKOUT,
			spanId: SPAN_API,
			parentSpanId: SPAN_WEB,
			name: 'POST /orders',
			kind: SpanKind.Client,
			startTimeUnixNano: base + 5n * MS,
			endTimeUnixNano: base + 110n * MS,
			status: { code: SpanStatusCode.Ok },
			attributes: {
				'http.request.method': 'POST',
				'http.route': '/orders',
				'server.address': 'otelux-demo-api',
			},
			resource: API,
			scope: HTTP_SCOPE,
		},
		{
			traceId: TRACE_CHECKOUT,
			spanId: SPAN_CACHE,
			parentSpanId: SPAN_API,
			name: 'cache.get cart',
			kind: SpanKind.Client,
			startTimeUnixNano: base + 10n * MS,
			endTimeUnixNano: base + 16n * MS,
			status: { code: SpanStatusCode.Ok },
			attributes: { 'db.system': 'redis', 'cache.hit': false },
			resource: API,
			scope: DB_SCOPE,
		},
		{
			traceId: TRACE_CHECKOUT,
			spanId: SPAN_DB,
			parentSpanId: SPAN_API,
			name: 'SELECT orders',
			kind: SpanKind.Client,
			startTimeUnixNano: base + 40n * MS,
			endTimeUnixNano: base + 95n * MS,
			status: { code: SpanStatusCode.Error, message: 'deadlock detected' },
			attributes: {
				'db.system': 'postgresql',
				'db.statement': 'SELECT * FROM orders WHERE user_id = $1 FOR UPDATE',
				'db.name': 'shop',
			},
			resource: DB,
			scope: DB_SCOPE,
		},
		{
			traceId: TRACE_HEALTH,
			spanId: SPAN_HEALTH,
			name: 'GET /health',
			kind: SpanKind.Server,
			startTimeUnixNano: base + 500n * MS,
			endTimeUnixNano: base + 503n * MS,
			status: { code: SpanStatusCode.Ok },
			attributes: {
				'http.request.method': 'GET',
				'http.route': '/health',
				'http.response.status_code': 200n,
			},
			resource: WEB,
			scope: HTTP_SCOPE,
		},
	];

	const logs: LogRecord[] = [
		{
			timeUnixNano: now,
			observedTimeUnixNano: now,
			severityNumber: SeverityNumber.Info,
			severityText: 'INFO',
			body: `This is OTelux sample data. Send your own telemetry to http://127.0.0.1:${port}/v1/{traces,logs,metrics} — then clear this via retention or a fresh database.`,
			attributes: { 'otelux.sample': true },
			resource: WEB,
			scope: HTTP_SCOPE,
		},
		{
			timeUnixNano: base + 2n * MS,
			severityNumber: SeverityNumber.Info,
			severityText: 'INFO',
			body: 'checkout started for user 1234',
			attributes: { 'otelux.sample': true, 'enduser.id': '1234' },
			traceId: TRACE_CHECKOUT,
			spanId: SPAN_WEB,
			resource: WEB,
			scope: HTTP_SCOPE,
		},
		{
			timeUnixNano: base + 16n * MS,
			severityNumber: SeverityNumber.Warn,
			severityText: 'WARN',
			body: 'cache miss for cart:1234',
			attributes: { 'otelux.sample': true, 'cache.key': 'cart:1234' },
			traceId: TRACE_CHECKOUT,
			spanId: SPAN_CACHE,
			resource: API,
			scope: DB_SCOPE,
		},
		{
			timeUnixNano: base + 95n * MS,
			severityNumber: SeverityNumber.Error,
			severityText: 'ERROR',
			body: 'order db query failed: deadlock detected',
			attributes: { 'otelux.sample': true, 'db.system': 'postgresql', 'error.type': 'deadlock' },
			traceId: TRACE_CHECKOUT,
			spanId: SPAN_DB,
			resource: DB,
			scope: DB_SCOPE,
		},
		{
			// A Codex-style event whose payload rides attributes, showcasing that
			// log search matches attribute values, not just the body.
			timeUnixNano: base + 120n * MS,
			severityNumber: SeverityNumber.Info,
			severityText: 'INFO',
			eventName: 'codex.user_prompt',
			attributes: {
				'otelux.sample': true,
				'event.name': 'codex.user_prompt',
				prompt: 'Summarize why the checkout request returned an error.',
				model: 'demo-model',
			},
			resource: API,
			scope: { name: 'codex' },
		},
	];

	const metrics: Metric[] = [
		{
			type: 'sum',
			name: 'otelux.demo.http.server.requests',
			description: 'Sample request counter',
			unit: '{request}',
			isMonotonic: true,
			temporality: AggregationTemporality.Delta,
			resource: WEB,
			scope: HTTP_SCOPE,
			dataPoints: [
				{
					timeUnixNano: base + 120n * MS,
					value: 1,
					attributes: { 'http.route': '/checkout', 'http.response.status_code': 200n },
				},
				{
					timeUnixNano: base + 503n * MS,
					value: 1,
					attributes: { 'http.route': '/health', 'http.response.status_code': 200n },
				},
			],
		},
		{
			type: 'histogram',
			name: 'otelux.demo.http.server.duration_ms',
			description: 'Sample request duration distribution',
			unit: 'ms',
			temporality: AggregationTemporality.Delta,
			resource: WEB,
			scope: HTTP_SCOPE,
			dataPoints: [
				{
					timeUnixNano: now,
					count: 2,
					sum: 123,
					min: 3,
					max: 120,
					bucketCounts: [0, 1, 0, 1, 0],
					explicitBounds: [5, 25, 100, 250],
					attributes: { 'http.route': '/checkout' },
				},
			],
		},
		{
			type: 'gauge',
			name: 'otelux.demo.db.active_connections',
			description: 'Sample active DB connections',
			unit: '{connection}',
			resource: DB,
			scope: DB_SCOPE,
			dataPoints: [{ timeUnixNano: now, value: 7, attributes: { 'db.system': 'postgresql' } }],
		},
	];

	return { spans, logs, metrics };
}
