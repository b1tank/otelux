import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { LogRecord, Span, SumMetric } from '@otelux/types';
import { AggregationTemporality, SpanKind, SpanStatusCode } from '@otelux/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type NodeSqliteStorage, type SqlExecution, createNodeSqliteStorage } from './index.js';

const TRACE_ID = 'c'.repeat(32);
const SPAN_ID = '3'.repeat(16);
const RESOURCE = {
	attributes: { 'service.namespace': 'plans', 'service.name': 'plans-api' },
} as const;

function span(): Span {
	return {
		traceId: TRACE_ID,
		spanId: SPAN_ID,
		name: 'GET /plans',
		kind: SpanKind.Server,
		startTimeUnixNano: 100n,
		endTimeUnixNano: 200n,
		status: { code: SpanStatusCode.Error },
		attributes: {},
		resource: RESOURCE,
		scope: { name: 'plans-tracer' },
	};
}

function log(): LogRecord {
	return {
		timeUnixNano: 150n,
		severityNumber: 17,
		body: 'plan fixture',
		attributes: {},
		traceId: TRACE_ID,
		spanId: SPAN_ID,
		resource: RESOURCE,
		scope: { name: 'plans-logger' },
	};
}

function metric(): SumMetric {
	return {
		type: 'sum',
		name: 'plans.requests',
		isMonotonic: true,
		temporality: AggregationTemporality.Cumulative,
		resource: RESOURCE,
		scope: { name: 'plans-meter' },
		dataPoints: [{ timeUnixNano: 150n, value: 1, attributes: {} }],
	};
}

function explain(database: DatabaseSync, executions: readonly SqlExecution[]): string {
	return executions
		.filter((execution) => execution.kind !== 'exec')
		.flatMap((execution) => {
			const statement = database.prepare(`EXPLAIN QUERY PLAN ${execution.sql}`);
			return statement.all(...(execution.parameters as readonly SQLInputValue[])) as Array<{
				detail: string;
			}>;
		})
		.map((row) => row.detail)
		.join('\n');
}

describe('SQLite indexed query plans', () => {
	let directory: string;
	let path: string;
	let storage: NodeSqliteStorage;
	let database: DatabaseSync;
	let executions: SqlExecution[];

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), 'otelux-query-plan-'));
		path = join(directory, 'otelux.db');
		executions = [];
		storage = createNodeSqliteStorage({
			path,
			pruneIntervalMs: 0,
			onSqlExecute: (execution) => executions.push(execution),
		});
		storage.writeSpans([span()]);
		storage.writeLogs([log()]);
		storage.writeMetrics([metric()]);
		database = new DatabaseSync(path);
	});

	afterAll(() => {
		database.close();
		storage.close();
		rmSync(directory, { recursive: true, force: true });
	});

	function plan(run: () => void): string {
		executions.length = 0;
		run();
		return explain(database, executions);
	}

	it('uses normalized trace source/service and time indexes', () => {
		expect(plan(() => storage.listTraces({ sources: ['plans'] }))).toContain(
			'idx_trace_sources_source',
		);
		expect(plan(() => storage.listTraces({ services: ['plans-api'] }))).toContain(
			'idx_trace_services_service',
		);
		expect(plan(() => storage.listTraces({ timeFromUnixNano: 1n }))).toContain('idx_traces_start');
	});

	it('uses log time, severity, trace, and source indexes', () => {
		expect(plan(() => storage.listLogs({ includeTotalCount: false }))).toContain('idx_logs_time');
		expect(plan(() => storage.listLogs({ minSeverity: 13, sortBy: 'severity' }))).toContain(
			'idx_logs_severity',
		);
		expect(plan(() => storage.listLogs({ traceId: TRACE_ID }))).toContain('idx_logs_trace');
		expect(plan(() => storage.listLogs({ sources: ['plans'] }))).toContain('idx_logs_source');
	});

	it('uses metric source and selected-history indexes', () => {
		expect(plan(() => storage.listMetricInstruments({ sources: ['plans'] }))).toContain(
			'idx_metric_instruments_source',
		);
		const instrumentId = storage.listMetricInstruments({}).rows[0]?.instrumentId;
		if (!instrumentId) throw new Error('metric fixture missing');
		expect(plan(() => storage.getMetricPoints({ instrumentId, limit: 1 }))).toContain(
			'idx_points_instrument_time',
		);
	});

	it('documents substring search as the intentional scan until FTS5', () => {
		const details = plan(() => storage.listLogs({ search: 'fixture' }));
		expect(details).toContain('SCAN l');
	});
});
