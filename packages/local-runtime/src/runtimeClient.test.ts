import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '@otelux/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LocalRuntime, createLocalRuntime } from './runtime.js';
import {
	RuntimeClientDiscoveryError,
	connectRuntimeClient,
	ensureRuntimeClient,
} from './runtimeClient.js';
import { RUNTIME_STATE_FILE } from './runtimeState.js';

const silentLogger = { info: (): void => {}, error: (): void => {} };

describe('Node runtime client discovery', () => {
	let directory: string;
	let runtime: LocalRuntime | undefined;
	let startup: Promise<void> | undefined;

	beforeEach(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'otelux-runtime-client-'));
		await fs.writeFile(
			join(directory, 'settings.json'),
			`${JSON.stringify({ ...DEFAULT_SETTINGS, mcp: { enabled: false, port: 4320 } })}\n`,
		);
	});

	afterEach(async () => {
		await startup;
		await runtime?.close();
		await fs.rm(directory, { recursive: true, force: true });
	});

	async function start(): Promise<LocalRuntime> {
		runtime = await createLocalRuntime({
			dataDirectory: directory,
			otlpPortOverride: 0,
			apiPortOverride: 0,
			logger: silentLogger,
		});
		return runtime;
	}

	it('returns undefined when no runtime owner is published', async () => {
		await expect(connectRuntimeClient({ dataDirectory: directory })).resolves.toBeUndefined();
	});

	it('authenticates and verifies the discovered runtime identity', async () => {
		const owner = await start();
		const discovered = await connectRuntimeClient({
			dataDirectory: directory,
			clientName: 'discovery-test',
			clientVersion: '1.0.0',
		});
		expect(discovered?.state.instanceId).toBe(owner.getRuntimeState().instanceId);
		await expect(discovered?.client.getSettings()).resolves.toEqual(owner.getSettings());
		discovered?.client.close();
	});

	it('starts an absent runtime and waits through the publication race', async () => {
		const discovered = await ensureRuntimeClient({
			dataDirectory: directory,
			timeoutMs: 5_000,
			pollIntervalMs: 10,
			start: () => {
				startup = new Promise((resolve, reject) => {
					setTimeout(() => {
						void start().then(() => resolve(), reject);
					}, 25);
				});
			},
		});
		expect(discovered.state.instanceId).toBe(runtime?.getRuntimeState().instanceId);
		discovered.client.close();
	});

	it('rejects malformed state without trying to start another owner', async () => {
		await fs.writeFile(join(directory, RUNTIME_STATE_FILE), '{not-json');
		let starts = 0;
		await expect(
			ensureRuntimeClient({
				dataDirectory: directory,
				start: () => {
					starts++;
				},
			}),
		).rejects.toMatchObject({
			name: RuntimeClientDiscoveryError.name,
			code: 'invalid-state',
		});
		expect(starts).toBe(0);
	});

	it('refuses state that redirects the control-token path', async () => {
		await start();
		const statePath = join(directory, RUNTIME_STATE_FILE);
		const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as Record<string, unknown>;
		await fs.writeFile(statePath, JSON.stringify({ ...state, runtimeTokenFile: '/tmp/other-token' }));
		await expect(connectRuntimeClient({ dataDirectory: directory })).rejects.toMatchObject({
			code: 'invalid-state',
		});
	});

	it('fails closed for a replaced token', async () => {
		await start();
		await fs.writeFile(join(directory, 'runtime-token'), 'wrong-token\n', { mode: 0o600 });
		await expect(connectRuntimeClient({ dataDirectory: directory })).rejects.toMatchObject({
			code: 'authentication',
		});
	});

	it('rejects a daemon from a different host release', async () => {
		await start();
		await expect(
			connectRuntimeClient({
				dataDirectory: directory,
				expectedRuntimeVersion: '9.9.9',
			}),
		).rejects.toMatchObject({ code: 'incompatible-version' });
	});

	it('rejects a state file replaced with another runtime identity', async () => {
		await start();
		const statePath = join(directory, RUNTIME_STATE_FILE);
		const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as Record<string, unknown>;
		await fs.writeFile(statePath, JSON.stringify({ ...state, instanceId: 'replacement' }));
		await expect(connectRuntimeClient({ dataDirectory: directory })).rejects.toMatchObject({
			code: 'invalid-state',
		});
	});
});
