import {
	JSON_RPC_VERSION,
	ProtocolValidationError,
	RUNTIME_RPC_ERROR,
	RUNTIME_RPC_PROTOCOL_VERSION,
	type RuntimeInitializeResult,
	type RuntimeRpcFailure,
	type RuntimeRpcRequest,
	type RuntimeRpcResponse,
	type RuntimeRpcSuccess,
	type RuntimeStatusResult,
	decodeRuntimeRpcCall,
	negotiateRuntimeProtocol,
	parseRuntimeRpcRequest,
} from '@otelux/protocol';
import type { LocalRuntime } from './runtime.js';

export interface RuntimeRpcDispatcher {
	handle(input: unknown): Promise<RuntimeRpcResponse | undefined>;
}

export function createRuntimeRpcDispatcher(runtime: LocalRuntime): RuntimeRpcDispatcher {
	return {
		async handle(input: unknown): Promise<RuntimeRpcResponse | undefined> {
			let request: RuntimeRpcRequest;
			try {
				request = parseRuntimeRpcRequest(input);
			} catch (error) {
				return failure(
					null,
					RUNTIME_RPC_ERROR.INVALID_REQUEST,
					'Invalid Request',
					validationData(error),
				);
			}
			const id = request.id ?? null;
			const notification = request.id === undefined;
			try {
				const call = decodeRuntimeRpcCall(request);
				let result: unknown;
				switch (call.method) {
					case 'runtime/initialize': {
						let protocolVersion: typeof RUNTIME_RPC_PROTOCOL_VERSION;
						try {
							protocolVersion = negotiateRuntimeProtocol(call.params.protocolVersion);
						} catch (error) {
							if (notification) return undefined;
							return failure(id, RUNTIME_RPC_ERROR.UNSUPPORTED_PROTOCOL, 'Unsupported protocol version', {
								...validationData(error),
								supportedVersions: [RUNTIME_RPC_PROTOCOL_VERSION],
							});
						}
						result = {
							protocolVersion,
							runtime: {
								name: 'otelux-runtime',
								version: runtime.getRuntimeState().runtimeVersion,
							},
							capabilities: {
								queries: true,
								settings: true,
								sampleData: true,
								clearData: true,
								events: true,
							},
							limits: { traces: 200, logs: 500, metrics: 500, metricPoints: 10_000 },
						} satisfies RuntimeInitializeResult;
						break;
					}
					case 'runtime/getStatus':
						result = publicStatus(runtime);
						break;
					case 'runtime/getSettings':
						result = runtime.getSettings();
						break;
					case 'runtime/updateSettings':
						result = await runtime.updateSettings(call.params);
						break;
					case 'runtime/loadSampleData':
						result = await runtime.loadSampleData();
						break;
					case 'runtime/clearData':
						await runtime.clearData();
						result = null;
						break;
					case 'telemetry/listTraces':
						result = await runtime.listTraces(call.params);
						break;
					case 'telemetry/getTrace':
						result = await runtime.getTrace(call.params);
						break;
					case 'telemetry/getTraceWaterfall':
						result = await (runtime.getTraceWaterfall?.(call.params) ?? runtime.getTrace(call.params));
						break;
					case 'telemetry/getSpan':
						result = await runtime.getSpanDetails(call.params);
						break;
					case 'telemetry/listLogs':
						result = await runtime.listLogs(call.params);
						break;
					case 'telemetry/getLog':
						result = await runtime.getLogDetails(call.params);
						break;
					case 'telemetry/listMetrics':
						result = await runtime.listMetrics(call.params);
						break;
					case 'telemetry/getFacets':
						result = await runtime.listResourceFacets(call.params);
						break;
				}
				return notification ? undefined : success(id, result);
			} catch (error) {
				if (notification) return undefined;
				if (error instanceof ProtocolValidationError) {
					const methodMissing = error.code === 'method';
					return failure(
						id,
						methodMissing ? RUNTIME_RPC_ERROR.METHOD_NOT_FOUND : RUNTIME_RPC_ERROR.INVALID_PARAMS,
						methodMissing ? 'Method not found' : 'Invalid params',
						validationData(error),
					);
				}
				return failure(id, RUNTIME_RPC_ERROR.INTERNAL_ERROR, 'Internal error');
			}
		},
	};
}

function publicStatus(runtime: LocalRuntime): RuntimeStatusResult {
	const state = runtime.getRuntimeState();
	return {
		runtimeVersion: state.runtimeVersion,
		protocolVersion: state.protocolVersion,
		instanceId: state.instanceId,
		pid: state.pid,
		startedAt: state.startedAt,
		dataDirectory: state.dataDirectory,
		databasePath: state.databasePath,
		receiver: state.receiver,
		mcp: state.mcp,
		...(state.api ? { api: state.api } : {}),
	};
}

function success(id: string | number | null, result: unknown): RuntimeRpcSuccess {
	return { jsonrpc: JSON_RPC_VERSION, id, result };
}

function failure(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown,
): RuntimeRpcFailure {
	return {
		jsonrpc: JSON_RPC_VERSION,
		id,
		error: { code, message, ...(data !== undefined ? { data } : {}) },
	};
}

function validationData(error: unknown): { path: string; code: string } | undefined {
	return error instanceof ProtocolValidationError
		? { path: error.path, code: error.code }
		: undefined;
}
