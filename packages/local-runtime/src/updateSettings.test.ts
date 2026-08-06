import type { McpStatus, PartialSettings, ReceiverStatus, Settings } from '@otelux/protocol';
import { describe, expect, it } from 'vitest';
import {
	type McpController,
	type ReceiverController,
	type SettingsWriter,
	updateSettings,
} from './updateSettings.js';

const HOST = '127.0.0.1';

class FakeReceiver implements ReceiverController {
	status: ReceiverStatus;
	readonly startCalls: number[] = [];
	private failPort: number | undefined;

	constructor(initialPort: number) {
		this.status = { kind: 'running', port: initialPort, host: HOST };
	}

	failOn(port: number): void {
		this.failPort = port;
	}

	start(port: number): Promise<ReceiverStatus> {
		this.startCalls.push(port);
		this.status =
			this.failPort === port
				? { kind: 'error', port, host: HOST, message: 'bind failed' }
				: { kind: 'running', port, host: HOST };
		return Promise.resolve(this.status);
	}
}

class FakeMcp implements McpController {
	status: McpStatus;
	readonly startCalls: number[] = [];
	disableCalls = 0;
	private failPort: number | undefined;

	constructor(initial: McpStatus) {
		this.status = initial;
	}

	failOn(port: number): void {
		this.failPort = port;
	}

	start(port: number): Promise<McpStatus> {
		this.startCalls.push(port);
		this.status =
			this.failPort === port
				? { kind: 'error', port, host: HOST, message: 'bind failed' }
				: { kind: 'running', port, host: HOST };
		return Promise.resolve(this.status);
	}

	disable(): Promise<void> {
		this.disableCalls += 1;
		this.status = { kind: 'disabled' };
		return Promise.resolve();
	}
}

class FakeStore implements SettingsWriter {
	commitCalls = 0;

	constructor(
		private base: Settings,
		private readonly commitError?: Error,
	) {}

	get(): Settings {
		return this.base;
	}

	preview(patch: PartialSettings): Settings {
		return {
			version: 1,
			revision: this.base.revision,
			otlp: { port: patch.otlp?.port ?? this.base.otlp.port },
			mcp: {
				enabled: patch.mcp?.enabled ?? this.base.mcp.enabled,
				port: patch.mcp?.port ?? this.base.mcp.port,
			},
			retention: {
				maxAgeHours: patch.retention?.maxAgeHours ?? this.base.retention.maxAgeHours,
				maxSizeMb: patch.retention?.maxSizeMb ?? this.base.retention.maxSizeMb,
			},
			storage: { dbPath: patch.storage?.dbPath ?? this.base.storage.dbPath },
		};
	}

	commit(next: Settings, expectedRevision: number): Promise<Settings> {
		this.commitCalls += 1;
		if (this.commitError) {
			return Promise.reject(this.commitError);
		}
		this.base = { ...next, revision: expectedRevision + 1 };
		return Promise.resolve(this.base);
	}
}

function baseSettings(): Settings {
	return {
		version: 1,
		revision: 0,
		otlp: { port: 4319 },
		mcp: { enabled: true, port: 4320 },
		retention: { maxAgeHours: 72, maxSizeMb: 512 },
		storage: { dbPath: '' },
	};
}

describe('updateSettings', () => {
	it('rejects a stale revision before mutating listeners', async () => {
		const receiver = new FakeReceiver(4319);
		const mcp = new FakeMcp({ kind: 'running', port: 4320, host: HOST });
		const current = { ...baseSettings(), revision: 4 };
		const store = new FakeStore(current);

		const result = await updateSettings(store, receiver, mcp, { otlp: { port: 4400 } }, 3);

		expect(result).toEqual({
			ok: false,
			conflict: true,
			error: 'Settings changed from revision 3 to 4. Reload settings and try again.',
			settings: current,
		});
		expect(receiver.startCalls).toEqual([]);
		expect(mcp.startCalls).toEqual([]);
		expect(store.commitCalls).toBe(0);
	});

	it('rebinds the receiver and commits when the port changes', async () => {
		const receiver = new FakeReceiver(4319);
		const mcp = new FakeMcp({ kind: 'running', port: 4320, host: HOST });
		const store = new FakeStore(baseSettings());

		const result = await updateSettings(store, receiver, mcp, { otlp: { port: 4400 } }, 0);

		expect(result.ok).toBe(true);
		expect(receiver.status).toEqual({ kind: 'running', port: 4400, host: HOST });
		expect(receiver.startCalls).toEqual([4400]);
		expect(mcp.startCalls).toEqual([]);
		expect(mcp.disableCalls).toBe(0);
		expect(store.commitCalls).toBe(1);
	});

	it('rolls listeners back when the settings write fails', async () => {
		const receiver = new FakeReceiver(4319);
		const mcp = new FakeMcp({ kind: 'running', port: 4320, host: HOST });
		const store = new FakeStore(baseSettings(), new Error('disk full'));

		const result = await updateSettings(
			store,
			receiver,
			mcp,
			{ otlp: { port: 4400 }, mcp: { port: 4500 } },
			0,
		);

		expect(result).toEqual({ ok: false, error: 'disk full' });
		expect(receiver.startCalls).toEqual([4400, 4319]);
		expect(mcp.startCalls).toEqual([4500, 4320]);
	});

	it('rolls the receiver back when MCP fails to bind, without persisting', async () => {
		const receiver = new FakeReceiver(4319);
		const mcp = new FakeMcp({ kind: 'running', port: 4320, host: HOST });
		mcp.failOn(4500);
		const store = new FakeStore(baseSettings());

		const result = await updateSettings(
			store,
			receiver,
			mcp,
			{ otlp: { port: 4400 }, mcp: { port: 4500 } },
			0,
		);

		expect(result.ok).toBe(false);
		expect(receiver.startCalls).toEqual([4400, 4319]);
		expect(mcp.startCalls).toEqual([4500, 4320]);
		expect(store.commitCalls).toBe(0);
	});
});
