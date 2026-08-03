import type { Engine } from '@otelux/engine';
import type { ReceiverPressure, ReceiverStatus } from '@otelux/protocol';
import { type Receiver, createReceiver } from '@otelux/receiver';

function emptyPressure(): ReceiverPressure {
	return { overloadedTraces: 0, overloadedLogs: 0, overloadedMetrics: 0 };
}

export class ReceiverHost {
	private receiver: Receiver | undefined;
	private currentStatus: ReceiverStatus = { kind: 'starting' };
	private readonly listeners = new Set<(status: ReceiverStatus) => void>();
	private pressure: ReceiverPressure = emptyPressure();

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
		this.pressure = emptyPressure();
		this.setStatus({ kind: 'starting' });
		try {
			const receiver = createReceiver({
				engine: this.engine,
				port,
				host: this.host,
				...(this.maxBodyBytes !== undefined ? { maxBodyBytes: this.maxBodyBytes } : {}),
				onOverload: (signal) => this.recordOverload(signal),
			});
			await receiver.start();
			this.receiver = receiver;
			this.setStatus({
				kind: 'running',
				port: receiver.port,
				host: this.host,
				pressure: this.pressure,
			});
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

	private recordOverload(signal: 'traces' | 'logs' | 'metrics'): void {
		this.pressure = {
			overloadedTraces: this.pressure.overloadedTraces + (signal === 'traces' ? 1 : 0),
			overloadedLogs: this.pressure.overloadedLogs + (signal === 'logs' ? 1 : 0),
			overloadedMetrics: this.pressure.overloadedMetrics + (signal === 'metrics' ? 1 : 0),
		};
		if (this.currentStatus.kind === 'running') {
			this.setStatus({ ...this.currentStatus, pressure: this.pressure });
		}
	}

	private setStatus(status: ReceiverStatus): void {
		this.currentStatus = status;
		for (const listener of this.listeners) {
			listener(status);
		}
	}
}
