import { ProtocolValidationError } from './validation.js';

export const RUNTIME_EVENT_SCHEMA_VERSION = 1 as const;
export type RuntimeEventSignal = 'traces' | 'logs' | 'metrics' | 'settings' | 'status';

export type RuntimeSseEnvelope =
	| {
			readonly schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
			readonly revision: string;
			readonly kind: 'telemetry.changed';
			readonly signals: readonly RuntimeEventSignal[];
			readonly traceIds?: readonly string[];
	  }
	| {
			readonly schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
			readonly revision: string;
			readonly kind: 'runtime.resync';
			readonly signals: readonly RuntimeEventSignal[];
	  };

const REVISION = /^(0|[1-9][0-9]*)$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SIGNALS: readonly RuntimeEventSignal[] = ['traces', 'logs', 'metrics', 'settings', 'status'];

export function parseRuntimeSseEnvelope(value: unknown): RuntimeSseEnvelope {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ProtocolValidationError('$', 'type', 'expected an object');
	}
	const input = value as Record<string, unknown>;
	if (input.schemaVersion !== RUNTIME_EVENT_SCHEMA_VERSION) {
		throw new ProtocolValidationError('$.schemaVersion', 'literal', 'expected 1');
	}
	if (typeof input.revision !== 'string' || !REVISION.test(input.revision)) {
		throw new ProtocolValidationError(
			'$.revision',
			'format',
			'expected a canonical decimal revision',
		);
	}
	if (input.kind !== 'telemetry.changed' && input.kind !== 'runtime.resync') {
		throw new ProtocolValidationError('$.kind', 'discriminator', 'unknown SSE event kind');
	}
	if (!Array.isArray(input.signals) || input.signals.length === 0 || input.signals.length > 5) {
		throw new ProtocolValidationError('$.signals', 'items', 'expected 1 to 5 signals');
	}
	const seen = new Set<RuntimeEventSignal>();
	const signals = input.signals.map((signal, index) => {
		if (typeof signal !== 'string' || !SIGNALS.includes(signal as RuntimeEventSignal)) {
			throw new ProtocolValidationError(`$.signals[${index}]`, 'enum', 'unknown signal');
		}
		if (seen.has(signal as RuntimeEventSignal)) {
			throw new ProtocolValidationError(`$.signals[${index}]`, 'unique', 'duplicate signal');
		}
		seen.add(signal as RuntimeEventSignal);
		return signal as RuntimeEventSignal;
	});
	if (input.kind === 'runtime.resync') {
		for (const key of Object.keys(input)) {
			if (!['schemaVersion', 'revision', 'kind', 'signals'].includes(key)) {
				throw new ProtocolValidationError(`$.${key}`, 'unknown_field', 'field is not allowed');
			}
		}
		return { schemaVersion: 1, revision: input.revision, kind: input.kind, signals };
	}
	for (const key of Object.keys(input)) {
		if (!['schemaVersion', 'revision', 'kind', 'signals', 'traceIds'].includes(key)) {
			throw new ProtocolValidationError(`$.${key}`, 'unknown_field', 'field is not allowed');
		}
	}
	let traceIds: readonly string[] | undefined;
	if ('traceIds' in input) {
		if (!Array.isArray(input.traceIds) || input.traceIds.length > 1_000) {
			throw new ProtocolValidationError('$.traceIds', 'max_items', 'expected at most 1000 trace IDs');
		}
		traceIds = input.traceIds.map((traceId, index) => {
			if (typeof traceId !== 'string' || !TRACE_ID.test(traceId)) {
				throw new ProtocolValidationError(
					`$.traceIds[${index}]`,
					'format',
					'expected a lowercase hexadecimal trace ID',
				);
			}
			return traceId;
		});
	}
	return {
		schemaVersion: 1,
		revision: input.revision,
		kind: input.kind,
		signals,
		...(traceIds ? { traceIds } : {}),
	};
}
