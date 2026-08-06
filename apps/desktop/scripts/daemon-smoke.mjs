#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const desktop = new URL('..', import.meta.url).pathname;
const architecture = process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked';
const root = process.env.OTELUX_DAEMON_SMOKE_ROOT ?? join(desktop, 'release', architecture);
const binary = process.env.OTELUX_DAEMON_SMOKE_BINARY ?? join(root, 'otelux');
const daemon =
	process.env.OTELUX_DAEMON_SMOKE_SCRIPT ??
	join(
		root,
		'resources',
		'app.asar',
		'node_modules',
		'@otelux',
		'local-runtime',
		'dist',
		'daemon.js',
	);
const version = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8')).version;
assert.ok(existsSync(binary), `packaged Electron binary missing: ${binary}`);

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
const child = spawn(binary, [daemon], {
	env: {
		...process.env,
		ELECTRON_RUN_AS_NODE: '1',
		OTELUX_DATA_DIR: data,
		OTELUX_OTLP_PORT: '0',
		OTELUX_API_PORT: '0',
		OTELUX_RUNTIME_VERSION: version,
	},
	stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => {
	output += chunk;
});
child.stderr.on('data', (chunk) => {
	output += chunk;
});

const waitFor = async (check, timeout = 15_000) => {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`packaged daemon timed out\n${output}`);
};

try {
	const state = await waitFor(() => {
		try {
			return JSON.parse(readFileSync(join(data, 'runtime.json'), 'utf8'));
		} catch {
			return undefined;
		}
	});
	assert.equal(state.runtimeVersion, version);
	assert.equal(state.receiver.kind, 'running');
	assert.equal(state.api.kind, 'running');
	assert.equal(state.mcp.kind, 'disabled');
	const token = readFileSync(join(data, 'runtime-token'), 'utf8').trim();
	const response = await fetch(`http://${state.api.host}:${state.api.port}/api/v1/rpc`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'runtime/getStatus' }),
	});
	assert.equal(response.status, 200);
	assert.equal((await response.json()).result.instanceId, state.instanceId);
	child.kill('SIGTERM');
	assert.equal(await new Promise((resolve) => child.once('exit', resolve)), 0);
	assert.equal(existsSync(join(data, 'runtime.json')), false);
	assert.equal(existsSync(join(data, 'runtime.lock')), false);
	console.log('PACKAGED DAEMON SMOKE PASS');
} finally {
	if (child.exitCode === null) child.kill('SIGKILL');
	rmSync(data, { recursive: true, force: true });
}
