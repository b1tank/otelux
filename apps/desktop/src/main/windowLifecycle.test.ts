import { describe, expect, it } from 'vitest';
import {
	type LifecycleWindow,
	type PreventableCloseEvent,
	createDesktopWindowLifecycle,
} from './windowLifecycle.js';

interface WindowState {
	destroyed: boolean;
	minimized: boolean;
	hidden: boolean;
	restored: number;
	shown: number;
	focused: number;
}

function createWindow(state: WindowState): LifecycleWindow {
	return {
		isDestroyed: () => state.destroyed,
		isMinimized: () => state.minimized,
		restore: () => {
			state.minimized = false;
			state.restored++;
		},
		show: () => {
			state.hidden = false;
			state.shown++;
		},
		focus: () => {
			state.focused++;
		},
		hide: () => {
			state.hidden = true;
		},
	};
}

function initialWindowState(): WindowState {
	return {
		destroyed: false,
		minimized: false,
		hidden: false,
		restored: 0,
		shown: 0,
		focused: 0,
	};
}

describe('desktop window lifecycle', () => {
	it('hides a closed window without quitting and restores it later', () => {
		const state = initialWindowState();
		const window = createWindow(state);
		let prevented = 0;
		let quitCount = 0;
		const lifecycle = createDesktopWindowLifecycle(
			() => window,
			() => quitCount++,
		);
		lifecycle.markReady();
		lifecycle.showWindow();

		lifecycle.handleWindowClose(
			{ preventDefault: () => prevented++ } satisfies PreventableCloseEvent,
			window,
		);

		expect({ prevented, quitCount, hidden: state.hidden }).toEqual({
			prevented: 1,
			quitCount: 0,
			hidden: true,
		});

		lifecycle.showWindow();
		expect({ hidden: state.hidden, shown: state.shown, focused: state.focused }).toEqual({
			hidden: false,
			shown: 1,
			focused: 1,
		});
	});

	it('restores a minimized window before showing it', () => {
		const state = { ...initialWindowState(), minimized: true };
		const window = createWindow(state);
		const lifecycle = createDesktopWindowLifecycle(
			() => window,
			() => {},
		);
		lifecycle.markReady();
		lifecycle.showWindow();
		lifecycle.showWindow();

		expect({ minimized: state.minimized, restored: state.restored }).toEqual({
			minimized: false,
			restored: 1,
		});
	});

	it('allows the window to close after an explicit quit request', () => {
		const state = initialWindowState();
		const window = createWindow(state);
		let prevented = 0;
		let quitCount = 0;
		const lifecycle = createDesktopWindowLifecycle(
			() => window,
			() => quitCount++,
		);
		lifecycle.markReady();
		lifecycle.showWindow();

		lifecycle.requestQuit();
		lifecycle.requestQuit();
		lifecycle.handleWindowClose({ preventDefault: () => prevented++ }, window);

		expect({ prevented, quitCount, hidden: state.hidden }).toEqual({
			prevented: 0,
			quitCount: 1,
			hidden: false,
		});
	});

	it('forgets destroyed windows and creates a replacement', () => {
		const firstState = initialWindowState();
		const secondState = initialWindowState();
		const windows = [createWindow(firstState), createWindow(secondState)];
		let createCount = 0;
		const lifecycle = createDesktopWindowLifecycle(
			() => {
				const window = windows[createCount++];
				if (!window) {
					throw new Error('unexpected lifecycle window creation');
				}
				return window;
			},
			() => {},
		);
		lifecycle.markReady();
		lifecycle.showWindow();
		firstState.destroyed = true;

		lifecycle.showWindow();

		expect(createCount).toBe(2);
	});

	it('queues a show request until desktop initialization is ready', () => {
		const state = initialWindowState();
		const window = createWindow(state);
		let createCount = 0;
		const lifecycle = createDesktopWindowLifecycle(
			() => {
				createCount++;
				return window;
			},
			() => {},
		);

		lifecycle.showWindow();
		expect(createCount).toBe(0);

		lifecycle.markReady();
		expect(createCount).toBe(1);
	});

	it('ignores window requests after shutdown begins', () => {
		const state = initialWindowState();
		let createCount = 0;
		const lifecycle = createDesktopWindowLifecycle(
			() => {
				createCount++;
				return createWindow(state);
			},
			() => {},
		);
		lifecycle.markReady();
		lifecycle.requestQuit();

		lifecycle.showWindow();

		expect(lifecycle.isQuitting()).toBe(true);
		expect(createCount).toBe(0);
	});
});
