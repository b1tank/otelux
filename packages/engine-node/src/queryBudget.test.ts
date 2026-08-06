import type { LogRecord, Span, SumMetric } from '@otelux/types';
import { AggregationTemporality, SpanKind, SpanStatusCode } from '@otelux/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type NodeSqliteStorage, type SqlExecution, createNodeSqliteStorage } from './index.js';

const TRACE_ID = 'a'.repeat(32);
const SPAN_ID = '1'.repeat(16);

function span(): Span {
	return {
		traceId: TRACE_ID,
		spanId: SPAN_ID,
		name: 'GET /budget',
		kind: SpanKind.Server,
		startTimeUnixNano: 10n,
		endTimeUnixNano: 20n,
		status: { code: SpanStatusCode.Ok },
		attributes: {},
		resource: {
			attributes: { 'service.namespace': 'budget', 'service.name': 'budget-api' },
		},
		scope: { name: 'budget-tracer' },
	};
}

function log(): LogRecord {
	return {
		timeUnixNano: 15n,
		severityNumber: 17,
		body: 'budget failure',
		attributes: { route: '/budget' },
		traceId: TRACE_ID,
		spanId: SPAN_ID,
		resource: {
			attributes: { 'service.namespace': 'budget', 'service.name': 'budget-api' },
		},
		scope: { name: 'budget-logger' },
	};
}

function metric(): SumMetric {
	return {
		type: 'sum',
		name: 'budget.requests',
		isMonotonic: true,
		temporality: AggregationTemporality.Cumulative,
		resource: {
			attributes: { 'service.namespace': 'budget', 'service.name': 'budget-api' },
		},
		scope: { name: 'budget-meter' },
		dataPoints: [{ timeUnixNano: 15n, value: 1, attributes: { route: '/budget' } }],
	};
}

function statementExecutions(executions: readonly SqlExecution[]): readonly SqlExecution[] {
	return executions.filter((execution) => execution.kind !== 'exec');
}

function transactionCommands(executions: readonly SqlExecution[]): readonly string[] {
	return executions
		.flatMap((execution) => (execution.kind === 'exec' ? execution.sql.split(';') : [execution.sql]))
		.map((sql) => sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? '')
		.filter((command) => command === 'BEGIN' || command === 'COMMIT' || command === 'ROLLBACK');
}

describe('SQLite query budgets', () => {
	let storage: NodeSqliteStorage;
	let executions: SqlExecution[];

	beforeEach(() => {
		executions = [];
		storage = createNodeSqliteStorage({
			path: ':memory:',
			pruneIntervalMs: 0,
			onSqlExecute: (execution) => executions.push(execution),
		});
		storage.writeSpans([
			span(),
			{
				...span(),
				traceId: 'b'.repeat(32),
				spanId: '2'.repeat(16),
				name: 'GET /budget/second',
				startTimeUnixNano: 30n,
				endTimeUnixNano: 40n,
			},
		]);
		storage.writeLogs([log(), { ...log(), timeUnixNano: 25n, body: 'second budget failure' }]);
		const instrument = metric();
		storage.writeMetrics([
			{
				...instrument,
				dataPoints: [
					...instrument.dataPoints,
					{ timeUnixNano: 25n, value: 2, attributes: { route: '/budget/second' } },
				],
			},
		]);
		executions.length = 0;
	});

	afterEach(() => storage.close());

	it('keeps list queries within fixed statement budgets', () => {
		storage.listTraces({ services: ['budget-api'] });
		expect(statementExecutions(executions)).toHaveLength(2);
		executions.length = 0;
		const firstTracePage = storage.listTraces({ limit: 1, includeTotalCount: false });
		expect(statementExecutions(executions)).toHaveLength(1);
		if (!firstTracePage.nextCursor) throw new Error('trace cursor missing');
		executions.length = 0;
		storage.listTraces({
			limit: 1,
			includeTotalCount: false,
			cursor: firstTracePage.nextCursor,
		});
		expect(statementExecutions(executions)).toHaveLength(1);

		executions.length = 0;
		storage.listLogs({ services: ['budget-api'], minSeverity: 13 });
		expect(statementExecutions(executions)).toHaveLength(2);
		executions.length = 0;
		const firstLogPage = storage.listLogs({ limit: 1, includeTotalCount: false });
		expect(statementExecutions(executions)).toHaveLength(1);
		if (!firstLogPage.nextCursor) throw new Error('log cursor missing');
		executions.length = 0;
		storage.listLogs({ limit: 1, includeTotalCount: false, cursor: firstLogPage.nextCursor });
		expect(statementExecutions(executions)).toHaveLength(1);

		executions.length = 0;
		const instruments = storage.listMetricInstruments({ services: ['budget-api'] });
		expect(statementExecutions(executions)).toHaveLength(2);
		const instrumentId = instruments.rows[0]?.instrumentId;
		if (!instrumentId) throw new Error('metric fixture missing');
		executions.length = 0;
		const firstPointPage = storage.getMetricPoints({ instrumentId, limit: 1 });
		expect(statementExecutions(executions)).toHaveLength(1);
		if (!firstPointPage?.nextCursor) throw new Error('metric point cursor missing');
		executions.length = 0;
		storage.getMetricPoints({ instrumentId, limit: 1, cursor: firstPointPage.nextCursor });
		expect(statementExecutions(executions)).toHaveLength(1);
	});

	it('uses one statement for each selected detail', () => {
		storage.getTraceSpans(TRACE_ID);
		expect(statementExecutions(executions)).toHaveLength(1);
		executions.length = 0;
		storage.getSpan(TRACE_ID, SPAN_ID);
		expect(statementExecutions(executions)).toHaveLength(1);
		executions.length = 0;
		const logId = storage.listLogs({ limit: 1 }).rows[0]?.logId;
		if (!logId) throw new Error('log fixture missing');
		executions.length = 0;
		storage.getLog(logId);
		expect(statementExecutions(executions)).toHaveLength(1);
	});

	it('keeps grouped facets and internal metric composition bounded', () => {
		for (const signal of ['traces', 'logs', 'metrics'] as const) {
			storage.listResourceFacets({ signal, facet: 'source' });
		}
		expect(statementExecutions(executions)).toHaveLength(3);

		executions.length = 0;
		storage.listMetrics({ limit: 500, pointLimit: 1 });
		expect(statementExecutions(executions)).toHaveLength(3);
	});

	it('uses one transaction per ingest batch and clear operation', () => {
		executions.length = 0;
		storage.writeSpans([span()]);
		expect(transactionCommands(executions)).toEqual(['BEGIN', 'COMMIT']);
		executions.length = 0;
		storage.writeLogs([log()]);
		expect(transactionCommands(executions)).toEqual(['BEGIN', 'COMMIT']);
		executions.length = 0;
		storage.writeMetrics([metric()]);
		expect(transactionCommands(executions)).toEqual(['BEGIN', 'COMMIT']);
		executions.length = 0;
		storage.clear();
		expect(transactionCommands(executions)).toEqual(['BEGIN', 'COMMIT']);
	});
});
