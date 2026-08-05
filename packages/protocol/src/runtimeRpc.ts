import type {
	ListLogsQuery,
	ListMetricsQuery,
	ListResourceFacetsQuery,
	ListTracesQuery,
	PartialSettings,
	RuntimeApiStatus,
	RuntimeState,
} from './index.js';
import {
	ProtocolValidationError,
	parseListLogsQuery,
	parseListMetricsQuery,
	parseListResourceFacetsQuery,
	parseListTracesQuery,
	parsePartialSettings,
} from './validation.js';

export const JSON_RPC_VERSION = '2.0' as const;
export const RUNTIME_RPC_PROTOCOL_VERSION = '1.0.0' as const;

export const RUNTIME_RPC_ERROR = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	UNSUPPORTED_PROTOCOL: -32001,
	NOT_READY: -32002,
	INVALID_CURSOR: -32003,
	CONFLICT: -32004,
	RESPONSE_TOO_LARGE: -32005,
} as const;

export type JsonRpcId = string | number | null;

export interface RuntimeRpcRequest {
	readonly jsonrpc: typeof JSON_RPC_VERSION;
	readonly id?: JsonRpcId;
	readonly method: string;
	readonly params?: unknown;
}

export interface RuntimeRpcSuccess {
	readonly jsonrpc: typeof JSON_RPC_VERSION;
	readonly id: JsonRpcId;
	readonly result: unknown;
}

export interface RuntimeRpcFailure {
	readonly jsonrpc: typeof JSON_RPC_VERSION;
	readonly id: JsonRpcId;
	readonly error: {
		readonly code: number;
		readonly message: string;
		readonly data?: unknown;
	};
}

export type RuntimeRpcResponse = RuntimeRpcSuccess | RuntimeRpcFailure;

export interface RuntimeInitializeParams {
	readonly protocolVersion: string;
	readonly client: {
		readonly name: string;
		readonly version: string;
	};
}

export interface RuntimeInitializeResult {
	readonly protocolVersion: typeof RUNTIME_RPC_PROTOCOL_VERSION;
	readonly runtime: { readonly name: 'otelux-runtime'; readonly version: string };
	readonly capabilities: {
		readonly queries: true;
		readonly settings: true;
		readonly sampleData: true;
		readonly clearData: true;
		readonly events: true;
	};
	readonly limits: {
		readonly traces: 200;
		readonly logs: 500;
		readonly metrics: 500;
		readonly metricPoints: 10_000;
	};
}

export interface RuntimeStatusResult {
	readonly runtimeVersion: string;
	readonly protocolVersion: string;
	readonly instanceId: string;
	readonly pid: number;
	readonly startedAt: string;
	readonly dataDirectory: string;
	readonly databasePath: string;
	readonly receiver: RuntimeState['receiver'];
	readonly mcp: RuntimeState['mcp'];
	readonly api?: RuntimeApiStatus;
}

export type RuntimeRpcMethod =
	| 'runtime/initialize'
	| 'runtime/getStatus'
	| 'runtime/getSettings'
	| 'runtime/updateSettings'
	| 'runtime/loadSampleData'
	| 'runtime/clearData'
	| 'telemetry/listTraces'
	| 'telemetry/getTrace'
	| 'telemetry/getTraceWaterfall'
	| 'telemetry/getSpan'
	| 'telemetry/listLogs'
	| 'telemetry/getLog'
	| 'telemetry/listMetrics'
	| 'telemetry/getFacets';

export type DecodedRuntimeRpcCall =
	| { readonly method: 'runtime/initialize'; readonly params: RuntimeInitializeParams }
	| { readonly method: 'runtime/getStatus' }
	| { readonly method: 'runtime/getSettings' }
	| { readonly method: 'runtime/updateSettings'; readonly params: PartialSettings }
	| { readonly method: 'runtime/loadSampleData' }
	| { readonly method: 'runtime/clearData'; readonly params: { readonly confirmation: 'clear' } }
	| { readonly method: 'telemetry/listTraces'; readonly params: ListTracesQuery }
	| { readonly method: 'telemetry/getTrace'; readonly params: { readonly traceId: string } }
	| { readonly method: 'telemetry/getTraceWaterfall'; readonly params: { readonly traceId: string } }
	| {
			readonly method: 'telemetry/getSpan';
			readonly params: { readonly traceId: string; readonly spanId: string };
	  }
	| { readonly method: 'telemetry/listLogs'; readonly params: ListLogsQuery }
	| { readonly method: 'telemetry/getLog'; readonly params: { readonly logId: string } }
	| { readonly method: 'telemetry/listMetrics'; readonly params: ListMetricsQuery }
	| { readonly method: 'telemetry/getFacets'; readonly params: ListResourceFacetsQuery };

function record(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ProtocolValidationError(path, 'type', 'expected an object');
	}
	return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const accepted = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (!accepted.has(key)) {
			throw new ProtocolValidationError(`${path}.${key}`, 'unknown_field', 'field is not allowed');
		}
	}
}

function text(value: unknown, path: string, maxLength = 256): string {
	if (typeof value !== 'string') {
		throw new ProtocolValidationError(path, 'type', 'expected a string');
	}
	if (value.length === 0 || value.length > maxLength) {
		throw new ProtocolValidationError(path, 'length', `must contain 1 to ${maxLength} characters`);
	}
	return value;
}

function emptyParams(value: unknown, path = '$.params'): void {
	if (value === undefined) return;
	const input = record(value, path);
	keys(input, [], path);
}

