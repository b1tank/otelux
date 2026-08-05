import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	ProtocolValidationError,
	parseInvokeMessage,
	parsePartialSettings,
	parseRuntimeEvent,
	parseRuntimeState,
} from './index.js';

const runtimeFixtureDirectory = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'fixtures',
	'runtime-state',
);
const runtimeFixture = (name: string): unknown =>
	JSON.parse(readFileSync(join(runtimeFixtureDirectory, name), 'utf8'));

const traceId = '0123456789abcdef0123456789abcdef';
const spanId = '0123456789abcdef';

function validationError(run: () => unknown): ProtocolValidationError {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(ProtocolValidationError);
		return error as ProtocolValidationError;
	}
	throw new Error('expected validation to fail');
}

describe('invoke validation', () => {
	it.each([
		{ kind: 'listTraces', query: {} },
		{ kind: 'getTrace', query: { traceId } },
		{ kind: 'getTraceWaterfall', query: { traceId } },
		{ kind: 'getSpanDetails', query: { traceId, spanId } },
		{ kind: 'listLogs', query: { limit: 500, traceId } },
		{ kind: 'getLogDetails', query: { logId: '42' } },
		{ kind: 'listMetrics', query: { pointLimit: 10_000 } },
		{ kind: 'listResourceFacets', query: { signal: 'traces', facet: 'source' } },
		{ kind: 'getSettings' },
		{ kind: 'updateSettings', patch: { otlp: { port: 4319 } } },
		{ kind: 'getReceiverStatus' },
		{ kind: 'getMcpStatus' },
		{ kind: 'getStoragePath' },
		{ kind: 'getStorageUsage' },
		{ kind: 'loadSampleData' },
		{ kind: 'clearData' },
	])('accepts $kind', (message) => {
		expect(parseInvokeMessage(message)).toEqual(message);
	});

	it('rejects unknown discriminators with a stable path and code', () => {
		const error = validationError(() => parseInvokeMessage({ kind: 'runSql', query: {} }));
		expect({ path: error.path, code: error.code }).toEqual({
			path: '$.kind',
			code: 'discriminator',
		});
	});

	it('rejects unknown fields and explicit undefined', () => {
		expect(() => parseInvokeMessage({ kind: 'getSettings', admin: true })).toThrow(
			'$.admin: field is not allowed',
		);
		expect(() => parseInvokeMessage({ kind: 'listTraces', query: { limit: undefined } })).toThrow(
			'$.query.limit: explicit undefined is not allowed',
		);
	});

	it('enforces list bounds and identifier formats', () => {
		expect(() => parseInvokeMessage({ kind: 'listTraces', query: { limit: 201 } })).toThrow(
			'$.query.limit: must be between 1 and 200',
		);
		expect(() => parseInvokeMessage({ kind: 'getTrace', query: { traceId: 'abc' } })).toThrow(
			'$.query.traceId: expected a lowercase hexadecimal trace ID',
		);
		expect(() => parseInvokeMessage({ kind: 'getLogDetails', query: { logId: '0' } })).toThrow(
			'$.query.logId: expected a decimal log ID',
		);
	});

	it('sanitizes accepted objects instead of retaining prototypes', () => {
		const query = Object.create({ inherited: true }) as { limit?: number };
		query.limit = 10;
		const parsed = parseInvokeMessage({ kind: 'listTraces', query });
		expect(parsed).toEqual({ kind: 'listTraces', query: { limit: 10 } });
		if (parsed.kind !== 'listTraces') throw new Error('unexpected invoke kind');
		expect(Object.hasOwn(parsed.query, 'inherited')).toBe(false);
	});
});

describe('settings validation', () => {
	it('accepts an empty patch and bounded partial sections', () => {
		expect(parsePartialSettings({})).toEqual({});
		expect(
			parsePartialSettings({
				mcp: { enabled: false, port: 4320 },
				retention: { maxAgeHours: 0, maxSizeMb: 1_048_576 },
				storage: { dbPath: '' },
			}),
		).toEqual({
			mcp: { enabled: false, port: 4320 },
			retention: { maxAgeHours: 0, maxSizeMb: 1_048_576 },
			storage: { dbPath: '' },
		});
	});

	it('rejects invalid ports, retention, and nested fields', () => {
		expect(() => parsePartialSettings({ otlp: { port: 0 } })).toThrow(
			'$.patch.otlp.port: must be between 1 and 65535',
		);
		expect(() => parsePartialSettings({ retention: { maxAgeHours: -1 } })).toThrow(
			'$.patch.retention.maxAgeHours: must be between 0 and 43800',
		);
		expect(() => parsePartialSettings({ mcp: { token: 'secret' } })).toThrow(
			'$.patch.mcp.token: field is not allowed',
		);
	});
});

describe('runtime state validation', () => {
	it('decodes v1 state and ignores compatible future top-level fields', () => {
		const current = parseRuntimeState(runtimeFixture('v1.json'));
		const future = parseRuntimeState(runtimeFixture('v1-compatible-future.json'));
		expect(current).toMatchObject({ version: 1, runtimeVersion: '0.1.10', pid: 4242 });
		expect(future).toMatchObject({
			version: 1,
			runtimeVersion: '0.2.0-beta.1',
			pid: 4243,
			api: { kind: 'running', port: 4321 },
			runtimeTokenFile: '/home/example/.local/share/otelux/runtime-token',
		});
		expect(Object.hasOwn(future, 'futureApi')).toBe(false);
	});

	it('rejects unsupported state versions and malformed dates', () => {
		expect(() => parseRuntimeState(runtimeFixture('v2-unsupported.json'))).toThrow(
			'$.version: expected 1',
		);
		expect(() =>
			parseRuntimeState({
				...(runtimeFixture('v1.json') as Record<string, unknown>),
				startedAt: 'yesterday',
			}),
		).toThrow('$.startedAt: expected an ISO-8601 date-time');
	});
});

describe('runtime event validation', () => {
	it('accepts valid signal and status events', () => {
		expect(parseRuntimeEvent({ kind: 'tracesChanged', traceIds: [traceId] })).toEqual({
			kind: 'tracesChanged',
			traceIds: [traceId],
		});
		expect(
			parseRuntimeEvent({
				kind: 'receiver-status-changed',
				status: {
					kind: 'running',
					port: 4319,
					host: '127.0.0.1',
					pressure: { overloadedTraces: 1, overloadedLogs: 2, overloadedMetrics: 3 },
				},
			}),
		).toMatchObject({ status: { kind: 'running', port: 4319 } });
	});

	it('rejects malformed and unknown events', () => {
		expect(() => parseRuntimeEvent({ kind: 'logsChanged', count: -1 })).toThrow(
			'$.count: must be between 0',
		);
		expect(() => parseRuntimeEvent({ kind: 'databaseDumped', path: '/tmp/db' })).toThrow(
			'$.kind: unknown runtime event kind',
		);
	});
});
