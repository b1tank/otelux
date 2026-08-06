import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type RuntimeHttpClient, createHttpDataSource } from '@otelux/adapter-http';
import { type RuntimeState, parseRuntimeState } from '@otelux/protocol';
import { resolveOteluxDataDirectory } from './dataHome.js';
import { RUNTIME_STATE_FILE } from './runtimeState.js';

export type RuntimeClientDiscoveryErrorCode =
	| 'authentication'
	| 'invalid-state'
	| 'timeout'
	| 'unavailable';

export class RuntimeClientDiscoveryError extends Error {
	constructor(
		readonly code: RuntimeClientDiscoveryErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'RuntimeClientDiscoveryError';
	}
}

export interface ConnectRuntimeClientOptions {
	readonly dataDirectory?: string;
	readonly clientName?: string;
	readonly clientVersion?: string;
}

export interface EnsureRuntimeClientOptions extends ConnectRuntimeClientOptions {
	readonly start: () => void | Promise<void>;
	readonly timeoutMs?: number;
	readonly pollIntervalMs?: number;
}

export interface DiscoveredRuntimeClient {
	readonly state: RuntimeState;
	readonly client: RuntimeHttpClient;
}

/** Discover and authenticate the active runtime, or return undefined when no owner is published. */
export async function connectRuntimeClient(
	options: ConnectRuntimeClientOptions = {},
): Promise<DiscoveredRuntimeClient | undefined> {
	const dataDirectory = resolve(options.dataDirectory ?? resolveOteluxDataDirectory());
	const state = await readDiscoveryState(dataDirectory);
	if (!state) return undefined;
	if (state.api?.kind !== 'running') {
		throw new RuntimeClientDiscoveryError('unavailable', 'OTelux runtime API is not running');
	}
	const tokenFile = join(dataDirectory, 'runtime-token');
	if (state.runtimeTokenFile !== tokenFile) {
		throw new RuntimeClientDiscoveryError(
			'invalid-state',
			'Runtime state does not reference the canonical control token',
		);
	}
	const token = await readControlToken(tokenFile);
	const client = createHttpDataSource({
		baseUrl: `http://${state.api.host}:${state.api.port}`,
		token,
		clientName: options.clientName ?? 'otelux-node-client',
		clientVersion: options.clientVersion ?? '0.0.0',
	});
	try {
		await client.initialize();
		const status = await client.getStatus();
		if (status.instanceId !== state.instanceId) {
			throw new RuntimeClientDiscoveryError(
				'invalid-state',
				'Runtime discovery identity changed while connecting',
			);
		}
		return { state, client };
	} catch (error) {
		client.close();
		if (error instanceof RuntimeClientDiscoveryError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new RuntimeClientDiscoveryError(
			message.includes('HTTP 401') ? 'authentication' : 'unavailable',
			`Unable to connect to the discovered OTelux runtime: ${message}`,
			{ cause: error },
		);
	}
}

/** Discover an owner, start one when absent, and wait within a strict deadline. */
export async function ensureRuntimeClient(
	options: EnsureRuntimeClientOptions,
): Promise<DiscoveredRuntimeClient> {
	const timeoutMs = positiveInteger(options.timeoutMs, 10_000, 'timeoutMs');
	const pollIntervalMs = positiveInteger(options.pollIntervalMs, 50, 'pollIntervalMs');
	const initial = await connectRuntimeClient(options);
	if (initial) return initial;
	await options.start();
	const deadline = Date.now() + timeoutMs;
	let lastUnavailable: RuntimeClientDiscoveryError | undefined;
	while (Date.now() < deadline) {
		try {
			const connected = await connectRuntimeClient(options);
			if (connected) return connected;
		} catch (error) {
			if (!(error instanceof RuntimeClientDiscoveryError) || error.code !== 'unavailable') {
				throw error;
			}
			lastUnavailable = error;
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	throw new RuntimeClientDiscoveryError(
		'timeout',
		`Timed out after ${timeoutMs} ms waiting for the OTelux runtime`,
		lastUnavailable ? { cause: lastUnavailable } : undefined,
	);
}

async function readDiscoveryState(dataDirectory: string): Promise<RuntimeState | undefined> {
	try {
		return parseRuntimeState(
			JSON.parse(await readFile(join(dataDirectory, RUNTIME_STATE_FILE), 'utf8')),
		);
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') return undefined;
		throw new RuntimeClientDiscoveryError('invalid-state', 'Runtime discovery state is malformed', {
			cause: error,
		});
	}
}

async function readControlToken(path: string): Promise<string> {
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink()) throw new Error('token is not a regular file');
		if (process.platform !== 'win32') {
			if ((info.mode & 0o077) !== 0) throw new Error('token permissions are not owner-only');
			if (process.getuid && info.uid !== process.getuid())
				throw new Error('token owner is not current user');
		}
		const token = (await readFile(path, 'utf8')).trim();
		if (!token) throw new Error('token is empty');
		return token;
	} catch (error) {
		throw new RuntimeClientDiscoveryError('authentication', 'Runtime control token is unavailable', {
			cause: error,
		});
	}
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isInteger(result) || result <= 0) {
		throw new RangeError(`${name} must be a positive integer`);
	}
	return result;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}
