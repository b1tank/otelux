import type { Engine } from '@otelux/engine';
import type { ReceiverStatus } from '@otelux/protocol';
import { type Receiver, createReceiver } from '@otelux/receiver';

export class ReceiverHost {
	private receiver: Receiver | undefined;
	private currentStatus: ReceiverStatus = { kind: 'starting' };
	private readonly listeners = new Set<(status: ReceiverStatus) => void>();

	constructor(
		private readonly engine: Engine,
		private readonly host: string,
		private readonly maxBodyBytes?: number,
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

	async start(port: number): Promise<ReceiverStatus> {
		await this.stop();
		this.setStatus({ kind: 'starting' });
		try {
			const receiver = createReceiver({
				engine: this.engine,
				port,
				host: this.host,
				...(this.maxBodyBytes !== undefined ? { maxBodyBytes: this.maxBodyBytes } : {}),
			});
			await receiver.start();
			this.receiver = receiver;
			this.setStatus({ kind: 'running', port: receiver.port, host: this.host });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus({ kind: 'error', port, host: this.host, message });
		}
		return this.currentStatus;
	}

	async stop(): Promise<void> {
		const receiver = this.receiver;
		this.receiver = undefined;
		if (receiver) {
			await receiver.stop();
		}
	}

	private setStatus(status: ReceiverStatus): void {
		this.currentStatus = status;
		for (const listener of this.listeners) {
			listener(status);
		}
	}
}
