import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { runCli } from '../dist/index.js';

const state = {
	version: 1,
	runtimeVersion: '0.1.12',
	protocolVersion: '0.6.0',
	instanceId: 'instance-1',
	pid: 123,
	startedAt: '2026-08-06T00:00:00.000Z',
	dataDirectory: '/tmp/otelux',
	databasePath: '/tmp/otelux/otelux.db',
	mcpTokenFile: '/tmp/otelux/mcp-token',
	runtimeTokenFile: '/tmp/otelux/runtime-token',
	receiver: { kind: 'running', host: '127.0.0.1', port: 4319 },
	mcp: { kind: 'disabled' },
	api: { kind: 'running', host: '127.0.0.1', port: 4321 },
};

function harness(found = true) {
	const logs = [];
	const errors = [];
	const client = {
		getStatus: mock.fn(async () => ({ ...state })),
		getSettings: mock.fn(async () => ({ version: 1, revision: 0 })),
		getStoragePath: mock.fn(async () => ({ activePath: state.databasePath })),
		getStorageUsage: mock.fn(async () => ({ totalBytes: 1 })),
		shutdown: mock.fn(async () => {}),
		close: mock.fn(),
	};
	const discovered = { state, client };
	const dependencies = {
		connect: mock.fn(async () => (found ? discovered : undefined)),
		ensure: mock.fn(async () => discovered),
		start: mock.fn(),
		waitStopped: mock.fn(async () => {}),
	};
	return {
		client,
		dependencies,
		logs,
		errors,
		output: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
	};
}

describe('otelux CLI', () => {
	it('reports not-running with a stable exit code', async () => {
		const test = harness(false);
		assert.equal(await runCli(['status', '--json'], test.output, test.dependencies), 2);
		assert.deepEqual(JSON.parse(test.logs[0]), { healthy: false, running: false });
	});

	it('prints machine-readable endpoints', async () => {
		const test = harness();
		assert.equal(await runCli(['endpoints', '--json'], test.output, test.dependencies), 0);
		assert.deepEqual(JSON.parse(test.logs[0]), {
			otlp: 'http://127.0.0.1:4319',
			mcp: null,
			api: 'http://127.0.0.1:4321',
		});
	});

	it('stops and waits for the exact owner', async () => {
		const test = harness();
		assert.equal(await runCli(['stop'], test.output, test.dependencies), 0);
		assert.equal(test.client.shutdown.mock.callCount(), 1);
		assert.equal(test.dependencies.waitStopped.mock.callCount(), 1);
		assert.equal(test.dependencies.waitStopped.mock.calls[0].arguments[1], 'instance-1');
	});

	it('starts through the shared ensure seam', async () => {
		const test = harness(false);
		assert.equal(await runCli(['start', '--json'], test.output, test.dependencies), 0);
		assert.equal(test.dependencies.ensure.mock.callCount(), 1);
	});

	it('rejects unknown commands without guessing', async () => {
		const test = harness();
		assert.equal(await runCli(['serve-sql'], test.output, test.dependencies), 1);
		assert.match(test.errors[0], /Unknown command/);
	});
});
