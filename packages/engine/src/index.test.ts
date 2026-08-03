import type { Span } from '@otelux/types';
import { SpanKind, SpanStatusCode } from '@otelux/types';
import { describe, expect, it } from 'vitest';
import {
	computeWaterfallLayout,
	createEngine,
	createMemoryStorage,
	traceFromSpans,
} from './index.js';

const RESOURCE = {
	attributes: { 'service.name': 'api-gateway' },
} as const;
const SCOPE = { name: 'http' } as const;

function makeSpan(args: {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	startUnixNano: bigint;
	endUnixNano: bigint;
	service?: string;
	status?: 0 | 1 | 2;
}): Span {
	const base = {
		traceId: args.traceId,
		spanId: args.spanId,
		name: args.name,
		kind: SpanKind.Internal,
		startTimeUnixNano: args.startUnixNano,
		endTimeUnixNano: args.endUnixNano,
		status: { code: (args.status ?? SpanStatusCode.Unset) as 0 | 1 | 2 },
		attributes: {},
		resource: args.service ? { attributes: { 'service.name': args.service } } : RESOURCE,
		scope: SCOPE,
	} satisfies Omit<Span, 'parentSpanId'>;
	return args.parentSpanId === undefined ? base : { ...base, parentSpanId: args.parentSpanId };
}

const TRACE = 'abcdef1234567890abcdef1234567890';

describe('createMemoryStorage + createEngine', () => {
	it('ingests spans and serves them through the DataSource', async () => {
		const engine = createEngine({ storage: createMemoryStorage() });

		const root = makeSpan({
			traceId: TRACE,
			spanId: '1111111111111111',
			name: 'GET /api/users',
			startUnixNano: 1_700_000_000_000_000_000n,
			endUnixNano: 1_700_000_000_045_000_000n,
			status: SpanStatusCode.Ok,
		});
		const child = makeSpan({
			traceId: TRACE,
			spanId: '2222222222222222',
			parentSpanId: '1111111111111111',
			name: 'auth.verify',
			startUnixNano: 1_700_000_000_002_000_000n,
			endUnixNano: 1_700_000_000_015_000_000n,
			service: 'auth',
			status: SpanStatusCode.Ok,
		});

		await engine.ingestSpans([root, child]);

		const list = await engine.listTraces({});
		expect(list.totalCount).toBe(1);
		expect(list.rows[0]?.rootName).toBe('GET /api/users');
		expect(list.rows[0]?.spanCount).toBe(2);
		expect([...(list.rows[0]?.services ?? [])].sort()).toEqual(['api-gateway', 'auth']);

		const trace = await engine.getTrace({ traceId: TRACE });
		expect(trace.rootSpan?.spanId).toBe('1111111111111111');
		expect(trace.spanCount).toBe(2);
		const waterfall = await engine.getTraceWaterfall({ traceId: TRACE });
		expect(waterfall.spans).toHaveLength(2);
		expect(waterfall.spans[0]?.attributes).toEqual({});
		expect(waterfall.spans[0]?.resource.attributes).toEqual({ 'service.name': 'api-gateway' });

		const details = await engine.getSpanDetails({
			traceId: TRACE,
			spanId: '2222222222222222',
		});
		expect(details.name).toBe('auth.verify');

		await engine.close();
	});

	it('builds cross-signal service overview rollups', async () => {
		const engine = createEngine({ storage: createMemoryStorage() });
		// Keep fixture safely inside the exclusive upper time bound even when
		// Date.now() returns the same millisecond inside getServiceOverview.
		const now = BigInt(Date.now() - 1_000) * 1_000_000n;
		await engine.ingestSpans([
			makeSpan({
				traceId: TRACE,
				spanId: '1111111111111111',
				name: 'request',
				startUnixNano: now - 100n,
				endUnixNano: now,
				status: SpanStatusCode.Error,
			}),
		]);
		await engine.ingestLogs([
			{
				timeUnixNano: now,
				severityNumber: 17,
				attributes: {},
				resource: RESOURCE,
				scope: SCOPE,
			},
		]);

		const overview = await engine.getServiceOverview(60);

		expect(overview[0]).toMatchObject({
			name: 'api-gateway',
			traces: 1,
			errorTraces: 1,
			spans: 1,
			logs: 1,
			logSeverity: { error: 1 },
		});
		expect(overview[0]?.errorRate).toBe(1);
		expect(overview[0]?.p50DurationNanos).toBe(100n);
		await engine.close();
	});

	it('notifies subscribers when new spans land', async () => {
		const engine = createEngine({ storage: createMemoryStorage() });
		const events: string[] = [];
		const sub = engine.subscribe((e) => {
			events.push(e.kind);
		});
		await engine.ingestSpans([
			makeSpan({
				traceId: TRACE,
				spanId: 'aaaaaaaaaaaaaaaa',
				name: 'op',
				startUnixNano: 0n,
				endUnixNano: 1_000n,
			}),
		]);
		expect(events).toEqual(['tracesChanged']);
		sub.dispose();
		await engine.ingestSpans([
			makeSpan({
				traceId: TRACE,
				spanId: 'bbbbbbbbbbbbbbbb',
				name: 'op2',
				startUnixNano: 0n,
				endUnixNano: 1_000n,
			}),
		]);
		expect(events).toEqual(['tracesChanged']); // unchanged after dispose
		await engine.close();
	});

	it('resolves equal span IDs within their trace identity', async () => {
		const engine = createEngine({ storage: createMemoryStorage() });
		const sharedSpanId = 'f'.repeat(16);
		const traceA = 'a'.repeat(32);
		const traceB = 'b'.repeat(32);
		await engine.ingestSpans([
			makeSpan({
				traceId: traceA,
				spanId: sharedSpanId,
				name: 'span-a',
				startUnixNano: 1n,
				endUnixNano: 2n,
			}),
			makeSpan({
				traceId: traceB,
				spanId: sharedSpanId,
				name: 'span-b',
				startUnixNano: 3n,
				endUnixNano: 4n,
			}),
		]);

		expect(await engine.getSpanDetails({ traceId: traceA, spanId: sharedSpanId })).toMatchObject({
			traceId: traceA,
			name: 'span-a',
		});
		expect(await engine.getSpanDetails({ traceId: traceB, spanId: sharedSpanId })).toMatchObject({
			traceId: traceB,
			name: 'span-b',
		});
		await engine.close();
	});

	it('filters by hasError and search', async () => {
		const engine = createEngine({ storage: createMemoryStorage() });
		await engine.ingestSpans([
			makeSpan({
				traceId: '1'.repeat(32),
				spanId: '1'.repeat(16),
				name: 'happy',
				startUnixNano: 1n,
				endUnixNano: 10n,
				status: SpanStatusCode.Ok,
			}),
			makeSpan({
				traceId: '2'.repeat(32),
				spanId: '2'.repeat(16),
				name: 'sad path',
				startUnixNano: 2n,
				endUnixNano: 20n,
				status: SpanStatusCode.Error,
			}),
		]);
		const onlyErrors = await engine.listTraces({ hasError: true });
		expect(onlyErrors.totalCount).toBe(1);
		expect(onlyErrors.rows[0]?.rootName).toBe('sad path');

		const search = await engine.listTraces({ search: 'happy' });
		expect(search.totalCount).toBe(1);
		expect(search.rows[0]?.rootName).toBe('happy');

		await engine.close();
	});

	it('clear() empties the store and notifies every signal', async () => {
		const engine = createEngine({ storage: createMemoryStorage() });
		const events: string[] = [];
		const sub = engine.subscribe((e) => {
			events.push(e.kind);
		});
		await engine.ingestSpans([
			makeSpan({
				traceId: TRACE,
				spanId: '1'.repeat(16),
				name: 'op',
				startUnixNano: 1n,
				endUnixNano: 2n,
			}),
		]);
		expect((await engine.listTraces({})).totalCount).toBe(1);
		events.length = 0;

		await engine.clear();

		expect((await engine.listTraces({})).totalCount).toBe(0);
		expect(events).toEqual(['tracesChanged', 'logsChanged', 'metricsChanged']);
		sub.dispose();
		await engine.close();
	});
});

