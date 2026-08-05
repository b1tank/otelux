import { timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type {
	RuntimeApiStatus,
	RuntimeRpcFailure,
	RuntimeRpcResponse,
	RuntimeSseEnvelope,
} from '@otelux/protocol';
import {
	JSON_RPC_VERSION,
	RUNTIME_RPC_ERROR,
	WireCodecError,
	parseWireJson,
	stringifyWire,
} from '@otelux/protocol';
import type { RuntimeEventProjector } from './runtimeEvents.js';
import type { RuntimeRpcDispatcher } from './runtimeRpc.js';

export interface RuntimeApiHostOptions {
	readonly dispatcher: RuntimeRpcDispatcher;
	readonly events: RuntimeEventProjector;
	readonly token: string;
	readonly host?: string;
	readonly maxBodyBytes?: number;
	readonly maxResponseBytes?: number;
	readonly maxConcurrentRpc?: number;
	readonly maxSseClients?: number;
}

export class RuntimeApiHost {
	private server: Server | undefined;
	private currentStatus: RuntimeApiStatus = { kind: 'starting' };
	private readonly listeners = new Set<(status: RuntimeApiStatus) => void>();
	private readonly sseResponses = new Set<ServerResponse>();
	private activeRpc = 0;
	private readonly host: string;
	private readonly maxBodyBytes: number;
	private readonly maxResponseBytes: number;
	private readonly maxConcurrentRpc: number;
	private readonly maxSseClients: number;

	constructor(private readonly options: RuntimeApiHostOptions) {
		this.host = options.host ?? '127.0.0.1';
		this.maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
		this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
		this.maxConcurrentRpc = options.maxConcurrentRpc ?? 64;
		this.maxSseClients = options.maxSseClients ?? 32;
	}

	get status(): RuntimeApiStatus {
		return this.currentStatus;
	}

	onChange(listener: (status: RuntimeApiStatus) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async start(port: number): Promise<RuntimeApiStatus> {
		await this.stop();
		this.setStatus({ kind: 'starting' });
		try {
			const server = createServer((request, response) => {
				void this.route(request, response).catch(() => {
					if (!response.headersSent) json(response, 500, { error: 'internal_error' });
					else response.destroy();
				});
			});
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(port, this.host, () => {
					server.off('error', reject);
					resolve();
				});
			});
			this.server = server;
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('Runtime API has no TCP address');
			this.setStatus({ kind: 'running', host: this.host, port: address.port });
		} catch (error) {
			this.setStatus({
				kind: 'error',
				host: this.host,
				port,
				message: error instanceof Error ? error.message : String(error),
			});
		}
		return this.currentStatus;
	}

	async stop(): Promise<void> {
		for (const response of this.sseResponses) response.destroy();
		this.sseResponses.clear();
		const server = this.server;
		this.server = undefined;
		if (server) {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	}

	private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (!this.validHost(request)) return json(response, 400, { error: 'invalid_host' });
		if (request.headers.origin !== undefined)
			return json(response, 403, { error: 'origin_forbidden' });
		const path = new URL(request.url ?? '/', `http://${request.headers.host}`).pathname;
		if (path === '/healthz') {
			if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
			return json(response, 200, { service: 'otelux-runtime', status: 'ok' });
		}
		if (path === '/api/v1/rpc') {
			if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
			if (!this.authorized(request)) return json(response, 401, { error: 'unauthorized' });
			const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
			if (mediaType !== 'application/json') {
				return json(response, 415, { error: 'unsupported_media_type' });
			}
			if (this.activeRpc >= this.maxConcurrentRpc) {
				return json(response, 503, { error: 'runtime_overloaded' });
			}
			this.activeRpc++;
			try {
				const body = await readBody(request, this.maxBodyBytes);
				let input: unknown;
				try {
					input = parseWireJson(body, { maxJsonCharacters: this.maxBodyBytes });
				} catch (error) {
					const parseError = error instanceof WireCodecError && error.code === 'invalid_json';
					return rpc(
						response,
						failure(
							parseError ? RUNTIME_RPC_ERROR.PARSE_ERROR : RUNTIME_RPC_ERROR.INVALID_REQUEST,
							parseError ? 'Parse error' : 'Invalid Request',
						),
						this.maxResponseBytes,
					);
				}
				if (Array.isArray(input)) {
					if (input.length === 0 || input.length > 10) {
						return rpc(
							response,
							failure(RUNTIME_RPC_ERROR.INVALID_REQUEST, 'Invalid Request'),
							this.maxResponseBytes,
						);
					}
					const results: RuntimeRpcResponse[] = [];
					for (const request of input) {
						const result = await this.options.dispatcher.handle(request);
						if (result !== undefined) results.push(result);
					}
					if (results.length === 0) {
						response.writeHead(204).end();
						return;
					}
					return rpc(response, results, this.maxResponseBytes);
				}
				const result = await this.options.dispatcher.handle(input);
				if (result === undefined) {
					response.writeHead(204).end();
					return;
				}
				return rpc(response, result, this.maxResponseBytes);
			} catch (error) {
				if (error instanceof BodyTooLargeError)
					return json(response, 413, { error: 'payload_too_large' });
				throw error;
			} finally {
				this.activeRpc--;
			}
		}
		if (path === '/api/v1/events') {
			if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
			if (!this.authorized(request)) return json(response, 401, { error: 'unauthorized' });
			if (this.sseResponses.size >= this.maxSseClients) {
				return json(response, 503, { error: 'runtime_overloaded' });
			}
			return this.openSse(request, response);
		}
		json(response, 404, { error: 'not_found' });
	}

	private openSse(request: IncomingMessage, response: ServerResponse): void {
		response.writeHead(200, {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-content-type-options': 'nosniff',
		});
		response.write(': connected\n\n');
		this.sseResponses.add(response);
		const write = (event: RuntimeSseEnvelope): void => {
			const accepted = response.write(
				`id: ${event.revision}\nevent: ${event.kind}\ndata: ${stringifyWire(event)}\n\n`,
			);
			if (!accepted) response.destroy(new Error('SSE client backpressure limit reached'));
		};
		for (const event of this.options.events.eventsSince(header(request, 'last-event-id')))
			write(event);
		const unsubscribe = this.options.events.subscribe(write);
		const heartbeat = setInterval(() => {
			if (!response.write(': keepalive\n\n')) response.destroy();
		}, 15_000);
		heartbeat.unref();
		request.once('close', () => {
			clearInterval(heartbeat);
			unsubscribe();
			this.sseResponses.delete(response);
		});
	}

	private validHost(request: IncomingMessage): boolean {
		if (this.currentStatus.kind !== 'running') return false;
		const value = request.headers.host?.toLowerCase();
		return (
			value === `${this.host}:${this.currentStatus.port}` ||
			value === `localhost:${this.currentStatus.port}`
		);
	}

	private authorized(request: IncomingMessage): boolean {
		const authorization = request.headers.authorization;
		if (!authorization?.startsWith('Bearer ')) return false;
		const supplied = Buffer.from(authorization.slice(7));
		const expected = Buffer.from(this.options.token);
		return supplied.length === expected.length && timingSafeEqual(supplied, expected);
	}

	private setStatus(status: RuntimeApiStatus): void {
		this.currentStatus = status;
		for (const listener of this.listeners) listener(status);
	}
}

