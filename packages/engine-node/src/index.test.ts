import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GaugeMetric, HistogramMetric, LogRecord, Span, SumMetric } from '@otelux/types';
import { AggregationTemporality, SpanKind, SpanStatusCode } from '@otelux/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	type NodeSqliteStorage,
	OTELUX_ENGINE_NODE_VERSION,
	createNodeSqliteStorage,
} from './index.js';

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
		scope: { name: 'test-scope' },
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
	const record: LogRecord = {
		timeUnixNano: args.time,
		severityNumber: args.severity,
		...(args.body !== undefined ? { body: args.body } : {}),
		attributes: args.attributes ?? {},
		...(args.traceId !== undefined ? { traceId: args.traceId } : {}),
		resource: { attributes: { 'service.name': args.service ?? 'svc' } },
		scope: { name: args.scope ?? 'log-scope' },
	};
	return record;
}

describe('@otelux/engine-node metadata', () => {
	it('reports kind and version', () => {
		const storage = createNodeSqliteStorage({ path: ':memory:', pruneIntervalMs: 0 });
		expect(storage.kind).toBe('otelux/storage');
		expect(OTELUX_ENGINE_NODE_VERSION).toBe('0.1.0');
		storage.close();
	});
});

describe('@otelux/engine-node spans', () => {
	let storage: NodeSqliteStorage;
	beforeEach(() => {
		storage = createNodeSqliteStorage({ path: ':memory:', pruneIntervalMs: 0 });
	});
	afterEach(() => storage.close());

	it('rolls up a trace across multiple spans and exports', () => {
		storage.writeSpans([
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
		// Child arrives in a later export; rollup must recompute.
		storage.writeSpans([
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

		const list = storage.listTraces({});
		expect(list.totalCount).toBe(1);
		const row = list.rows[0];
		expect(row?.rootName).toBe('GET /users');
		expect(row?.spanCount).toBe(2);
		expect(row?.errorCount).toBe(1);
		expect(row?.durationNanos).toBe(400n);
		expect([...(row?.services ?? [])].sort()).toEqual(['db', 'gateway']);
	});

	it('reconstructs spans exactly via getTraceSpans and getSpan', () => {
		const span = makeSpan({
			traceId: TRACE_A,
			spanId: '1'.repeat(16),
			name: 'op',
			start: 100n,
			end: 200n,
			status: SpanStatusCode.Ok,
		});
		const full: Span = {
			...span,
			attributes: { 'http.status_code': 200n, path: '/x', ok: true },
			traceState: 'a=b',
			events: [{ name: 'evt', timeUnixNano: 150n, attributes: { k: 'v' } }],
		};
		storage.writeSpans([full]);

		expect(storage.getSpan(TRACE_A, '1'.repeat(16))).toEqual(full);
		expect(storage.getTraceSpans(TRACE_A)).toEqual([full]);
		expect(storage.getSpan(TRACE_A, 'deadbeefdeadbeef')).toBeUndefined();
	});

	it('filters, sorts, and pages the trace list', () => {
		storage.writeSpans([
			makeSpan({
				traceId: TRACE_A,
				spanId: '1'.repeat(16),
				name: 'happy',
				start: 10n,
				end: 20n,
				status: SpanStatusCode.Ok,
			}),
			makeSpan({
				traceId: TRACE_B,
				spanId: '2'.repeat(16),
				name: 'sad path',
				start: 30n,
				end: 90n,
				status: SpanStatusCode.Error,
			}),
		]);

		expect(storage.listTraces({ hasError: true }).rows[0]?.rootName).toBe('sad path');
		expect(storage.listTraces({ search: 'happy' }).totalCount).toBe(1);
		expect(storage.listTraces({ timeFromUnixNano: 25n }).rows[0]?.rootName).toBe('sad path');

		const byDuration = storage.listTraces({ sortBy: 'duration', sortDirection: 'desc' });
		expect(byDuration.rows.map((r) => r.rootName)).toEqual(['sad path', 'happy']);

		const paged = storage.listTraces({
			limit: 1,
			offset: 1,
			sortBy: 'startTime',
			sortDirection: 'asc',
		});
		expect(paged.totalCount).toBe(2);
		expect(paged.rows).toHaveLength(1);
		expect(paged.rows[0]?.rootName).toBe('sad path');
	});
});

describe('@otelux/engine-node logs', () => {
	let storage: NodeSqliteStorage;
	beforeEach(() => {
		storage = createNodeSqliteStorage({ path: ':memory:', pruneIntervalMs: 0 });
	});
	afterEach(() => storage.close());

	it('filters by severity, trace, service, scope, and attribute text', () => {
		storage.writeLogs([
			makeLog({ time: 10n, severity: 9, body: 'info line', service: 'a', scope: 's1' }),
			makeLog({
				time: 20n,
				severity: 17,
				attributes: { prompt: 'summarize the repo' },
				traceId: TRACE_A,
				service: 'b',
				scope: 's2',
			}),
		]);

		expect(storage.listLogs({ minSeverity: 13 }).totalCount).toBe(1);
		expect(storage.listLogs({ traceId: TRACE_A }).rows[0]?.severityNumber).toBe(17);
		expect(storage.listLogs({ services: ['a'] }).totalCount).toBe(1);
		expect(storage.listLogs({ scopes: ['s2'] }).totalCount).toBe(1);
		// Free-text search must hit attribute values, not just the body.
		expect(storage.listLogs({ search: 'summarize' }).totalCount).toBe(1);
		expect(storage.listLogs({ search: 'nope' }).totalCount).toBe(0);
	});

	it('round-trips a bigint attribute losslessly', () => {
		storage.writeLogs([
			makeLog({ time: 1n, severity: 9, attributes: { id: 9_007_199_254_740_993n } }),
		]);
		const log = storage.listLogs({}).rows[0];
		expect(log?.attributes.id).toBe(9_007_199_254_740_993n);
	});

	it('sorts by time desc by default', () => {
		storage.writeLogs([
			makeLog({ time: 10n, severity: 9, body: 'first' }),
			makeLog({ time: 30n, severity: 9, body: 'third' }),
			makeLog({ time: 20n, severity: 9, body: 'second' }),
		]);
		expect(storage.listLogs({}).rows.map((r) => r.body)).toEqual(['third', 'second', 'first']);
	});
});

describe('@otelux/engine-node metrics', () => {
	let storage: NodeSqliteStorage;
	beforeEach(() => {
		storage = createNodeSqliteStorage({ path: ':memory:', pruneIntervalMs: 0 });
	});
	afterEach(() => storage.close());

	it('merges repeated exports of the same instrument into one series', () => {
		const base: Omit<SumMetric, 'dataPoints'> = {
			type: 'sum',
			name: 'codex.tokens',
			isMonotonic: true,
			temporality: AggregationTemporality.Delta,
			resource: { attributes: { 'service.name': 'codex' } },
			scope: { name: 'codex-meter' },
		};
		storage.writeMetrics([{ ...base, dataPoints: [{ timeUnixNano: 1n, value: 5, attributes: {} }] }]);
		storage.writeMetrics([{ ...base, dataPoints: [{ timeUnixNano: 2n, value: 7, attributes: {} }] }]);

		const list = storage.listMetrics({});
		expect(list.totalCount).toBe(1);
		const metric = list.rows[0] as SumMetric;
		expect(metric.type).toBe('sum');
		expect(metric.dataPoints.map((p) => p.value)).toEqual([5, 7]);
	});

	it('stores gauge and histogram instruments with their points', () => {
		const gauge: GaugeMetric = {
			type: 'gauge',
			name: 'queue.depth',
			resource: { attributes: { 'service.name': 'svc' } },
			scope: { name: 'm' },
			dataPoints: [{ timeUnixNano: 1n, value: 3, attributes: {} }],
		};
		const histogram: HistogramMetric = {
			type: 'histogram',
			name: 'turn.duration_ms',
			temporality: AggregationTemporality.Delta,
			resource: { attributes: { 'service.name': 'svc' } },
			scope: { name: 'm' },
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
		storage.writeMetrics([gauge, histogram]);

		const rows = storage.listMetrics({});
		expect(rows.totalCount).toBe(2);
		const byName = new Map(rows.rows.map((m) => [m.name, m]));
		expect(byName.get('queue.depth')).toEqual(gauge);
		expect(byName.get('turn.duration_ms')).toEqual(histogram);
	});

	it('filters instruments by service, meter, and search', () => {
		storage.writeMetrics([
			{
				type: 'gauge',
				name: 'alpha',
				resource: { attributes: { 'service.name': 'one' } },
				scope: { name: 'meterA' },
				dataPoints: [{ timeUnixNano: 1n, value: 1, attributes: {} }],
			},
			{
				type: 'gauge',
				name: 'beta',
				resource: { attributes: { 'service.name': 'two' } },
				scope: { name: 'meterB' },
				dataPoints: [{ timeUnixNano: 1n, value: 1, attributes: {} }],
			},
		]);
		expect(storage.listMetrics({ services: ['one'] }).rows[0]?.name).toBe('alpha');
		expect(storage.listMetrics({ meters: ['meterB'] }).rows[0]?.name).toBe('beta');
		expect(storage.listMetrics({ search: 'alph' }).totalCount).toBe(1);
	});
});

describe('@otelux/engine-node persistence', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'otelux-sqlite-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('survives close and reopen', () => {
		const path = join(dir, 'otelux.db');
		const first = createNodeSqliteStorage({ path, pruneIntervalMs: 0 });
		first.writeSpans([
			makeSpan({ traceId: TRACE_A, spanId: '1'.repeat(16), name: 'op', start: 1n, end: 2n }),
		]);
		first.writeLogs([makeLog({ time: 1n, severity: 9, body: 'persisted' })]);
		first.close();

		const second = createNodeSqliteStorage({ path, pruneIntervalMs: 0 });
		expect(second.listTraces({}).totalCount).toBe(1);
		expect(second.listLogs({}).rows[0]?.body).toBe('persisted');
		second.close();
	});
});

describe('@otelux/engine-node retention', () => {
	it('prunes telemetry older than the age bound', () => {
		let clock = 1_000_000_000_000_000_000n;
		const storage = createNodeSqliteStorage({
			path: ':memory:',
			pruneIntervalMs: 0,
			retention: { maxAgeHours: 1, maxSizeMb: 0 },
			now: () => clock,
		});
		storage.writeSpans([
			makeSpan({ traceId: TRACE_A, spanId: '1'.repeat(16), name: 'old', start: 1n, end: 2n }),
		]);
		storage.writeLogs([makeLog({ time: 1n, severity: 9, body: 'old' })]);

		// Advance 2 hours, add fresh data, then prune.
		clock += 2n * 3_600_000_000_000n;
		storage.writeSpans([
			makeSpan({ traceId: TRACE_B, spanId: '2'.repeat(16), name: 'new', start: 1n, end: 2n }),
		]);
		storage.writeLogs([makeLog({ time: 1n, severity: 9, body: 'new' })]);
		storage.prune();

		const traces = storage.listTraces({});
		expect(traces.totalCount).toBe(1);
		expect(traces.rows[0]?.rootName).toBe('new');
		const logs = storage.listLogs({});
		expect(logs.totalCount).toBe(1);
		expect(logs.rows[0]?.body).toBe('new');
		storage.close();
	});

	it('prunes oldest telemetry when over the size bound', () => {
		const dir = mkdtempSync(join(tmpdir(), 'otelux-sqlite-size-'));
		let clock = 1n;
		const storage = createNodeSqliteStorage({
			// Size accounting (page_count) only shrinks on a real file, so this
			// case uses an on-disk DB rather than :memory:.
			path: join(dir, 'otelux.db'),
			pruneIntervalMs: 0,
			// 2 MB cap; each log carries a ~2 KB body so a few thousand exceed it.
			retention: { maxAgeHours: 0, maxSizeMb: 2 },
			now: () => clock++,
		});
		try {
			const filler = 'x'.repeat(2048);
			for (let i = 0; i < 4000; i++) {
				storage.writeLogs([makeLog({ time: BigInt(i), severity: 9, body: `${i}:${filler}` })]);
			}
			storage.prune();

			const after = storage.listLogs({ limit: 100000 });
			// Oldest rows were pruned (fewer than we wrote) but the store keeps a
			// working set near the cap rather than emptying itself.
			expect(after.totalCount).toBeGreaterThan(0);
			expect(after.totalCount).toBeLessThan(4000);
			// The survivors are the newest logs (highest time), not the oldest.
			expect(after.rows[0]?.body?.toString().startsWith('3999:')).toBe(true);
		} finally {
			storage.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
