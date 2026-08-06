import { describe, expect, it } from 'vitest';
import { type OteluxWindowBridge, createIpcDataSource } from './ipcDataSource.js';

function bridge(result: unknown): OteluxWindowBridge {
	return {
		version: 'test',
		runtime: {
			electron: 'test',
			chromium: 'test',
			node: 'test',
			platform: 'test',
		},
		invoke: async () => result,
		onEvent: () => () => {},
	};
}

describe('IPC DataSource result boundary', () => {
	it('sanitizes valid method results', async () => {
		const dataSource = createIpcDataSource(
			bridge({ rows: [], totalCount: 0, futureField: 'ignored' }),
		);
		await expect(dataSource.listTraces({})).resolves.toEqual({ rows: [], totalCount: 0 });
	});

	it('rejects malformed method results instead of trusting a cast', async () => {
		const dataSource = createIpcDataSource(bridge({ rows: [], totalCount: -1 }));
		await expect(dataSource.listTraces({})).rejects.toThrow('$.result.totalCount: must be between 0');
	});
});