class BodyTooLargeError extends Error {}

async function readBody(request: IncomingMessage, maximum: number): Promise<string> {
	const declared = Number(request.headers['content-length']);
	if (Number.isFinite(declared) && declared > maximum) throw new BodyTooLargeError();
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > maximum) throw new BodyTooLargeError();
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString('utf8');
}

function header(request: IncomingMessage, name: string): string | undefined {
	const value = request.headers[name];
	return Array.isArray(value) ? value[0] : value;
}

function failure(code: number, message: string): RuntimeRpcFailure {
	return { jsonrpc: JSON_RPC_VERSION, id: null, error: { code, message } };
}

function rpc(
	response: ServerResponse,
	value: RuntimeRpcResponse | readonly RuntimeRpcResponse[],
	maximumBytes: number,
): void {
	let body: string;
	try {
		body = stringifyWire(value, {
			maxTotalStringLength: maximumBytes,
			maxJsonCharacters: maximumBytes,
		});
		if (Buffer.byteLength(body) > maximumBytes)
			throw new WireCodecError('$', 'max_response_bytes', 'response exceeds byte budget');
	} catch (error) {
		if (!(error instanceof WireCodecError)) throw error;
		body = stringifyWire({
			jsonrpc: JSON_RPC_VERSION,
			id: Array.isArray(value) ? null : (value as RuntimeRpcResponse).id,
			error: {
				code: RUNTIME_RPC_ERROR.RESPONSE_TOO_LARGE,
				message: 'Response too large',
			},
		});
	}
	response.writeHead(200, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body),
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
	});
	response.end(body);
}

function json(response: ServerResponse, status: number, value: unknown): void {
	const body = JSON.stringify(value);
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body),
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
	});
	response.end(body);
}

function methodNotAllowed(response: ServerResponse, allowed: readonly string[]): void {
	response.setHeader('allow', allowed.join(', '));
	json(response, 405, { error: 'method_not_allowed' });
}
