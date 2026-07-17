import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ChangeEvent, DataSource, ListTracesQuery, ListTracesResult } from './index.js';
import { OTELUX_PROTOCOL_VERSION } from './index.js';

describe('@otelux/protocol', () => {
	it('DataSource exposes the current core surface', () => {
		expectTypeOf<DataSource>().toHaveProperty('listTraces');
		expectTypeOf<DataSource>().toHaveProperty('getTrace');
		expectTypeOf<DataSource>().toHaveProperty('getSpanDetails');
		expectTypeOf<DataSource>().toHaveProperty('subscribe');
	});

	it('ListTracesQuery filter fields are optional', () => {
		const q: ListTracesQuery = {};
		expect(q).toEqual({});
	});

	it('ChangeEvent uses a discriminating kind', () => {
		const ev: ChangeEvent = { kind: 'tracesChanged', traceIds: ['abc'] };
		expect(ev.kind).toBe('tracesChanged');
	});

	it('ListTracesResult carries rows and total count', () => {
		const r: ListTracesResult = { rows: [], totalCount: 0 };
		expect(r.totalCount).toBe(0);
	});

	it('exports a 0.2.0 protocol version', () => {
		expect(OTELUX_PROTOCOL_VERSION).toBe('0.2.0');
	});
});
