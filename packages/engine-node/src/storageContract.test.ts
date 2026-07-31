/**
 * Storage contract suite.
 *
 * The engine treats every {@link Storage} backend as interchangeable, so the
 * in-memory store (`@otelux/engine`) and the durable SQLite store
 * (`@otelux/engine-node`) must answer identical queries identically. This suite
 * runs one battery of behavioral assertions against BOTH backends so a change
 * to either cannot silently drift from the other. It lives in `engine-node`
 * because that package can import the memory store from `@otelux/engine`, while
 * `@otelux/engine` cannot depend on `engine-node`.
 */

import { type Storage, createMemoryStorage } from '@otelux/engine';
import type { LogRecord, Metric, Span, SumMetric } from '@otelux/types';
import { AggregationTemporality, SpanKind, SpanStatusCode } from '@otelux/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSqliteStorage } from './index.js';

const TRACE_A = 'a'.repeat(32);
const TRACE_B = 'b'.repeat(32);

function makeSpan(args: {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	start: bigint;
	end: bigint;
	service?: string;
	status?: 0 | 1 | 2;
}): Span {
	const base: Omit<Span, 'parentSpanId'> = {
		traceId: args.traceId,
		spanId: args.spanId,
		name: args.name,
		kind: SpanKind.Server,
		startTimeUnixNano: args.start,
		endTimeUnixNano: args.end,
		status: { code: (args.status ?? SpanStatusCode.Unset) as 0 | 1 | 2 },
		attributes: {},
		resource: { attributes: { 'service.name': args.service ?? 'svc' } },
		scope: { name: 'scope' },
	};
	return args.parentSpanId === undefined ? base : { ...base, parentSpanId: args.parentSpanId };
}

function makeLog(args: {
	time: bigint;
	severity: number;
	body?: string;
	attributes?: Record<string, string | bigint>;
	traceId?: string;
	service?: string;
	scope?: string;
}): LogRecord {
	return {
		timeUnixNano: args.time,
		severityNumber: args.severity,
		...(args.body !== undefined ? { body: args.body } : {}),
		attributes: args.attributes ?? {},
		...(args.traceId !== undefined ? { traceId: args.traceId } : {}),
		resource: { attributes: { 'service.name': args.service ?? 'svc' } },
		scope: { name: args.scope ?? 'log-scope' },
	};
}

