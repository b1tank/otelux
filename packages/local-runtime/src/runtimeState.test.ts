import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OTELUX_PROTOCOL_VERSION } from '@otelux/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	RUNTIME_LOCK_FILE,
	RUNTIME_STATE_FILE,
	type RuntimeState,
	claimRuntimeOwnership,
	readRuntimeState,
	removeRuntimeState,
	writeRuntimeState,
} from './runtimeState.js';
import { OTELUX_LOCAL_RUNTIME_VERSION } from './version.js';

describe('runtime ownership and state', () => {
	let directory: string;

	beforeEach(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'otelux-runtime-state-'));
	});

	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});

	it('claims ownership and releases only its own lock', async () => {
		const claim = await claimRuntimeOwnership({
			dataDirectory: directory,
			processId: 100,
			instanceId: 'owner-a',
			isProcessAlive: () => true,
		});
		expect(claim.role).toBe('owner');

		await fs.writeFile(
			join(directory, RUNTIME_LOCK_FILE),
			JSON.stringify({
				version: 1,
				instanceId: 'owner-b',
				pid: 200,
				acquiredAt: '2026-07-16T00:00:00.000Z',
			}),
		);
		await claim.release();
		expect(JSON.parse(await fs.readFile(join(directory, RUNTIME_LOCK_FILE), 'utf8'))).toMatchObject({
			instanceId: 'owner-b',
		});
	});

	it('returns the active owner and its matching state to another client', async () => {
		const owner = await claimRuntimeOwnership({
			dataDirectory: directory,
			processId: 100,
			instanceId: 'owner-a',
			isProcessAlive: () => true,
		});
		expect(owner.role).toBe('owner');
		await writeRuntimeState(directory, state('owner-a', 100));

		const client = await claimRuntimeOwnership({
			dataDirectory: directory,
			processId: 200,
			instanceId: 'owner-b',
			isProcessAlive: (pid) => pid === 100,
		});

		expect(client).toMatchObject({
			role: 'client',
			owner: { instanceId: 'owner-a', pid: 100 },
			state: { instanceId: 'owner-a', receiver: { kind: 'running', port: 4319 } },
		});
		await owner.release();
	});

	it('reclaims a stale lock and removes only its matching stale state', async () => {
		await fs.writeFile(
			join(directory, RUNTIME_LOCK_FILE),
			JSON.stringify({
				version: 1,
				instanceId: 'stale',
				pid: 100,
				acquiredAt: '2026-07-16T00:00:00.000Z',
			}),
		);
		await writeRuntimeState(directory, state('stale', 100));

		const claim = await claimRuntimeOwnership({
			dataDirectory: directory,
			processId: 200,
			instanceId: 'replacement',
			isProcessAlive: () => false,
		});

		expect(claim).toMatchObject({ role: 'owner', owner: { instanceId: 'replacement' } });
		expect(await readRuntimeState(directory)).toBeUndefined();
		await claim.release();
	});

	it('writes, validates, and removes state by ownership nonce', async () => {
		const value = state('owner-a', 100);
		await writeRuntimeState(directory, value);
		expect(await readRuntimeState(directory)).toEqual(value);

		await removeRuntimeState(directory, 'owner-b');
		expect(await readRuntimeState(directory)).toEqual(value);
		await removeRuntimeState(directory, 'owner-a');
		expect(await readRuntimeState(directory)).toBeUndefined();
		await expect(fs.access(join(directory, RUNTIME_STATE_FILE))).rejects.toThrow();
	});

	it('preserves differing version strings for compatibility negotiation', async () => {
		const value = {
			...state('owner-a', 100),
			runtimeVersion: '9.0.0',
			protocolVersion: '2099-01-01',
		};
		await writeRuntimeState(directory, value);
		expect(await readRuntimeState(directory)).toMatchObject({
			runtimeVersion: '9.0.0',
			protocolVersion: '2099-01-01',
		});
	});
});

function state(instanceId: string, pid: number): RuntimeState {
	return {
		version: 1,
		runtimeVersion: OTELUX_LOCAL_RUNTIME_VERSION,
		protocolVersion: OTELUX_PROTOCOL_VERSION,
		instanceId,
		pid,
		startedAt: '2026-07-16T00:00:00.000Z',
		dataDirectory: '/data/otelux',
		databasePath: '/data/otelux/otelux.db',
		mcpTokenFile: '/data/otelux/mcp-token',
		receiver: { kind: 'running', host: '127.0.0.1', port: 4319 },
		mcp: { kind: 'running', host: '127.0.0.1', port: 4320 },
	};
}
