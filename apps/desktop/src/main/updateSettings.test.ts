import { describe, expect, it } from 'vitest';
import type { McpStatus, PartialSettings, ReceiverStatus, Settings } from '../shared/ipc.js';
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

	preview(patch: PartialSettings): Settings {
		return {
			version: 1,
			otlp: { port: patch.otlp?.port ?? this.base.otlp.port },
			mcp: {
				enabled: patch.mcp?.enabled ?? this.base.mcp.enabled,
				port: patch.mcp?.port ?? this.base.mcp.port,
			},
		};
	}

	commit(next: Settings): Promise<Settings> {
		this.commitCalls += 1;
		if (this.commitError) {
			return Promise.reject(this.commitError);
		}
		this.base = next;
		return Promise.resolve(next);
	}
}

function baseSettings(): Settings {
	return { version: 1, otlp: { port: 4319 }, mcp: { enabled: true, port: 4320 } };
}

describe('updateSettings', () => {
	it('rebinds the receiver and commits when the port changes', async () => {
		const receiver = new FakeReceiver(4319);
		const mcp = new FakeMcp({ kind: 'running', port: 4320, host: HOST });
		const store = new FakeStore(baseSettings());

		const result = await updateSettings(store, receiver, mcp, { otlp: { port: 4400 } });

		expect(result.ok).toBe(true);
		expect(receiver.status).toEqual({ kind: 'running', port: 4400, host: HOST });
		expect(receiver.startCalls).toEqual([4400]);
		// MCP was unchanged, so it is never touched.
		expect(mcp.startCalls).toEqual([]);
		expect(mcp.disableCalls).toBe(0);
		expect(store.commitCalls).toBe(1);
	});

	it('rolls the receiver back to its previous port when the settings write fails', async () => {
		const receiver = new FakeReceiver(4319);
		const mcp = new FakeMcp({ kind: 'running', port: 4320, host: HOST });
		const store = new FakeStore(baseSettings(), new Error('disk full'));

		const result = await updateSettings(store, receiver, mcp, { otlp: { port: 4400 } });

		expect(result).toEqual({ ok: false, error: 'disk full' });
		// Rebound to the new port, then restored to the previous one.
		expect(receiver.startCalls).toEqual([4400, 4319]);
		expect(receiver.status).toEqual({ kind: 'running', port: 4319, host: HOST });
		// MCP was never mutated, so it is not rolled back.
		expect(mcp.startCalls).toEqual([]);
		expect(mcp.disableCalls).toBe(0);
	});

	it('rolls MCP back to its previous port when the settings write fails', async () => {
		const receiver = new FakeReceiver(4319);
		const mcp = new FakeMcp({ kind: 'running', port: 4320, host: HOST });
		const store = new FakeStore(baseSettings(), new Error('disk full'));

		const result = await updateSettings(store, receiver, mcp, { mcp: { port: 4500 } });

		expect(result.ok).toBe(false);
		// Receiver port did not change, so it is untouched.
		expect(receiver.startCalls).toEqual([]);
		// MCP restarted on the new port, then restored to the previous one.
		expect(mcp.startCalls).toEqual([4500, 4320]);
		expect(mcp.status).toEqual({ kind: 'running', port: 4320, host: HOST });
	});

	it('rolls the receiver back when MCP fails to bind, without persisting', async () => {
		const receiver = new FakeReceiver(4319);
		const mcp = new FakeMcp({ kind: 'running', port: 4320, host: HOST });
		mcp.failOn(4500);
		const store = new FakeStore(baseSettings());

		const result = await updateSettings(store, receiver, mcp, {
			otlp: { port: 4400 },
			mcp: { port: 4500 },
		});

		expect(result.ok).toBe(false);
		expect(receiver.startCalls).toEqual([4400, 4319]);
		expect(mcp.startCalls).toEqual([4500, 4320]);
		// A failed rebind must never reach persistence.
		expect(store.commitCalls).toBe(0);
	});
});
