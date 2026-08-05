import {
	type ChangeEvent,
	type DataSource,
	type Disposable,
	type GetSpanDetailsQuery,
	type GetTraceQuery,
	JSON_RPC_VERSION,
	type ListLogsQuery,
	type ListLogsResult,
	type ListMetricsQuery,
	type ListMetricsResult,
	type ListResourceFacetsQuery,
	type ListResourceFacetsResult,
	type ListTracesQuery,
	type ListTracesResult,
	type LoadSampleDataResult,
	type PartialSettings,
	RUNTIME_RPC_PROTOCOL_VERSION,
	type RuntimeInitializeResult,
	type RuntimeRpcResponse,
	type RuntimeStatusResult,
	type Settings,
	type SpanDetails,
	type UpdateSettingsResult,
	parseRuntimeSseEnvelope,
	parseWireJson,
	stringifyWire,
} from '@otelux/protocol';
import type { Trace } from '@otelux/types';

export interface CreateHttpDataSourceOptions {
	readonly baseUrl: string;
	readonly token: string;
	readonly clientName?: string;
	readonly clientVersion?: string;
	readonly fetch?: typeof fetch;
	readonly reconnectDelayMs?: number;
	readonly maximumReconnectDelayMs?: number;
}

export interface RuntimeHttpClient extends DataSource {
	initialize(): Promise<RuntimeInitializeResult>;
	getStatus(): Promise<RuntimeStatusResult>;
	getSettings(): Promise<Settings>;
	updateSettings(patch: PartialSettings): Promise<UpdateSettingsResult>;
	loadSampleData(): Promise<LoadSampleDataResult>;
	clearData(): Promise<void>;
	close(): void;
}

export class RuntimeRpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
		readonly data?: unknown,
	) {
		super(message);
		this.name = 'RuntimeRpcError';
	}
}

