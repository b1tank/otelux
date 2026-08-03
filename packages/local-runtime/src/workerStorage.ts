import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Storage } from '@otelux/engine';
import type { RetentionConfig } from '@otelux/engine-node';
import type { StorageUsageInfo } from '@otelux/protocol';

export interface WorkerSqliteStorage extends Storage {
	getStorageUsage(): Promise<StorageUsageInfo>;
	applyRetention(config: RetentionConfig): Promise<void>;
}

interface ResponseMessage {
	readonly id: number;
	readonly result?: unknown;
	readonly error?: string;
}

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
let storage;
import(workerData.moduleUrl).then(({ createNodeSqliteStorage }) => {
  storage = createNodeSqliteStorage(workerData.options);
  parentPort.postMessage({ id: 0, result: true });
  parentPort.on('message', ({ id, method, args }) => {
    try {
      const result = storage[method](...args);
      parentPort.postMessage({ id, result });
    } catch (error) {
      parentPort.postMessage({ id, error: error instanceof Error ? error.stack || error.message : String(error) });
    }
  });
}).catch((error) => {
  parentPort.postMessage({ id: 0, error: error instanceof Error ? error.stack || error.message : String(error) });
});
`;

/** Async Storage facade: every node:sqlite operation executes in one worker. */
export async function createWorkerSqliteStorage(options: {
	readonly path: string;
	readonly retention: RetentionConfig;
}): Promise<WorkerSqliteStorage> {
	const require = createRequire(import.meta.url);
	const cjsPath = require.resolve('@otelux/engine-node');
	const moduleUrl = pathToFileURL(cjsPath.replace(/index\.cjs$/, 'index.js')).href;
	const worker = new Worker(WORKER_SOURCE, {
		eval: true,
		workerData: { moduleUrl, options },
	});
	let nextId = 1;
	let closed = false;
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (reason: Error) => void }
	>();
	const ready = new Promise<void>((resolve, reject) => {
		pending.set(0, { resolve: () => resolve(), reject });
	});

	worker.on('message', (message: ResponseMessage) => {
		const request = pending.get(message.id);
		if (!request) return;
		pending.delete(message.id);
		if (message.error !== undefined) request.reject(new Error(message.error));
		else request.resolve(message.result);
	});
	const fail = (cause: Error): void => {
		for (const request of pending.values()) request.reject(cause);
		pending.clear();
	};
	worker.on('error', fail);
	worker.on('exit', (code) => {
		if (!closed && code !== 0) fail(new Error(`SQLite worker exited with code ${code}`));
	});
	await ready;

	const call = <T>(method: string, ...args: readonly unknown[]): Promise<T> => {
		if (closed) return Promise.reject(new Error('SQLite worker is closed'));
		const id = nextId++;
		return new Promise<T>((resolve, reject) => {
			pending.set(id, { resolve: (value) => resolve(value as T), reject });
			worker.postMessage({ id, method, args });
		});
	};

	return {
		kind: 'otelux/storage',
		writeSpans: (spans) => call('writeSpans', spans),
		listTraces: (query) => call('listTraces', query),
		getTraceSpans: (traceId) => call('getTraceSpans', traceId),
		getSpan: (traceId, spanId) => call('getSpan', traceId, spanId),
		writeLogs: (logs) => call('writeLogs', logs),
		listLogs: (query) => call('listLogs', query),
		writeMetrics: (metrics) => call('writeMetrics', metrics),
		listMetrics: (query) => call('listMetrics', query),
		listResourceFacets: (query) => call('listResourceFacets', query),
		getStorageUsage: () => call('getStorageUsage'),
		applyRetention: (config) => call('applyRetention', config),
		clear: () => call('clear'),
		async close(): Promise<void> {
			if (closed) return;
			await call('close');
			closed = true;
			await worker.terminate();
		},
	};
}
