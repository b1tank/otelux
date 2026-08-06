#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const desktop = new URL('..', import.meta.url).pathname;
const architecture = process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked';
const root = process.env.OTELUX_DAEMON_SMOKE_ROOT ?? join(desktop, 'release', architecture);
const binary = process.env.OTELUX_DAEMON_SMOKE_BINARY ?? join(root, 'otelux');
const cli = process.env.OTELUX_DAEMON_SMOKE_CLI ?? join(root, 'resources', 'bin', 'oteluxctl');
const version = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version;
assert.ok(existsSync(binary), `packaged Electron binary missing: ${binary}`);
assert.ok(existsSync(cli), `packaged CLI launcher missing: ${cli}`);

const data = mkdtempSync(join(tmpdir(), 'otelux-packaged-daemon-'));
writeFileSync(
	join(data, 'settings.json'),
	JSON.stringify({
		version: 1,
		revision: 0,
		otlp: { port: 4319 },
		mcp: { enabled: false, port: 4320 },
		retention: { maxAgeHours: 72, maxSizeMb: 512 },
		storage: { dbPath: '' },
	}),
);
const environment = {
	...process.env,
	OTELUX_DATA_DIR: data,
	OTELUX_OTLP_PORT: '0',
	OTELUX_API_PORT: '0',
};

function invoke(command, ...args) {
	return JSON.parse(
		execFileSync(cli, [command, ...args, '--json'], {
			encoding: 'utf8',
			env: environment,
		}),
	);
}

const waitFor = async (check, timeout = 15_000) => {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error('packaged CLI lifecycle timed out');
};

try {
	const started = invoke('start');
	assert.equal(started.started, true);
	const initialState = await waitFor(() => {
		try {
			return JSON.parse(readFileSync(join(data, 'runtime.json'), 'utf8'));
		} catch {
			return undefined;
		}
	});
	assert.equal(initialState.instanceId, started.instanceId);
	assert.equal(initialState.runtimeVersion, version);
	assert.equal(initialState.receiver.kind, 'running');
	assert.equal(initialState.api.kind, 'running');
	assert.equal(initialState.mcp.kind, 'disabled');

	const token = readFileSync(join(data, 'runtime-token'), 'utf8').trim();
	const response = await fetch(
		`http://${initialState.api.host}:${initialState.api.port}/api/v1/rpc`,
		{
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'runtime/getStatus' }),
		},
	);
	assert.equal(response.status, 200);
	assert.equal((await response.json()).result.instanceId, initialState.instanceId);
	assert.equal(invoke('status').healthy, true);
	assert.ok(invoke('endpoints').api);
	assert.equal(invoke('doctor').healthy, true);
	assert.equal(invoke('config', 'set', 'retention.maxAgeHours', '24', '--dry-run').dryRun, true);

	const restarted = invoke('restart');
	assert.equal(restarted.restarted, true);
	assert.notEqual(restarted.instanceId, initialState.instanceId);
	const restartedState = await waitFor(() => {
		try {
			const value = JSON.parse(readFileSync(join(data, 'runtime.json'), 'utf8'));
			return value.instanceId === restarted.instanceId ? value : undefined;
		} catch {
			return undefined;
		}
	});
	assert.equal(restartedState.runtimeVersion, version);
	assert.equal(invoke('stop').stopped, true);
	await waitFor(
		() => !existsSync(join(data, 'runtime.json')) && !existsSync(join(data, 'runtime.lock')),
	);
	console.log('PACKAGED CLI LIFECYCLE SMOKE PASS');
} finally {
	try {
		const state = JSON.parse(readFileSync(join(data, 'runtime.json'), 'utf8'));
		process.kill(state.pid, 'SIGTERM');
	} catch {}
	rmSync(data, { recursive: true, force: true });
}
