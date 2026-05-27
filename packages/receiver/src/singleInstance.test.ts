import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimSingleInstance } from './singleInstance.js';

describe('claimSingleInstance', () => {
	let workDir: string;
	let lockfile: string;

	beforeEach(async () => {
		workDir = await mkdtemp(join(tmpdir(), 'otelux-receiver-singleinstance-'));
		lockfile = join(workDir, 'receiver.lock');
	});

	afterEach(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it('becomes owner when no lockfile exists', async () => {
		const claim = await claimSingleInstance({
			lockfile,
			preferredPort: 4318,
			ping: async () => true,
		});
		expect(claim.role).toBe('owner');
		expect(claim.ownerEndpoint).toEqual({ host: '127.0.0.1', port: 4318 });

		const written = JSON.parse(await readFile(lockfile, 'utf8'));
		expect(written).toMatchObject({ host: '127.0.0.1', port: 4318, pid: process.pid });

		await claim.release();
	});

	it('becomes client when an existing owner answers ping', async () => {
		await writeFile(
			lockfile,
			JSON.stringify({ pid: 99999, host: '127.0.0.1', port: 4318, createdAt: '2026-01-01T00:00:00Z' }),
		);

		const claim = await claimSingleInstance({
			lockfile,
			preferredPort: 4318,
			ping: async () => true,
		});

		expect(claim.role).toBe('client');
		expect(claim.ownerEndpoint).toEqual({ host: '127.0.0.1', port: 4318 });
	});

	it('takes over a stale lockfile whose owner does not answer ping', async () => {
		await writeFile(
			lockfile,
			JSON.stringify({ pid: 99999, host: '127.0.0.1', port: 4318, createdAt: '2026-01-01T00:00:00Z' }),
		);

		const claim = await claimSingleInstance({
			lockfile,
			preferredPort: 4318,
			ping: async () => false,
		});

		expect(claim.role).toBe('owner');
		const written = JSON.parse(await readFile(lockfile, 'utf8'));
		expect(written.pid).toBe(process.pid);
	});

	it('treats corrupt lockfile JSON as stale', async () => {
		await writeFile(lockfile, 'not json at all');

		const claim = await claimSingleInstance({
			lockfile,
			preferredPort: 4318,
			ping: async () => true,
		});

		expect(claim.role).toBe('owner');
	});

	it("client release is a no-op (doesn't unlink another process' lockfile)", async () => {
		await writeFile(
			lockfile,
			JSON.stringify({ pid: 99999, host: '127.0.0.1', port: 4318, createdAt: '2026-01-01T00:00:00Z' }),
		);

		const claim = await claimSingleInstance({
			lockfile,
			preferredPort: 4318,
			ping: async () => true,
		});
		await claim.release();

		// File should still be there.
		const raw = await readFile(lockfile, 'utf8');
		expect(JSON.parse(raw).pid).toBe(99999);
	});
});
