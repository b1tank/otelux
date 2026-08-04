import { describe, expect, it, vi } from 'vitest';
import { createRuntimeEventProjector } from './runtimeEvents.js';

const traceA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const traceB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const tick = async (): Promise<void> => await new Promise((resolve) => queueMicrotask(resolve));

describe('Runtime event projector', () => {
	it('coalesces one turn into a bounded signal envelope', async () => {
		const projector = createRuntimeEventProjector();
		const listener = vi.fn();
		projector.subscribe(listener);
		projector.accept({ kind: 'tracesChanged', traceIds: [traceA, traceB] });
		projector.accept({ kind: 'logsChanged', count: 2 });
		projector.accept({ kind: 'tracesChanged', traceIds: [traceA] });
		expect(listener).not.toHaveBeenCalled();
		await tick();
		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith({
			schemaVersion: 1,
			revision: '1',
			kind: 'telemetry.changed',
			signals: ['traces', 'logs'],
			traceIds: [traceA, traceB],
		});
	});

	it('replays retained revisions and resyncs stale, future, or malformed cursors', async () => {
		const projector = createRuntimeEventProjector({ historyLimit: 2 });
		for (const event of [
			{ kind: 'logsChanged', count: 1 } as const,
			{ kind: 'metricsChanged', count: 1 } as const,
			{ kind: 'settings-changed', settings: {} as never } as const,
		]) {
			projector.accept(event);
			await tick();
		}
		expect(projector.eventsSince('2')).toHaveLength(1);
		expect(projector.eventsSince('1')[0]).toMatchObject({ kind: 'runtime.resync', revision: '3' });
		expect(projector.eventsSince('999')[0]).toMatchObject({ kind: 'runtime.resync' });
		expect(projector.eventsSince('bad')[0]).toMatchObject({ kind: 'runtime.resync' });
		expect(projector.eventsSince('3')).toEqual([]);
	});

	it('caps trace hints and stops after close', async () => {
		const projector = createRuntimeEventProjector({ traceIdLimit: 1 });
		const listener = vi.fn();
		projector.subscribe(listener);
		projector.accept({ kind: 'tracesChanged', traceIds: [traceA, traceB] });
		await tick();
		expect(listener.mock.calls[0]?.[0]).toMatchObject({ traceIds: [traceA] });
		projector.close();
		projector.accept({ kind: 'logsChanged', count: 1 });
		await tick();
		expect(listener).toHaveBeenCalledOnce();
	});
});