describe('traceFromSpans', () => {
	it('returns undefined for an empty span set', () => {
		expect(traceFromSpans(TRACE, [])).toBeUndefined();
	});

	it('picks the orphan-parent span as root', () => {
		const root = makeSpan({
			traceId: TRACE,
			spanId: 'root000000000000',
			name: 'root',
			startUnixNano: 10n,
			endUnixNano: 100n,
		});
		const child = makeSpan({
			traceId: TRACE,
			spanId: 'child00000000000',
			parentSpanId: 'root000000000000',
			name: 'child',
			startUnixNano: 20n,
			endUnixNano: 50n,
		});
		const trace = traceFromSpans(TRACE, [child, root]);
		expect(trace?.rootSpan?.name).toBe('root');
		expect(trace?.durationNanos).toBe(90n);
	});
});

describe('computeWaterfallLayout', () => {
	it('lays out a 10,000-deep trace without overflowing the call stack', () => {
		const spans = Array.from({ length: 10_000 }, (_, index) =>
			makeSpan({
				traceId: TRACE,
				spanId: `s-${index}`,
				...(index > 0 ? { parentSpanId: `s-${index - 1}` } : {}),
				name: `span-${index}`,
				startUnixNano: BigInt(index),
				endUnixNano: BigInt(index + 1),
			}),
		);
		const trace = traceFromSpans(TRACE, spans);
		if (!trace) throw new Error('expected trace');

		const layout = computeWaterfallLayout(trace);

		expect(layout.rows).toHaveLength(10_000);
		expect(layout.rows.at(-1)?.depth).toBe(9_999);
	});

	it('produces a depth-first row order with depth indents', () => {
		const root = makeSpan({
			traceId: TRACE,
			spanId: 'r',
			name: 'root',
			startUnixNano: 0n,
			endUnixNano: 100n,
		});
		const a = makeSpan({
			traceId: TRACE,
			spanId: 'a',
			parentSpanId: 'r',
			name: 'a',
			startUnixNano: 10n,
			endUnixNano: 40n,
		});
		const b = makeSpan({
			traceId: TRACE,
			spanId: 'b',
			parentSpanId: 'a',
			name: 'b',
			startUnixNano: 15n,
			endUnixNano: 35n,
		});
		const c = makeSpan({
			traceId: TRACE,
			spanId: 'c',
			parentSpanId: 'r',
			name: 'c',
			startUnixNano: 50n,
			endUnixNano: 90n,
		});
		const trace = traceFromSpans(TRACE, [c, b, a, root]);
		if (!trace) {
			throw new Error('expected trace');
		}
		const layout = computeWaterfallLayout(trace);

		expect(layout.rows.map((r) => r.span.name)).toEqual(['root', 'a', 'b', 'c']);
		expect(layout.rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
		expect(layout.rows[1]?.startOffsetNanos).toBe(10n);
		expect(layout.totalDurationNanos).toBe(100n);
	});
});
