import { describe, expect, it } from 'vitest';
import type {
	ChangeEvent,
	DataSource,
	Disposable,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListTracesQuery,
	ListTracesResult,
	SpanDetails,
} from '@otelux/protocol';
import type { Span, Trace } from '@otelux/types';
import { serveDataSource, type WebviewHostLike } from './host.js';
import { createPostMessageDataSource } from './webview.js';
import { type BridgeEnvelope, unwrap } from './protocol.js';

/**
 * In-memory test rig: a pair of postMessage channels that pipe envelopes
 * between a fake webview and a fake extension host so the same protocol
 * code runs end-to-end without VS Code or a browser.
 */
function pair(): {
	host: WebviewHostLike;
	webview: { postMessage: (envelope: BridgeEnvelope) => void };
	target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
} {
	const toWebview = new EventTarget();
	const hostListeners = new Set<(message: unknown) => void>();

	const host: WebviewHostLike = {
		postMessage: (envelope: BridgeEnvelope) => {
			toWebview.dispatchEvent(new MessageEvent('message', { data: envelope }));
			return true;
		},
		onDidReceiveMessage: (listener: (message: unknown) => void): Disposable => {
			hostListeners.add(listener);
			return { dispose: () => hostListeners.delete(listener) };
		},
	};

	const webview = {
		postMessage: (envelope: BridgeEnvelope) => {
			for (const listener of hostListeners) {
				listener(envelope);
			}
		},
	};

	return { host, webview, target: toWebview };
}

function fakeDataSource(): { ds: DataSource; emit: (event: ChangeEvent) => void } {
	const subscribers = new Set<(event: ChangeEvent) => void>();
	const ds: DataSource = {
		kind: 'otelux/datasource',
		async listTraces(_query: ListTracesQuery): Promise<ListTracesResult> {
			return { rows: [], totalCount: 0 };
		},
		async getTrace(query: GetTraceQuery): Promise<Trace> {
			return {
				traceId: query.traceId,
				spans: [] as readonly Span[],
				startTimeUnixNano: 0n,
				endTimeUnixNano: 0n,
				durationNanos: 0n,
				services: [],
				spanCount: 0,
				errorCount: 0,
			};
		},
		async getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails> {
			throw new Error(`span ${query.spanId} not found`);
		},
		subscribe(handler) {
			subscribers.add(handler);
			return { dispose: () => subscribers.delete(handler) };
		},
	};
	return {
		ds,
		emit: (event) => {
			for (const s of subscribers) {
				s(event);
			}
		},
	};
}

describe('adapter-vscode bridge', () => {
	it('round-trips a listTraces request through the wire', async () => {
		const { host, webview, target } = pair();
		const { ds } = fakeDataSource();
		const server = serveDataSource({ webview: host, dataSource: ds });
		const client = createPostMessageDataSource({ vscode: webview, target });

		const result = await client.listTraces({});
		expect(result.totalCount).toBe(0);
		server.dispose();
	});

	it('surfaces engine errors as rejected promises on the webview side', async () => {
		const { host, webview, target } = pair();
		const { ds } = fakeDataSource();
		const server = serveDataSource({ webview: host, dataSource: ds });
		const client = createPostMessageDataSource({ vscode: webview, target });

		await expect(client.getSpanDetails({ spanId: 'missing' as never })).rejects.toThrow(
			/missing not found/,
		);
		server.dispose();
	});

	it('forwards ChangeEvents from the engine through to subscribers', async () => {
		const { host, webview, target } = pair();
		const { ds, emit } = fakeDataSource();
		const server = serveDataSource({ webview: host, dataSource: ds });
		const client = createPostMessageDataSource({ vscode: webview, target });

		const seen: ChangeEvent[] = [];
		const sub = client.subscribe((event) => seen.push(event));
		emit({ kind: 'tracesChanged', traceIds: ['t1' as never] });

		expect(seen).toEqual([{ kind: 'tracesChanged', traceIds: ['t1'] }]);
		sub.dispose();
		server.dispose();
	});

	it('ignores foreign messages that lack the OTelux envelope tag', () => {
		const message = unwrap({ from: 'someone-else', data: { id: 1 } });
		expect(message).toBeUndefined();
	});
});
