import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	type InvokeKind,
	type RuntimeRpcMethod,
	invokeResultDecoders,
	parseInvokeResult,
	parseRuntimeRpcResult,
	parseWireJson,
	runtimeRpcResultDecoders,
} from './index.js';

interface ResultFixture {
	readonly runtimeMethod: RuntimeRpcMethod;
	readonly invokeKind?: InvokeKind;
	readonly result: unknown;
}

interface FixtureDocument {
	readonly fixtures: readonly ResultFixture[];
	readonly ipcOnly: readonly { readonly invokeKind: InvokeKind; readonly result: unknown }[];
}

const fixturePath = fileURLToPath(new URL('../fixtures/results/v1.json', import.meta.url));
const fixtureDocument = parseWireJson(readFileSync(fixturePath, 'utf8')) as FixtureDocument;

describe('canonical method result registry', () => {
	it('has a decoder for every advertised Runtime RPC and Electron invoke method', () => {
		expect(Object.keys(runtimeRpcResultDecoders).sort()).toEqual(
			fixtureDocument.fixtures.map((fixture) => fixture.runtimeMethod).sort(),
		);
		expect(Object.keys(invokeResultDecoders).sort()).toEqual(
			[
				...fixtureDocument.fixtures.flatMap((fixture) =>
					fixture.invokeKind ? [fixture.invokeKind] : [],
				),
				...fixtureDocument.ipcOnly.map((fixture) => fixture.invokeKind),
				'clearData',
			].sort(),
		);
	});

	it('decodes the shared parity fixture through Runtime RPC and IPC registries', () => {
		for (const fixture of fixtureDocument.fixtures) {
			expect(() => parseRuntimeRpcResult(fixture.runtimeMethod, fixture.result)).not.toThrow();
			if (fixture.invokeKind) {
				expect(parseInvokeResult(fixture.invokeKind, fixture.result)).toEqual(
					parseRuntimeRpcResult(fixture.runtimeMethod, fixture.result),
				);
			}
		}
		for (const fixture of fixtureDocument.ipcOnly) {
			expect(() => parseInvokeResult(fixture.invokeKind, fixture.result)).not.toThrow();
		}
		expect(parseInvokeResult('clearData', undefined)).toBeUndefined();
	});

	it('sanitizes compatible future object fields and rejects malformed required fields', () => {
		const list = fixtureDocument.fixtures.find(
			(fixture) => fixture.runtimeMethod === 'telemetry/listTraces',
		);
		if (!list || typeof list.result !== 'object' || list.result === null) {
			throw new Error('trace-list fixture missing');
		}
		const fixtureResult = list.result as Record<string, unknown>;
		const decoded = parseRuntimeRpcResult('telemetry/listTraces', {
			...fixtureResult,
			futureField: 'ignored',
		});
		expect(decoded).not.toHaveProperty('futureField');
		expect(() =>
			parseRuntimeRpcResult('telemetry/listTraces', { ...fixtureResult, totalCount: -1 }),
		).toThrow('$.result.totalCount: must be between 0');

		const spanFixture = fixtureDocument.fixtures.find(
			(fixture) => fixture.runtimeMethod === 'telemetry/getSpan',
		);
		if (!spanFixture || typeof spanFixture.result !== 'object' || spanFixture.result === null) {
			throw new Error('span fixture missing');
		}
		const decodedSpan = parseRuntimeRpcResult('telemetry/getSpan', {
			...spanFixture.result,
			attributes: JSON.parse('{"__proto__":"data"}'),
		});
		expect(Object.getPrototypeOf(decodedSpan.attributes)).toBe(Object.prototype);
		expect(Object.hasOwn(decodedSpan.attributes, '__proto__')).toBe(true);
	});

	it('enforces method-specific collection and value constraints', () => {
		expect(() =>
			parseRuntimeRpcResult('telemetry/listLogs', {
				rows: Array.from({ length: 501 }, () => ({})),
				totalCount: 501,
			}),
		).toThrow('$.result.rows: must contain at most 500 items');
		expect(() =>
			parseRuntimeRpcResult('runtime/getSettings', {
				version: 1,
				revision: 0,
				otlp: { port: 0 },
				mcp: { enabled: false, port: 4320 },
				retention: { maxAgeHours: 72, maxSizeMb: 512 },
				storage: { dbPath: '' },
			}),
		).toThrow('$.result.otlp.port: must be between 1 and 65535');
	});
});