function logParams(value: unknown): { logId: string } {
	const input = record(value, '$.params');
	keys(input, ['logId'], '$.params');
	const logId = text(input.logId, '$.params.logId', 32);
	if (!/^[1-9]\d*$/.test(logId)) {
		throw new ProtocolValidationError('$.params.logId', 'format', 'expected a decimal log ID');
	}
	return { logId };
}

function traceParams(value: unknown, withSpan = false): { traceId: string; spanId?: string } {
	const input = record(value, '$.params');
	keys(input, withSpan ? ['traceId', 'spanId'] : ['traceId'], '$.params');
	const traceId = text(input.traceId, '$.params.traceId', 32);
	if (!/^[0-9a-f]{32}$/.test(traceId)) {
		throw new ProtocolValidationError(
			'$.params.traceId',
			'format',
			'expected a lowercase hexadecimal trace ID',
		);
	}
	if (!withSpan) return { traceId };
	const spanId = text(input.spanId, '$.params.spanId', 16);
	if (!/^[0-9a-f]{16}$/.test(spanId)) {
		throw new ProtocolValidationError(
			'$.params.spanId',
			'format',
			'expected a lowercase hexadecimal span ID',
		);
	}
	return { traceId, spanId };
}

export function parseRuntimeRpcRequest(value: unknown): RuntimeRpcRequest {
	const input = record(value, '$');
	keys(input, ['jsonrpc', 'id', 'method', 'params'], '$');
	if (input.jsonrpc !== JSON_RPC_VERSION) {
		throw new ProtocolValidationError('$.jsonrpc', 'literal', 'expected JSON-RPC 2.0');
	}
	const method = text(input.method, '$.method', 128);
	let id: JsonRpcId | undefined;
	if ('id' in input) {
		if (
			input.id !== null &&
			typeof input.id !== 'string' &&
			(typeof input.id !== 'number' || !Number.isFinite(input.id))
		) {
			throw new ProtocolValidationError('$.id', 'type', 'expected a finite number, string, or null');
		}
		id = input.id as JsonRpcId;
	}
	return {
		jsonrpc: JSON_RPC_VERSION,
		...(id !== undefined ? { id } : {}),
		method,
		...('params' in input ? { params: input.params } : {}),
	};
}

export function decodeRuntimeRpcCall(request: RuntimeRpcRequest): DecodedRuntimeRpcCall {
	const method = request.method as RuntimeRpcMethod;
	switch (method) {
		case 'runtime/initialize': {
			const input = record(request.params, '$.params');
			keys(input, ['protocolVersion', 'client'], '$.params');
			const client = record(input.client, '$.params.client');
			keys(client, ['name', 'version'], '$.params.client');
			return {
				method: 'runtime/initialize',
				params: {
					protocolVersion: text(input.protocolVersion, '$.params.protocolVersion', 64),
					client: {
						name: text(client.name, '$.params.client.name', 128),
						version: text(client.version, '$.params.client.version', 64),
					},
				},
			};
		}
		case 'runtime/getStatus':
		case 'runtime/getSettings':
		case 'runtime/loadSampleData':
			emptyParams(request.params);
			return { method };
		case 'runtime/updateSettings':
			return { method, params: parsePartialSettings(request.params, '$.params') };
		case 'runtime/clearData': {
			const input = record(request.params, '$.params');
			keys(input, ['confirmation'], '$.params');
			if (input.confirmation !== 'clear') {
				throw new ProtocolValidationError('$.params.confirmation', 'literal', 'expected clear');
			}
			return { method, params: { confirmation: 'clear' } };
		}
		case 'telemetry/listTraces':
			return { method, params: parseListTracesQuery(request.params, '$.params') };
		case 'telemetry/getTrace':
		case 'telemetry/getTraceWaterfall':
			return { method, params: traceParams(request.params) as { traceId: string } };
		case 'telemetry/getSpan': {
			const params = traceParams(request.params, true);
			return {
				method,
				params: { traceId: params.traceId, spanId: params.spanId as string },
			};
		}
		case 'telemetry/listLogs':
			return { method, params: parseListLogsQuery(request.params, '$.params') };
		case 'telemetry/getLog':
			return { method, params: logParams(request.params) };
		case 'telemetry/listMetrics':
			return { method, params: parseListMetricsQuery(request.params, '$.params') };
		case 'telemetry/getFacets':
			return {
				method,
				params: parseListResourceFacetsQuery(request.params, '$.params'),
			};
		default:
			throw new ProtocolValidationError('$.method', 'method', 'unknown Runtime RPC method');
	}
}

export function protocolMajor(version: string): number | undefined {
	const match = /^([0-9]+)\.[0-9]+(?:\.[0-9]+)?(?:-[0-9A-Za-z.-]+)?$/.exec(version);
	if (!match) return undefined;
	return Number(match[1]);
}

export function negotiateRuntimeProtocol(requested: string): typeof RUNTIME_RPC_PROTOCOL_VERSION {
	if (protocolMajor(requested) !== protocolMajor(RUNTIME_RPC_PROTOCOL_VERSION)) {
		throw new ProtocolValidationError(
			'$.params.protocolVersion',
			'unsupported_protocol',
			`supported protocol major is ${protocolMajor(RUNTIME_RPC_PROTOCOL_VERSION)}`,
		);
	}
	return RUNTIME_RPC_PROTOCOL_VERSION;
}
