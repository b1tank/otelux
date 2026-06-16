/**
 * Webview-side bridge implementation. Returns a {@link DataSource}
 * whose every method round-trips through `acquireVsCodeApi().postMessage`.
 */

import type {
	ChangeEvent,
	DataSource,
	Disposable,
	GetSpanDetailsQuery,
	GetTraceQuery,
	ListLogsQuery,
	ListLogsResult,
	ListTracesQuery,
	ListTracesResult,
	SpanDetails,
} from '@otelux/protocol';
import type { Trace } from '@otelux/types';
import {
	type BridgeEnvelope,
	type BridgeMessage,
	type BridgeResponse,
	unwrap,
	wrap,
} from './protocol.js';

/**
 * Structural subset of the object returned by VS Code's
 * `acquireVsCodeApi()`. Declared inline so this module bundles in any
 * webview environment, including the Storybook story rig where we mock
 * the API surface for visual tests.
 */
export interface VsCodeWebviewApiLike {
	postMessage(message: BridgeEnvelope): void;
}

export interface CreatePostMessageDataSourceOptions {
	readonly vscode: VsCodeWebviewApiLike;
	/**
	 * Target for `addEventListener('message', ...)`. Defaults to the
	 * ambient `window` when running in a real webview. Tests inject a
	 * fake EventTarget.
	 */
	readonly target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/**
 * Build a `DataSource` that forwards every call as a `postMessage`
 * request. Concurrent calls are multiplexed by a monotonically
 * increasing numeric `id` — there is no global broker, just a `Map` of
 * pending resolvers tied to this DataSource instance.
 */
export function createPostMessageDataSource(
	options: CreatePostMessageDataSourceOptions,
): DataSource {
	const { vscode } = options;
	const target =
		options.target ??
		(typeof window !== 'undefined'
			? (window as unknown as Pick<EventTarget, 'addEventListener' | 'removeEventListener'>)
			: undefined);
	if (!target) {
		throw new Error(
			'@otelux/adapter-vscode: no message target available — pass `target` when running outside a browser/webview.',
		);
	}

	let nextId = 1;
	const pending = new Map<number, (response: BridgeResponse) => void>();
	const subscribers = new Set<(event: ChangeEvent) => void>();

	const onMessage = (raw: Event): void => {
		// Standard MessageEvent carries the host payload on `.data`.
		const data = (raw as MessageEvent).data as unknown;
		const message = unwrap(data);
		if (message === undefined) {
			return;
		}
		if (message.kind === 'event') {
			for (const subscriber of subscribers) {
				try {
					subscriber(message.event);
				} catch {
					// Subscribers must not corrupt the bridge. Swallow.
				}
			}
			return;
		}
		if (message.kind === 'result' || message.kind === 'error') {
			const resolver = pending.get(message.id);
			if (resolver) {
				pending.delete(message.id);
				resolver(message);
			}
		}
	};

	target.addEventListener('message', onMessage as EventListener);

	function request<TResult>(make: (id: number) => BridgeMessage): Promise<TResult> {
		return new Promise<TResult>((resolve, reject) => {
			const id = nextId++;
			pending.set(id, (response) => {
				if (response.kind === 'result') {
					resolve(response.payload as TResult);
				} else {
					reject(new Error(response.message));
				}
			});
			vscode.postMessage(wrap(make(id)));
		});
	}

	return {
		kind: 'otelux/datasource',
		listTraces(query: ListTracesQuery): Promise<ListTracesResult> {
			return request<ListTracesResult>((id) => ({ id, kind: 'listTraces', query }));
		},
		getTrace(query: GetTraceQuery): Promise<Trace> {
			return request<Trace>((id) => ({ id, kind: 'getTrace', query }));
		},
		getSpanDetails(query: GetSpanDetailsQuery): Promise<SpanDetails> {
			return request<SpanDetails>((id) => ({ id, kind: 'getSpanDetails', query }));
		},
		listLogs(query: ListLogsQuery): Promise<ListLogsResult> {
			return request<ListLogsResult>((id) => ({ id, kind: 'listLogs', query }));
		},
		subscribe(handler: (event: ChangeEvent) => void): Disposable {
			subscribers.add(handler);
			return {
				dispose: () => {
					subscribers.delete(handler);
				},
			};
		},
	};
}