/** Run the full contract against a backend produced by `make`. */
function runStorageContract(label: string, make: () => Storage): void {
	describe(`storage contract: ${label}`, () => {
		let storage: Storage;
		beforeEach(() => {
			storage = make();
		});
		afterEach(async () => {
			await storage.close();
		});

		it('rolls up a trace from spans across writes', async () => {
			await storage.writeSpans([
				makeSpan({
					traceId: TRACE_A,
					spanId: '1'.repeat(16),
					name: 'GET /users',
					start: 100n,
					end: 500n,
					service: 'gateway',
					status: SpanStatusCode.Ok,
				}),
			]);
			await storage.writeSpans([
				makeSpan({
					traceId: TRACE_A,
					spanId: '2'.repeat(16),
					parentSpanId: '1'.repeat(16),
					name: 'db.query',
					start: 150n,
					end: 300n,
					service: 'db',
					status: SpanStatusCode.Error,
				}),
			]);

			const list = await storage.listTraces({});
			expect(list.totalCount).toBe(1);
			const row = list.rows[0];
			expect(row?.rootName).toBe('GET /users');
			expect(row?.spanCount).toBe(2);
			expect(row?.errorCount).toBe(1);
			expect(row?.durationNanos).toBe(400n);
			expect([...(row?.services ?? [])].sort()).toEqual(['db', 'gateway']);
		});

		it('reconstructs a full span and looks it up by id', async () => {
			const full: Span = {
				...makeSpan({
					traceId: TRACE_A,
					spanId: '1'.repeat(16),
					name: 'op',
					start: 100n,
					end: 200n,
					status: SpanStatusCode.Ok,
				}),
				attributes: { 'http.status_code': 200n, path: '/x', ok: true },
				traceState: 'a=b',
				events: [{ name: 'evt', timeUnixNano: 150n, attributes: { k: 'v' } }],
			};
			await storage.writeSpans([full]);

			expect(await storage.getSpan(TRACE_A, '1'.repeat(16))).toEqual(full);
			expect(await storage.getSpan(TRACE_A, 'deadbeefdeadbeef')).toBeUndefined();
			const spans = await storage.getTraceSpans(TRACE_A);
			expect(spans).toEqual([full]);
		});

		it('keeps equal span IDs isolated across traces', async () => {
			const sharedSpanId = 'f'.repeat(16);
			const spanA = makeSpan({
				traceId: TRACE_A,
				spanId: sharedSpanId,
				name: 'trace-a-span',
				start: 10n,
				end: 20n,
			});
			const spanB = makeSpan({
				traceId: TRACE_B,
				spanId: sharedSpanId,
				name: 'trace-b-span',
				start: 30n,
				end: 40n,
			});

			await storage.writeSpans([spanA, spanB]);

			expect(await storage.getSpan(TRACE_A, sharedSpanId)).toEqual(spanA);
			expect(await storage.getSpan(TRACE_B, sharedSpanId)).toEqual(spanB);
			expect(await storage.getTraceSpans(TRACE_A)).toEqual([spanA]);
			expect(await storage.getTraceSpans(TRACE_B)).toEqual([spanB]);
			expect((await storage.listTraces({})).totalCount).toBe(2);
		});

		it('replaces a repeated span identity within one trace', async () => {
			const spanId = 'e'.repeat(16);
			const initial = makeSpan({
				traceId: TRACE_A,
				spanId,
				name: 'initial',
				start: 10n,
				end: 20n,
				status: SpanStatusCode.Ok,
			});
			const updated = makeSpan({
				traceId: TRACE_A,
				spanId,
				name: 'updated',
				start: 10n,
				end: 30n,
				status: SpanStatusCode.Error,
			});

			await storage.writeSpans([initial]);
			await storage.writeSpans([updated]);

			expect(await storage.getTraceSpans(TRACE_A)).toEqual([updated]);
			expect(await storage.getSpan(TRACE_A, spanId)).toEqual(updated);
			expect((await storage.listTraces({})).rows[0]).toMatchObject({
				rootName: 'updated',
				spanCount: 1,
				errorCount: 1,
				durationNanos: 20n,
			});
		});

		it('filters, sorts, and pages the trace list', async () => {
			await storage.writeSpans([
				makeSpan({
					traceId: TRACE_A,
					spanId: '1'.repeat(16),
					name: 'happy',
					start: 10n,
					end: 20n,
					service: 'alpha',
					status: SpanStatusCode.Ok,
				}),
				makeSpan({
					traceId: TRACE_B,
					spanId: '2'.repeat(16),
					name: 'sad path',
					start: 30n,
					end: 90n,
					service: 'beta',
					status: SpanStatusCode.Error,
				}),
			]);

			expect((await storage.listTraces({ hasError: true })).rows[0]?.rootName).toBe('sad path');
			expect((await storage.listTraces({ hasError: false })).rows[0]?.rootName).toBe('happy');
			expect((await storage.listTraces({ search: 'happy' })).totalCount).toBe(1);
			expect((await storage.listTraces({ services: ['beta'] })).rows[0]?.rootName).toBe('sad path');
			expect((await storage.listTraces({ timeFromUnixNano: 25n })).rows[0]?.rootName).toBe('sad path');

			const byDuration = await storage.listTraces({ sortBy: 'duration', sortDirection: 'desc' });
			expect(byDuration.rows.map((r) => r.rootName)).toEqual(['sad path', 'happy']);

			const paged = await storage.listTraces({
				limit: 1,
				offset: 1,
				sortBy: 'startTime',
				sortDirection: 'asc',
			});
			expect(paged.totalCount).toBe(2);
			expect(paged.rows.map((r) => r.rootName)).toEqual(['sad path']);
		});

		it('applies trace service filtering before count and pagination', async () => {
			await storage.writeSpans([
				makeSpan({
					traceId: TRACE_A,
					spanId: '1'.repeat(16),
					name: 'older-beta',
					start: 10n,
					end: 20n,
					service: 'beta',
				}),
				makeSpan({
					traceId: TRACE_B,
					spanId: '2'.repeat(16),
					name: 'newer-alpha',
					start: 30n,
					end: 40n,
					service: 'alpha',
				}),
			]);

			const result = await storage.listTraces({
				services: ['beta'],
				limit: 1,
				sortBy: 'startTime',
				sortDirection: 'desc',
			});
			expect(result.totalCount).toBe(1);
			expect(result.rows.map((row) => row.rootName)).toEqual(['older-beta']);
		});

		it('returns grouped service facets without transferring raw telemetry', async () => {
			await storage.writeSpans([
				makeSpan({
					traceId: TRACE_A,
					spanId: '1'.repeat(16),
					name: 'a',
					start: 1n,
					end: 2n,
					service: 'api',
				}),
				makeSpan({
					traceId: TRACE_B,
					spanId: '2'.repeat(16),
					name: 'b',
					start: 3n,
					end: 4n,
					service: 'api',
				}),
			]);
			await storage.writeLogs([
				makeLog({ time: 1n, severity: 9, service: 'api' }),
				makeLog({ time: 2n, severity: 9, service: 'worker' }),
			]);
			await storage.writeMetrics([
				{
					type: 'gauge',
					name: 'queue.depth',
					resource: { attributes: { 'service.name': 'worker' } },
					scope: { name: 'meter' },
					dataPoints: [{ timeUnixNano: 1n, value: 1, attributes: {} }],
				},
			]);

			expect(await storage.listServiceFacets({ signal: 'traces' })).toEqual({
				rows: [{ name: 'api', count: 2 }],
			});
			expect(await storage.listServiceFacets({ signal: 'logs' })).toEqual({
				rows: [
					{ name: 'api', count: 1 },
					{ name: 'worker', count: 1 },
				],
			});
			expect(await storage.listServiceFacets({ signal: 'metrics' })).toEqual({
				rows: [{ name: 'worker', count: 1 }],
			});
		});

		it('filters logs by severity, trace, service, scope, and attribute text', async () => {
			await storage.writeLogs([
				makeLog({ time: 10n, severity: 9, body: 'info line', service: 'a', scope: 's1' }),
				makeLog({
					time: 20n,
					severity: 17,
					attributes: { prompt: 'summarize the repo', id: 9_007_199_254_740_993n },
					traceId: TRACE_A,
					service: 'b',
					scope: 's2',
				}),
			]);

			expect((await storage.listLogs({ minSeverity: 13 })).totalCount).toBe(1);
			expect((await storage.listLogs({ traceId: TRACE_A })).rows[0]?.severityNumber).toBe(17);
			expect((await storage.listLogs({ services: ['a'] })).totalCount).toBe(1);
			expect((await storage.listLogs({ scopes: ['s2'] })).totalCount).toBe(1);
			// Free-text search must hit attribute values, not just the body.
			expect((await storage.listLogs({ search: 'summarize' })).totalCount).toBe(1);
			expect((await storage.listLogs({ search: 'nope' })).totalCount).toBe(0);
			// bigint attribute round-trips losslessly.
			const hit = (await storage.listLogs({ traceId: TRACE_A })).rows[0];
			expect(hit?.attributes.id).toBe(9_007_199_254_740_993n);
		});

		it('sorts logs by time descending by default and pages', async () => {
			await storage.writeLogs([
				makeLog({ time: 10n, severity: 9, body: 'first' }),
				makeLog({ time: 30n, severity: 9, body: 'third' }),
				makeLog({ time: 20n, severity: 9, body: 'second' }),
			]);
			expect((await storage.listLogs({})).rows.map((r) => r.body)).toEqual([
				'third',
				'second',
				'first',
			]);
			const page = await storage.listLogs({ limit: 1, offset: 1 });
			expect(page.totalCount).toBe(3);
			expect(page.rows.map((r) => r.body)).toEqual(['second']);
		});

		it('merges repeated exports of one instrument into a single series', async () => {
			const base: Omit<SumMetric, 'dataPoints'> = {
				type: 'sum',
				name: 'codex.tokens',
				isMonotonic: true,
				temporality: AggregationTemporality.Delta,
				resource: { attributes: { 'service.name': 'codex' } },
				scope: { name: 'codex-meter' },
			};
			await storage.writeMetrics([
				{ ...base, dataPoints: [{ timeUnixNano: 1n, value: 5, attributes: {} }] },
			]);
			await storage.writeMetrics([
				{ ...base, dataPoints: [{ timeUnixNano: 2n, value: 7, attributes: {} }] },
			]);

			const list = await storage.listMetrics({});
			expect(list.totalCount).toBe(1);
			const metric = list.rows[0] as SumMetric;
			expect(metric.type).toBe('sum');
			expect(metric.dataPoints.map((p) => p.value)).toEqual([5, 7]);
			const recent = (await storage.listMetrics({ pointLimit: 1 })).rows[0] as SumMetric;
			expect(recent.dataPoints.map((p) => p.value)).toEqual([7]);
		});

		it('stores gauge and histogram instruments and filters by service/meter', async () => {
			const gauge: Metric = {
				type: 'gauge',
				name: 'queue.depth',
				resource: { attributes: { 'service.name': 'one' } },
				scope: { name: 'meterA' },
				dataPoints: [{ timeUnixNano: 1n, value: 3, attributes: {} }],
			};
			const histogram: Metric = {
				type: 'histogram',
				name: 'turn.duration_ms',
				temporality: AggregationTemporality.Delta,
				resource: { attributes: { 'service.name': 'two' } },
				scope: { name: 'meterB' },
				dataPoints: [
					{
						timeUnixNano: 1n,
						count: 2,
						sum: 30,
						min: 10,
						max: 20,
						bucketCounts: [0, 1, 1],
						explicitBounds: [10, 20],
						attributes: {},
					},
				],
			};
			await storage.writeMetrics([gauge, histogram]);

			expect((await storage.listMetrics({})).totalCount).toBe(2);
			const byName = new Map((await storage.listMetrics({})).rows.map((m) => [m.name, m] as const));
			expect(byName.get('queue.depth')).toEqual(gauge);
			expect(byName.get('turn.duration_ms')).toEqual(histogram);
			expect((await storage.listMetrics({ services: ['one'] })).rows[0]?.name).toBe('queue.depth');
			expect((await storage.listMetrics({ meters: ['meterB'] })).rows[0]?.name).toBe(
				'turn.duration_ms',
			);
		});

		it('clear() empties every signal and the store stays writable', async () => {
			await storage.writeSpans([
				makeSpan({ traceId: TRACE_A, spanId: '1'.repeat(16), name: 'op', start: 1n, end: 2n }),
			]);
			await storage.writeLogs([makeLog({ time: 1n, severity: 9, body: 'x' })]);
			await storage.writeMetrics([
				{
					type: 'gauge',
					name: 'g',
					resource: { attributes: { 'service.name': 'svc' } },
					scope: { name: 'm' },
					dataPoints: [{ timeUnixNano: 1n, value: 1, attributes: {} }],
				},
			]);

			await storage.clear();

			expect((await storage.listTraces({})).totalCount).toBe(0);
			expect((await storage.listLogs({})).totalCount).toBe(0);
			expect((await storage.listMetrics({})).totalCount).toBe(0);

			// Writing after a clear must still work — for SQLite this proves the
			// interner cache was reset so resource/scope ids are re-created rather
			// than pointing at deleted rows.
			await storage.writeLogs([makeLog({ time: 5n, severity: 9, body: 'after-clear' })]);
			const logs = await storage.listLogs({});
			expect(logs.totalCount).toBe(1);
			expect(logs.rows[0]?.body).toBe('after-clear');
		});
	});
}

runStorageContract('memory', () => createMemoryStorage());
runStorageContract('sqlite', () =>
	createNodeSqliteStorage({ path: ':memory:', pruneIntervalMs: 0 }),
);
