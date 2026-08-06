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
	const settings = {
		version: 1,
		revision: 3,
		otlp: { port: 4319 },
		mcp: { enabled: false, port: 4320 },
		retention: { maxAgeHours: 72, maxSizeMb: 512 },
		storage: { dbPath: '' },
	};
	const client = {
		getStatus: mock.fn(async () => ({ ...state })),
		getSettings: mock.fn(async () => settings),
		updateSettings: mock.fn(async (patch) => ({
			ok: true,
			settings: {
				...settings,
				revision: 4,
				retention: { ...settings.retention, ...patch.retention },
			},
			status: state.receiver,
			mcpStatus: state.mcp,
		})),
		getStoragePath: mock.fn(async () => ({
			activePath: state.databasePath,
			defaultPath: state.databasePath,
		})),
		getStorageUsage: mock.fn(async () => ({ activePath: state.databasePath, totalBytes: 1 })),
		shutdown: mock.fn(async () => {}),
		close: mock.fn(),
	};
	const discovered = { state, client };
	const dependencies = {
		connect: mock.fn(async () => (found ? discovered : undefined)),
		ensure: mock.fn(async () => discovered),
		start: mock.fn(),
		waitStopped: mock.fn(async () => {}),
		inspectRuntimeFiles: mock.fn(async () => []),
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

	it('reports version, ownership, storage, and listener diagnostics', async () => {
		const test = harness();
		assert.equal(await runCli(['doctor', '--json'], test.output, test.dependencies), 0);
		const result = JSON.parse(test.logs[0]);
		assert.equal(result.healthy, true);
		assert.equal(result.ownership.secure, true);
		assert.equal(result.versions.runtime, '0.1.12');
		assert.equal(result.storage.activePath, state.databasePath);
	});

	it('fails doctor when ownership files are insecure', async () => {
		const test = harness();
		test.dependencies.inspectRuntimeFiles = mock.fn(async () => [
			'runtime control token is accessible by other users',
		]);
		assert.equal(await runCli(['doctor'], test.output, test.dependencies), 4);
		assert.match(test.logs[0], /runtime control token/);
	});

	it('reads one schema-defined configuration key', async () => {
		const test = harness();
		assert.equal(
			await runCli(
				['config', 'get', 'retention.maxAgeHours', '--json'],
				test.output,
				test.dependencies,
			),
			0,
		);
		assert.deepEqual(JSON.parse(test.logs[0]), {
			key: 'retention.maxAgeHours',
			value: 72,
			revision: 3,
		});
	});

	it('previews a complete validated candidate without writing', async () => {
		const test = harness();
		assert.equal(
			await runCli(
				['config', 'set', 'retention.maxAgeHours', '24', '--dry-run', '--json'],
				test.output,
				test.dependencies,
			),
			0,
		);
		assert.equal(test.client.updateSettings.mock.callCount(), 0);
		const result = JSON.parse(test.logs[0]);
		assert.equal(result.dryRun, true);
		assert.equal(result.settings.retention.maxAgeHours, 24);
		assert.equal(result.expectedRevision, 3);
	});

	it('applies a validated configuration patch with revision CAS', async () => {
		const test = harness();
		assert.equal(
			await runCli(
				['config', 'set', 'retention.maxAgeHours', '24', '--yes', '--json'],
				test.output,
				test.dependencies,
			),
			0,
		);
		assert.deepEqual(test.client.updateSettings.mock.calls[0].arguments, [
			{ retention: { maxAgeHours: 24 } },
			3,
		]);
	});

	it('requires an explicit preview or apply flag and rejects invalid candidates', async () => {
		const missing = harness();
		assert.equal(
			await runCli(
				['config', 'set', 'retention.maxAgeHours', '24'],
				missing.output,
				missing.dependencies,
			),
			1,
		);
		const invalid = harness();
		assert.equal(
			await runCli(
				['config', 'set', 'otlp.port', '0', '--dry-run'],
				invalid.output,
				invalid.dependencies,
			),
			1,
		);
		assert.equal(invalid.client.updateSettings.mock.callCount(), 0);
	});

	it('returns the stable conflict exit code', async () => {
		const test = harness();
		test.client.updateSettings = mock.fn(async () => ({
			ok: false,
			conflict: true,
			error: 'Settings changed',
			settings: await test.client.getSettings(),
		}));
		assert.equal(
			await runCli(
				['config', 'set', 'retention.maxAgeHours', '24', '--yes'],
				test.output,
				test.dependencies,
			),
			5,
		);
	});

	it('rejects unknown commands without guessing', async () => {
		const test = harness();
		assert.equal(await runCli(['serve-sql'], test.output, test.dependencies), 1);
		assert.match(test.errors[0], /Unknown command/);
	});
});
