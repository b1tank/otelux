import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogRecord } from '@otelux/types';
import { describe, expect, it } from 'vitest';
import { createWorkerSqliteStorage } from './workerStorage.js';

const log = (index: number): LogRecord => ({
	timeUnixNano: BigInt(index + 1),
	severityNumber: 9,
	body: `worker log ${index}`,
	attributes: {},
	resource: { attributes: { 'service.name': 'worker-test' } },
	scope: { name: 'worker-test' },
});

describe('worker sqlite storage', () => {
	it('executes durable storage operations off the caller event loop', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'otelux-worker-storage-'));
		const storage = await createWorkerSqliteStorage({
			path: join(directory, 'otelux.db'),
			retention: { maxAgeHours: 0, maxSizeMb: 0 },
		});
		try {
			let timerFired = false;
			const timer = new Promise<void>((resolve) =>
				setTimeout(() => {
					timerFired = true;
					resolve();
				}, 0),
			);
			const write = storage.writeLogs(Array.from({ length: 5_000 }, (_, index) => log(index)));
			await timer;
			expect(timerFired).toBe(true);
			await write;
			expect((await storage.listLogs({ limit: 10 })).totalCount).toBe(5_000);
			expect((await storage.getStorageUsage()).databaseFileBytes).toBeGreaterThan(0);
		} finally {
			await storage.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
