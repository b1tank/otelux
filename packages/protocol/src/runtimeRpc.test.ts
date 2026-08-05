import { describe, expect, it } from 'vitest';
import {
	ProtocolValidationError,
	RUNTIME_RPC_PROTOCOL_VERSION,
	decodeRuntimeRpcCall,
	negotiateRuntimeProtocol,
	parseRuntimeRpcRequest,
	protocolMajor,
} from './index.js';

const traceId = '0123456789abcdef0123456789abcdef';

describe('Runtime RPC envelopes', () => {
	it('sanitizes requests and supports notifications', () => {
		expect(
			parseRuntimeRpcRequest({
				jsonrpc: '2.0',
				id: 'a',
				method: 'telemetry/listTraces',
				params: { limit: 10 },
			}),
		).toEqual({ jsonrpc: '2.0', id: 'a', method: 'telemetry/listTraces', params: { limit: 10 } });
		expect(parseRuntimeRpcRequest({ jsonrpc: '2.0', method: 'runtime/getStatus' })).toEqual({
			jsonrpc: '2.0',
			method: 'runtime/getStatus',
		});
	});

	it('rejects malformed envelopes', () => {
		expect(() => parseRuntimeRpcRequest({ jsonrpc: '1.0', method: 'x' })).toThrow(
			'$.jsonrpc: expected JSON-RPC 2.0',
		);
		expect(() => parseRuntimeRpcRequest({ jsonrpc: '2.0', id: Number.NaN, method: 'x' })).toThrow(
			'$.id: expected a finite number',
		);
		expect(() =>
			parseRuntimeRpcRequest({ jsonrpc: '2.0', method: 'x', authorization: 'secret' }),
		).toThrow('$.authorization: field is not allowed');
	});
});

describe('Runtime RPC method params', () => {
	it('decodes bounded method params', () => {
		const request = parseRuntimeRpcRequest({
			jsonrpc: '2.0',
			id: 1,
			method: 'telemetry/getTrace',
			params: { traceId },
		});
		expect(decodeRuntimeRpcCall(request)).toEqual({
			method: 'telemetry/getTrace',
			params: { traceId },
		});
	});

	it('decodes opaque log detail IDs', () => {
		const request = parseRuntimeRpcRequest({
			jsonrpc: '2.0',
			id: 1,
			method: 'telemetry/getLog',
			params: { logId: '42' },
		});
		expect(decodeRuntimeRpcCall(request)).toEqual({
			method: 'telemetry/getLog',
			params: { logId: '42' },
		});
		expect(() => decodeRuntimeRpcCall({ ...request, params: { logId: '../settings.json' } })).toThrow(
			'$.params.logId: expected a decimal log ID',
		);
	});

	it('requires explicit clear confirmation', () => {
		const request = parseRuntimeRpcRequest({
			jsonrpc: '2.0',
			id: 1,
			method: 'runtime/clearData',
			params: { confirmation: 'yes' },
		});
		expect(() => decodeRuntimeRpcCall(request)).toThrow('$.params.confirmation: expected clear');
	});

	it('distinguishes unknown methods from invalid envelopes', () => {
		const request = parseRuntimeRpcRequest({ jsonrpc: '2.0', id: 1, method: 'runtime/runSql' });
		try {
			decodeRuntimeRpcCall(request);
		} catch (error) {
			expect(error).toBeInstanceOf(ProtocolValidationError);
			expect(error).toMatchObject({ path: '$.method', code: 'method' });
			return;
		}
		throw new Error('expected unknown method to fail');
	});
});

describe('Runtime protocol negotiation', () => {
	it('accepts compatible major versions and selects the server version', () => {
		expect(protocolMajor('1.9.0-beta.2')).toBe(1);
		expect(negotiateRuntimeProtocol('1.9.0')).toBe(RUNTIME_RPC_PROTOCOL_VERSION);
	});

	it('rejects malformed or unsupported major versions', () => {
		expect(protocolMajor('latest')).toBeUndefined();
		expect(() => negotiateRuntimeProtocol('2.0.0')).toThrow('supported protocol major is 1');
	});
});
