import { describe, expect, it, vi } from 'vitest';
import type { StorageUsageInfo } from '../shared/ipc.js';
import { subscribeStorageUsage } from './hooks.js';
import type { OteluxWindowBridge } from './ipcDataSource.js';

const usage: StorageUsageInfo = {
	activePath: '/tmp/otelux.db',
	retentionBytes: 4096,
	databaseFileBytes: 4096,
	walBytes: 0,
	sharedMemoryBytes: 0,
	totalBytes: 4096,
};

function fakeTimer() {
	return {
		setInterval: vi.fn(() => 7),
		clearInterval: vi.fn(),
	};
}

describe('subscribeStorageUsage', () => {
	it('contains rejected polls and unsubscribes event/timer refreshes', async () => {
		let eventHandler: (() => void) | undefined;
		const invoke = vi.fn(() => Promise.reject(new Error('runtime stopped')));
		const off = vi.fn();
		const bridge = {
			invoke,
			onEvent: (handler: () => void) => {
				eventHandler = handler;
				return off;
			},
		} as unknown as OteluxWindowBridge;
		const timer = fakeTimer();
		const onUsage = vi.fn();

		const dispose = subscribeStorageUsage(bridge, onUsage, timer);
		await Promise.resolve();
		await Promise.resolve();
		expect(onUsage).not.toHaveBeenCalled();

		dispose();
		eventHandler?.();
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(timer.clearInterval).toHaveBeenCalledWith(7);
		expect(off).toHaveBeenCalledOnce();
	});

	it('drops a successful poll that resolves after disposal', async () => {
		let resolveUsage: ((value: StorageUsageInfo) => void) | undefined;
		const bridge = {
			invoke: () =>
				new Promise<StorageUsageInfo>((resolve) => {
					resolveUsage = resolve;
				}),
			onEvent: () => () => {},
		} as unknown as OteluxWindowBridge;
		const onUsage = vi.fn();
		const dispose = subscribeStorageUsage(bridge, onUsage, fakeTimer());

		dispose();
		resolveUsage?.(usage);
		await Promise.resolve();
		expect(onUsage).not.toHaveBeenCalled();
	});
});
