import type { RuntimeEvent, RuntimeEventSignal, RuntimeSseEnvelope } from '@otelux/protocol';

export interface RuntimeEventProjector {
	accept(event: RuntimeEvent): void;
	currentRevision(): string;
	eventsSince(lastEventId: string | undefined): readonly RuntimeSseEnvelope[];
	subscribe(listener: (event: RuntimeSseEnvelope) => void): () => void;
	close(): void;
}

export interface RuntimeEventProjectorOptions {
	readonly historyLimit?: number;
	readonly traceIdLimit?: number;
}

export function createRuntimeEventProjector(
	options: RuntimeEventProjectorOptions = {},
): RuntimeEventProjector {
	const historyLimit = options.historyLimit ?? 256;
	const traceIdLimit = options.traceIdLimit ?? 1_000;
	if (!Number.isInteger(historyLimit) || historyLimit < 1) {
		throw new Error('historyLimit must be a positive integer');
	}
	if (!Number.isInteger(traceIdLimit) || traceIdLimit < 0 || traceIdLimit > 1_000) {
		throw new Error('traceIdLimit must be an integer between 0 and 1000');
	}
	const history: RuntimeSseEnvelope[] = [];
	const listeners = new Set<(event: RuntimeSseEnvelope) => void>();
	const pendingSignals = new Set<RuntimeEventSignal>();
	const pendingTraceIds = new Set<string>();
	let revision = 0n;
	let scheduled = false;
	let closed = false;

	const flush = (): void => {
		scheduled = false;
		if (closed || pendingSignals.size === 0) return;
		revision++;
		const signals = orderedSignals(pendingSignals);
		const traceIds = [...pendingTraceIds];
		pendingSignals.clear();
		pendingTraceIds.clear();
		const envelope: RuntimeSseEnvelope = {
			schemaVersion: 1,
			revision: revision.toString(10),
			kind: 'telemetry.changed',
			signals,
			...(traceIds.length > 0 ? { traceIds } : {}),
		};
		history.push(envelope);
		if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
		for (const listener of listeners) listener(envelope);
	};

	return {
		accept(event): void {
			if (closed) return;
			for (const signal of signalsFor(event)) pendingSignals.add(signal);
			if (event.kind === 'tracesChanged') {
				for (const traceId of event.traceIds) {
					if (pendingTraceIds.size >= traceIdLimit) break;
					pendingTraceIds.add(traceId);
				}
			}
			if (!scheduled) {
				scheduled = true;
				queueMicrotask(flush);
			}
		},
		currentRevision: () => revision.toString(10),
		eventsSince(lastEventId): readonly RuntimeSseEnvelope[] {
			if (lastEventId === undefined || lastEventId === revision.toString(10)) return [];
			if (!/^(0|[1-9][0-9]*)$/.test(lastEventId)) return [resync(revision)];
			const last = BigInt(lastEventId);
			if (last > revision) return [resync(revision)];
			if (last === 0n && history.length > 0 && BigInt(history[0]?.revision ?? '0') === 1n) {
				return [...history];
			}
			const index = history.findIndex((event) => event.revision === lastEventId);
			return index >= 0 ? history.slice(index + 1) : [resync(revision)];
		},
		subscribe(listener): () => void {
			if (closed) return () => {};
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close(): void {
			closed = true;
			pendingSignals.clear();
			pendingTraceIds.clear();
			listeners.clear();
			history.length = 0;
		},
	};
}

function signalsFor(event: RuntimeEvent): readonly RuntimeEventSignal[] {
	switch (event.kind) {
		case 'tracesChanged':
			return ['traces'];
		case 'logsChanged':
			return ['logs'];
		case 'metricsChanged':
			return ['metrics'];
		case 'settings-changed':
			return ['settings'];
		case 'receiver-status-changed':
		case 'mcp-status-changed':
		case 'api-status-changed':
			return ['status'];
	}
}

function orderedSignals(signals: ReadonlySet<RuntimeEventSignal>): readonly RuntimeEventSignal[] {
	return (['traces', 'logs', 'metrics', 'settings', 'status'] as const).filter((signal) =>
		signals.has(signal),
	);
}

function resync(revision: bigint): RuntimeSseEnvelope {
	return {
		schemaVersion: 1,
		revision: revision.toString(10),
		kind: 'runtime.resync',
		signals: ['traces', 'logs', 'metrics', 'settings', 'status'],
	};
}
