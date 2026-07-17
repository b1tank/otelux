export interface LifecycleWindow {
	isDestroyed(): boolean;
	isMinimized(): boolean;
	restore(): void;
	show(): void;
	focus(): void;
	hide(): void;
}

export interface PreventableCloseEvent {
	preventDefault(): void;
}

export interface DesktopWindowLifecycle<TWindow extends LifecycleWindow> {
	isQuitting(): boolean;
	markReady(): void;
	showWindow(): void;
	handleWindowClose(event: PreventableCloseEvent, window: TWindow): void;
	forgetWindow(window: TWindow): void;
	beginQuit(): void;
	requestQuit(): void;
}

/**
 * Keep the desktop runtime alive when its window closes, while still allowing
 * explicit application quit paths to tear down the runtime and exit.
 */
export function createDesktopWindowLifecycle<TWindow extends LifecycleWindow>(
	createWindow: () => TWindow,
	quitApplication: () => void,
): DesktopWindowLifecycle<TWindow> {
	let currentWindow: TWindow | undefined;
	let quitting = false;
	let ready = false;
	let pendingShow = false;

	const showReadyWindow = (): void => {
		if (!currentWindow || currentWindow.isDestroyed()) {
			currentWindow = createWindow();
			return;
		}
		if (currentWindow.isMinimized()) {
			currentWindow.restore();
		}
		currentWindow.show();
		currentWindow.focus();
	};

	return {
		isQuitting(): boolean {
			return quitting;
		},

		markReady(): void {
			if (ready || quitting) {
				return;
			}
			ready = true;
			if (pendingShow) {
				pendingShow = false;
				showReadyWindow();
			}
		},

		showWindow(): void {
			if (quitting) {
				return;
			}
			if (!ready) {
				pendingShow = true;
				return;
			}
			showReadyWindow();
		},

		handleWindowClose(event: PreventableCloseEvent, window: TWindow): void {
			if (quitting) {
				return;
			}
			event.preventDefault();
			window.hide();
		},

		forgetWindow(window: TWindow): void {
			if (currentWindow === window) {
				currentWindow = undefined;
			}
		},

		beginQuit(): void {
			quitting = true;
		},

		requestQuit(): void {
			if (quitting) {
				return;
			}
			quitting = true;
			quitApplication();
		},
	};
}
