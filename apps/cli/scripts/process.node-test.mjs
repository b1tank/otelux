import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const cli = new URL('../dist/index.js', import.meta.url).pathname;

async function freePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('port missing');
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

function invoke(args, environment) {
	return JSON.parse(
		execFileSync(process.execPath, [cli, ...args, '--json'], {
			encoding: 'utf8',
			env: environment,
		}),
	);
}

test('CLI owns one start/restart/stop lifecycle', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'otelux-cli-process-'));
	const otlpPort = await freePort();
	const environment = {
		...process.env,
		OTELUX_DATA_DIR: directory,
		OTELUX_API_PORT: '0',
	};
	writeFileSync(
		join(directory, 'settings.json'),
		JSON.stringify({
			version: 1,
			revision: 0,
			otlp: { port: otlpPort },
			mcp: { enabled: false, port: 4320 },
			retention: { maxAgeHours: 72, maxSizeMb: 512 },
			storage: { dbPath: '' },
		}),
	);
	try {
		const started = invoke(['start'], environment);
		assert.equal(started.started, true);
		assert.equal(invoke(['status'], environment).healthy, true);
		assert.equal(invoke(['endpoints'], environment).otlp, `http://127.0.0.1:${otlpPort}`);
		assert.equal(invoke(['doctor'], environment).healthy, true);
		const preview = invoke(
			['config', 'set', 'retention.maxAgeHours', '24', '--dry-run'],
			environment,
		);
		assert.equal(preview.dryRun, true);
		assert.equal(preview.settings.retention.maxAgeHours, 24);
		assert.equal(invoke(['status'], environment).settings.retention.maxAgeHours, 72);
		assert.equal(
			invoke(['config', 'set', 'retention.maxAgeHours', '24', '--yes'], environment).updated,
			true,
		);
		assert.equal(invoke(['config', 'get', 'retention.maxAgeHours'], environment).value, 24);
		const restarted = invoke(['restart'], environment);
		assert.notEqual(restarted.instanceId, started.instanceId);
		assert.equal(invoke(['stop'], environment).stopped, true);
		assert.equal(existsSync(join(directory, 'runtime.json')), false);
		assert.equal(existsSync(join(directory, 'runtime.lock')), false);
	} finally {
		try {
			const state = JSON.parse(readFileSync(join(directory, 'runtime.json'), 'utf8'));
			process.kill(state.pid, 'SIGTERM');
		} catch {}
		rmSync(directory, { recursive: true, force: true });
	}
});
