import { describe, expect, it } from 'vitest';
import { parseRuntimeSseEnvelope } from './index.js';

const traceId = '0123456789abcdef0123456789abcdef';

describe('Runtime SSE envelope validation', () => {
	it('accepts changed and resync envelopes', () => {
		expect(
			parseRuntimeSseEnvelope({
				schemaVersion: 1,
				revision: '42',
				kind: 'telemetry.changed',
				signals: ['traces', 'logs'],
				traceIds: [traceId],
			}),
		).toMatchObject({ revision: '42', signals: ['traces', 'logs'] });
		expect(
			parseRuntimeSseEnvelope({
				schemaVersion: 1,
				revision: '0',
				kind: 'runtime.resync',
				signals: ['status'],
			}),
		).toMatchObject({ kind: 'runtime.resync' });
	});

	it('rejects malformed revisions, duplicate signals, IDs, and extra fields', () => {
		expect(() =>
			parseRuntimeSseEnvelope({
				schemaVersion: 1,
				revision: '01',
				kind: 'runtime.resync',
				signals: ['status'],
			}),
		).toThrow('$.revision: expected a canonical decimal revision');
		expect(() =>
			parseRuntimeSseEnvelope({
				schemaVersion: 1,
				revision: '1',
				kind: 'telemetry.changed',
				signals: ['logs', 'logs'],
			}),
		).toThrow('$.signals[1]: duplicate signal');
		expect(() =>
			parseRuntimeSseEnvelope({
				schemaVersion: 1,
				revision: '1',
				kind: 'telemetry.changed',
				signals: ['traces'],
				traceIds: ['abc'],
			}),
		).toThrow('$.traceIds[0]: expected a lowercase hexadecimal trace ID');
		expect(() =>
			parseRuntimeSseEnvelope({
				schemaVersion: 1,
				revision: '1',
				kind: 'runtime.resync',
				signals: ['status'],
				secret: 'nope',
			}),
		).toThrow('$.secret: field is not allowed');
	});
});
