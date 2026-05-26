/**
 * Host-side bridge implementation. Pipes a {@link DataSource} through
 * a VS Code webview-shaped `postMessage` channel.
 */

import type { DataSource, Disposable } from '@otelux/protocol';
import {
	type BridgeEnvelope,
	type BridgeMessage,
	type BridgeRequest,
	wrap,
	unwrap,
} from './protocol.js';

/**
 * Structural subset of `vscode.Webview` we depend on. Declared inline so
 * this package does not import the `vscode` module (it would not load
 * in tests or in non-VS Code embedders).
 */
export interface WebviewHostLike {
	// VS Code's real signature returns a `Thenable<boolean>`. We accept
	// any plain `boolean | Promise<boolean>` so the package does not need
	// `@types/vscode` (which would pull DOM-incompatible globals).
	postMessage(message: BridgeEnvelope): boolean | Promise<boolean>;
	onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
}

export interface ServeDataSourceOptions {
	readonly webview: WebviewHostLike;
	readonly dataSource: DataSource;
}

/**
 * Start serving a {@link DataSource} over the supplied webview channel.
 * Returns a `Disposable` that unsubscribes the engine listener and the
 * `onDidReceiveMessage` listener — call it when the webview goes away
 * (e.g. from a `WebviewPanel.onDidDispose` callback).
 *
 * The implementation deliberately swallows post failures: a webview that
 * has already been disposed surfaces a rejected `postMessage`, and we
 * do not want that to crash the extension host. The caller's
 * `Disposable.dispose()` is the correct lifecycle signal.
 */
export function serveDataSource(options: ServeDataSourceOptions): Disposable {
	const { webview, dataSource } = options;

	const post = (message: BridgeMessage): void => {
		try {
			const result = webview.postMessage(wrap(message));
			if (result && typeof (result as Promise<boolean>).then === 'function') {
				(result as Promise<boolean>).catch(() => {
					// Webview disposed mid-flight; ignore — the caller's
					// dispose() will tear everything down on the next tick.
				});
			}
		} catch {
			// Synchronous throw from a disposed webview. Same reasoning.
		}
	};

	const onMessage = webview.onDidReceiveMessage((raw) => {
		const message = unwrap(raw);
		if (message === undefined) {
			return;
		}
		// Only request envelopes are meaningful host-side. Responses and
		// events flow the other way; dropping them here is intentional.
		if (
			message.kind !== 'listTraces' &&
			message.kind !== 'getTrace' &&
			message.kind !== 'getSpanDetails'
		) {
			return;
		}
		void dispatch(message, dataSource).then(post);
	});

	const subscription = dataSource.subscribe((event) => {
		post({ kind: 'event', event });
	});

	return {
		dispose: () => {
			subscription.dispose();
			onMessage.dispose();
		},
	};
}

async function dispatch(request: BridgeRequest, ds: DataSource): Promise<BridgeMessage> {
	try {
		switch (request.kind) {
			case 'listTraces': {
				const result = await ds.listTraces(request.query);
				return { id: request.id, kind: 'result', payload: result };
			}
			case 'getTrace': {
				const result = await ds.getTrace(request.query);
				return { id: request.id, kind: 'result', payload: result };
			}
			case 'getSpanDetails': {
				const result = await ds.getSpanDetails(request.query);
				return { id: request.id, kind: 'result', payload: result };
			}
		}
	} catch (err) {
		return {
			id: request.id,
			kind: 'error',
			message: err instanceof Error ? err.message : String(err),
		};
	}
}