export function createHttpDataSource(options: CreateHttpDataSourceOptions): RuntimeHttpClient {
	let baseUrl = options.baseUrl;
	while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
	if (!/^https?:\/\//.test(baseUrl)) throw new Error('Runtime baseUrl must use HTTP or HTTPS');
	if (options.token.length === 0) throw new Error('Runtime token is required');
	const fetchImpl = options.fetch ?? fetch;
	const handlers = new Set<(event: ChangeEvent) => void>();
	let requestId = 0;
	let initialized: Promise<RuntimeInitializeResult> | undefined;
	let eventController: AbortController | undefined;
	let closed = false;
	let lastEventId: string | undefined;

	const rawCall = async (method: string, params?: unknown): Promise<unknown> => {
		if (closed) throw new Error('Runtime HTTP client is closed');
		const id = String(++requestId);
		const response = await fetchImpl(`${baseUrl}/api/v1/rpc`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${options.token}`,
				'content-type': 'application/json',
			},
			body: stringifyWire({
				jsonrpc: JSON_RPC_VERSION,
				id,
				method,
				...(params !== undefined ? { params } : {}),
			}),
		});
		if (!response.ok) throw new Error(`Runtime HTTP ${response.status}`);
		const envelope = parseWireJson(await response.text()) as RuntimeRpcResponse;
		if (!isRpcResponse(envelope) || envelope.id !== id) {
			throw new Error('Runtime returned an invalid JSON-RPC response');
		}
		if ('error' in envelope) {
			throw new RuntimeRpcError(envelope.error.code, envelope.error.message, envelope.error.data);
		}
		return envelope.result;
	};

	const initialize = (): Promise<RuntimeInitializeResult> => {
		initialized ??= rawCall('runtime/initialize', {
			protocolVersion: RUNTIME_RPC_PROTOCOL_VERSION,
			client: {
				name: options.clientName ?? 'otelux-http-client',
				version: options.clientVersion ?? '0.0.0',
			},
		}).then((result) => {
			const value = result as RuntimeInitializeResult;
			if (value.protocolVersion !== RUNTIME_RPC_PROTOCOL_VERSION) {
				throw new Error(`Runtime negotiated unexpected protocol ${value.protocolVersion}`);
			}
			return value;
		});
		return initialized;
	};

	const call = async <T>(method: string, params?: unknown): Promise<T> => {
		await initialize();
		return (await rawCall(method, params)) as T;
	};

	const runEvents = async (controller: AbortController): Promise<void> => {
		let delay = options.reconnectDelayMs ?? 250;
		const maximumDelay = options.maximumReconnectDelayMs ?? 5_000;
		while (!closed && handlers.size > 0 && eventController === controller) {
			try {
				const response = await fetchImpl(`${baseUrl}/api/v1/events`, {
					headers: {
						authorization: `Bearer ${options.token}`,
						...(lastEventId !== undefined ? { 'last-event-id': lastEventId } : {}),
					},
					signal: controller.signal,
				});
				if (!response.ok || !response.body) throw new Error(`Runtime SSE HTTP ${response.status}`);
				delay = options.reconnectDelayMs ?? 250;
				await consumeSse(response.body, (eventName, id, data) => {
					const envelope = parseRuntimeSseEnvelope(parseWireJson(data));
					if (eventName !== envelope.kind || id !== envelope.revision) {
						throw new Error('Runtime SSE metadata does not match its envelope');
					}
					lastEventId = envelope.revision;
					for (const change of changeEvents(
						envelope.kind,
						envelope.signals,
						envelope.kind === 'telemetry.changed' ? envelope.traceIds : undefined,
					)) {
						for (const handler of handlers) handler(change);
					}
				});
			} catch {
				if (controller.signal.aborted || closed || handlers.size === 0) return;
				await sleep(delay, controller.signal);
				delay = Math.min(maximumDelay, delay * 2);
			}
		}
	};

	const startEvents = (): void => {
		if (eventController || closed || handlers.size === 0) return;
		eventController = new AbortController();
		const controller = eventController;
		void initialize()
			.then(() => runEvents(controller))
			.catch(() => {})
			.finally(() => {
				if (eventController === controller) eventController = undefined;
			});
	};

	return {
		kind: 'otelux/datasource',
		initialize,
		getStatus: () => call('runtime/getStatus'),
		getSettings: () => call('runtime/getSettings'),
		updateSettings: (patch) => call('runtime/updateSettings', patch),
		loadSampleData: () => call('runtime/loadSampleData'),
		async clearData(): Promise<void> {
			await call('runtime/clearData', { confirmation: 'clear' });
		},
		listTraces: (query: ListTracesQuery) => call<ListTracesResult>('telemetry/listTraces', query),
		getTrace: (query: GetTraceQuery) => call<Trace>('telemetry/getTrace', query),
		getTraceWaterfall: (query: GetTraceQuery) => call<Trace>('telemetry/getTraceWaterfall', query),
		getSpanDetails: (query: GetSpanDetailsQuery) => call<SpanDetails>('telemetry/getSpan', query),
		listLogs: (query: ListLogsQuery) => call<ListLogsResult>('telemetry/listLogs', query),
		listMetrics: (query: ListMetricsQuery) => call<ListMetricsResult>('telemetry/listMetrics', query),
		listResourceFacets: (query: ListResourceFacetsQuery) =>
			call<ListResourceFacetsResult>('telemetry/getFacets', query),
		subscribe(handler: (event: ChangeEvent) => void): Disposable {
			if (closed) throw new Error('Runtime HTTP client is closed');
			handlers.add(handler);
			startEvents();
			return {
				dispose(): void {
					handlers.delete(handler);
					if (handlers.size === 0) {
						eventController?.abort();
						eventController = undefined;
					}
				},
			};
		},
		close(): void {
			closed = true;
			handlers.clear();
			eventController?.abort();
			eventController = undefined;
		},
	};
}

function isRpcResponse(value: unknown): value is RuntimeRpcResponse {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const input = value as Partial<RuntimeRpcResponse>;
	return (
		input.jsonrpc === JSON_RPC_VERSION && 'id' in input && ('result' in input || 'error' in input)
	);
}

function changeEvents(
	kind: 'telemetry.changed' | 'runtime.resync',
	signals: readonly string[],
	traceIds: readonly string[] | undefined,
): readonly ChangeEvent[] {
	const all = kind === 'runtime.resync';
	const result: ChangeEvent[] = [];
	if (all || signals.includes('traces'))
		result.push({ kind: 'tracesChanged', traceIds: traceIds ?? [] });
	if (all || signals.includes('logs')) result.push({ kind: 'logsChanged', count: 0 });
	if (all || signals.includes('metrics')) result.push({ kind: 'metricsChanged', count: 0 });
	return result;
}

async function consumeSse(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: string, id: string, data: string) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
			let boundary = buffer.indexOf('\n\n');
			while (boundary >= 0) {
				const block = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const parsed = parseSseBlock(block);
				if (parsed) onEvent(parsed.event, parsed.id, parsed.data);
				boundary = buffer.indexOf('\n\n');
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function parseSseBlock(block: string): { event: string; id: string; data: string } | undefined {
	let event = '';
	let id = '';
	const data: string[] = [];
	for (const line of block.split('\n')) {
		if (line.startsWith(':')) continue;
		const separator = line.indexOf(':');
		const field = separator >= 0 ? line.slice(0, separator) : line;
		const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : '';
		if (field === 'event') event = value;
		else if (field === 'id') id = value;
		else if (field === 'data') data.push(value);
	}
	return event && id && data.length > 0 ? { event, id, data: data.join('\n') } : undefined;
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, milliseconds);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

export const OTELUX_ADAPTER_HTTP_VERSION = '0.0.0' as const;
