#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const daemon = new URL('../dist/daemon.js', import.meta.url).pathname;
const settings = {
	version: 1,
	otlp: { port: 4319 },
	mcp: { enabled: false, port: 4320 },
	retention: { maxAgeHours: 72, maxSizeMb: 512 },
	storage: { dbPath: '' },
};

function launch(directory, extra = {}) {
	const child = spawn(process.execPath, [daemon], {
		env: {
			...process.env,
			OTELUX_DATA_DIR: directory,
			OTELUX_OTLP_PORT: '0',
			OTELUX_API_PORT: '0',
			...extra,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	return { child, stdout: () => stdout, stderr: () => stderr };
}

async function waitFor(predicate, timeout = 10_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = await predicate();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error('timed out');
}

async function state(directory) {
	try {
		return JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'));
	} catch {
		return undefined;
	}
}

async function exit(child, timeout = 10_000) {
	if (child.exitCode !== null) return child.exitCode;
	return await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('process exit timed out')), timeout);
		child.once('exit', (code) => {
			clearTimeout(timer);
			resolve(code);
		});
	});
}

describe('oteluxd process', () => {
	it('publishes state, serves RPC, rejects a second owner, and shuts down cleanly', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'oteluxd-process-'));
		await writeFile(join(directory, 'settings.json'), `${JSON.stringify(settings)}\n`);
		const primary = launch(directory);
		try {
			const running = await waitFor(async () => {
				const value = await state(directory);
				return value?.api?.kind === 'running' && value?.receiver?.kind === 'running'
					? value
					: undefined;
			});
			assert.equal(running.pid, primary.child.pid);
			assert.ok(!primary.stdout().includes('runtime-token'));
			const token = (await readFile(running.runtimeTokenFile, 'utf8')).trim();
			const response = await fetch(`http://${running.api.host}:${running.api.port}/api/v1/rpc`, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'runtime/getStatus' }),
			});
			assert.equal(response.status, 200);
			assert.equal((await response.json()).result.pid, primary.child.pid);

			const secondary = launch(directory);
			assert.equal(await exit(secondary.child), 2);
			assert.match(secondary.stderr(), /"event":"already-running"/);
			assert.ok(!secondary.stderr().includes('runtime-token'));

			primary.child.kill('SIGTERM');
			assert.equal(await exit(primary.child), 0);
			await assert.rejects(readFile(join(directory, 'runtime.json')));
			await assert.rejects(readFile(join(directory, 'runtime.lock')));
			await assert.rejects(fetch(`http://${running.api.host}:${running.api.port}/healthz`));
			assert.match(primary.stdout(), /"event":"stopped"/);
		} finally {
			if (primary.child.exitCode === null) primary.child.kill('SIGKILL');
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('rejects invalid environment configuration without publishing ownership', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'oteluxd-invalid-'));
		const invalid = launch(directory, { OTELUX_API_PORT: 'invalid' });
		try {
			assert.equal(await exit(invalid.child), 1);
			assert.match(invalid.stderr(), /"event":"startup-error"/);
			await assert.rejects(readFile(join(directory, 'runtime.json')));
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
