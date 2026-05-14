import type { Engine } from '@otelux/engine';
import { type Receiver, createReceiver } from '@otelux/receiver';
import type { ReceiverStatus } from '../shared/ipc.js';

/**
 * Wraps {@link createReceiver} with start/stop/restart and reified
 * lifecycle state. Bind failures (EADDRINUSE, EACCES) become
 * `{ kind: 'error', ... }` status rather than thrown exceptions so the
 * app stays usable when a port is taken — the renderer can show the
 * error and let the user pick a different port.
 */
export class ReceiverHost {
	private receiver: Receiver | undefined;
	private currentStatus: ReceiverStatus = { kind: 'starting' };
	private readonly listeners = new Set<(status: ReceiverStatus) => void>();

	constructor(
		private readonly engine: Engine,
		private readonly host: string,
	) {}

	get status(): ReceiverStatus {
		return this.currentStatus;
	}

	onChange(listener: (status: ReceiverStatus) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Bind on the requested port. Tears down a previously-running receiver
	 * first so callers can safely use this for restarts. Returns the new
	 * status so the caller can branch on success/error without subscribing.
	 */
	async start(port: number): Promise<ReceiverStatus> {
		await this.stop();
		this.setStatus({ kind: 'starting' });
		try {
			const receiver = createReceiver({ engine: this.engine, port, host: this.host });
			await receiver.start();
			this.receiver = receiver;
			this.setStatus({ kind: 'running', port: receiver.port, host: this.host });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.setStatus({ kind: 'error', port, host: this.host, message });
		}
		return this.currentStatus;
	}

	async stop(): Promise<void> {
		const r = this.receiver;
		this.receiver = undefined;
		if (r) {
			await r.stop();
		}
	}

	private setStatus(status: ReceiverStatus): void {
		this.currentStatus = status;
		for (const listener of this.listeners) {
			listener(status);
		}
	}
}
