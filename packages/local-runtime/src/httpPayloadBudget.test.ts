import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpDataSource } from '@otelux/adapter-http';
import { DEFAULT_SETTINGS } from '@otelux/protocol';
import { describe, expect, it } from 'vitest';
import { createLocalRuntime } from './runtime.js';

const silentLogger = { info: (): void => {}, error: (): void => {} };

describe('Runtime HTTP payload budgets', () => {
	it('keeps a large log page bounded and loads one selected record separately', async () => {
		const directory = await fs.mkdtemp(join(tmpdir(), 'otelux-http-budget-'));
		await fs.writeFile(
			join(directory, 'settings.json'),
			JSON.stringify({
				...DEFAULT_SETTINGS,
				mcp: { enabled: false, port: 4320 },
				retention: { maxAgeHours: 0, maxSizeMb: 0 },
			}),
		);
		const runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			apiPortOverride: 0,
			logger: silentLogger,
		});
		try {
			const receiver = runtime.getReceiverStatus();
			const api = runtime.getApiStatus();
			if (receiver.kind !== 'running' || api.kind !== 'running') throw new Error('runtime missing');
			const records = Array.from({ length: 30 }, (_, index) => ({
				timeUnixNano: String(1_700_000_000_000_000_000n + BigInt(index)),
				severityNumber: 9,
				body: { stringValue: `${index}:${'x'.repeat(100_000)}` },
			}));
			const ingest = await fetch(`http://${receiver.host}:${receiver.port}/v1/logs`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					resourceLogs: [
						{
							resource: {
								attributes: [{ key: 'service.name', value: { stringValue: 'budget-test' } }],
							},
							scopeLogs: [{ scope: { name: 'budget-test' }, logRecords: records }],
						},
					],
				}),
			});
			expect(ingest.status).toBe(200);
			const token = (await fs.readFile(runtime.runtimeTokenFile, 'utf8')).trim();
			const client = createHttpDataSource({
				baseUrl: `http://${api.host}:${api.port}`,
				token,
			});
			const page = await client.listLogs({ limit: 30 });
			expect(page.rows).toHaveLength(30);
			expect(page.rows.every((row) => row.message.length <= 4_096)).toBe(true);
			expect(
				JSON.stringify(page, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
					.length,
			).toBeLessThan(150_000);
			const first = page.rows[0];
			if (!first) throw new Error('expected a log row');
			const details = await client.getLogDetails({ logId: first.logId });
			expect(String(details.body).length).toBeGreaterThan(100_000);
			client.close();
		} finally {
			await runtime.close();
			await fs.rm(directory, { recursive: true, force: true });
		}
	}, 15_000);
});
