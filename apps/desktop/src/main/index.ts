import { join } from 'node:path';
import { createEngine, createMemoryStorage } from '@otelux/engine';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import {
	type InvokeMessage,
	MAX_PORT,
	MIN_PORT,
	OTELUX_EVENT_CHANNEL,
	OTELUX_INVOKE_CHANNEL,
	type OteluxEvent,
	type UpdateSettingsResult,
} from '../shared/ipc.js';
import { ReceiverHost } from './receiverHost.js';
import { SettingsStore } from './settings.js';

const isDev = !app.isPackaged;

/**
 * Resolve the OTLP port to bind at startup. Precedence:
 *   1. `OTELUX_OTLP_PORT` env var (one-shot dev/CI override; does NOT
 *      mutate the persisted settings).
 *   2. Persisted settings (`<userData>/settings.json`).
 *   3. Default {@link DEFAULT_SETTINGS}.otlp.port (4319).
 */
function resolveStartupPort(persisted: number): number {
	const raw = process.env.OTELUX_OTLP_PORT;
	if (raw === undefined || raw === '') {
		return persisted;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
		console.warn(
			`[otelux] ignoring invalid OTELUX_OTLP_PORT=${raw}; falling back to persisted ${persisted}`,
		);
		return persisted;
	}
	return parsed;
}

async function startBackend(): Promise<{
	stop: () => Promise<void>;
}> {
	const storage = createMemoryStorage();
	const engine = createEngine({ storage });

	const settingsFile = join(app.getPath('userData'), 'settings.json');
	const settings = await SettingsStore.open(settingsFile);
	const receiverHost = new ReceiverHost(engine, '127.0.0.1');

	const broadcast = (event: OteluxEvent): void => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				win.webContents.send(OTELUX_EVENT_CHANNEL, event);
			}
		}
	};

	const offEngine = engine.subscribe((event) => {
		broadcast(event);
	});
	const offStatus = receiverHost.onChange((status) => {
		broadcast({ kind: 'receiver-status-changed', status });
	});
	const offSettings = settings.onChange((next) => {
		broadcast({ kind: 'settings-changed', settings: next });
	});

	// Single-channel dispatch. The discriminated union forces the switch
	// to stay exhaustive when the protocol grows.
	ipcMain.handle(OTELUX_INVOKE_CHANNEL, async (_event, message: InvokeMessage) => {
		switch (message.kind) {
			case 'listTraces':
				return engine.listTraces(message.query);
			case 'getTrace':
				return engine.getTrace(message.query);
			case 'getSpanDetails':
				return engine.getSpanDetails(message.query);
			case 'getSettings':
				return settings.get();
			case 'getReceiverStatus':
				return receiverHost.status;
			case 'updateSettings':
				return updateSettings(settings, receiverHost, message.patch);
		}
	});

	const initialPort = resolveStartupPort(settings.get().otlp.port);
	const status = await receiverHost.start(initialPort);
	if (status.kind === 'running') {
		console.log(
			`[otelux] OTLP/HTTP receiver listening on http://${status.host}:${status.port}/v1/traces`,
		);
	} else if (status.kind === 'error') {
		console.error(
			`[otelux] OTLP/HTTP receiver failed to bind on ${status.host}:${status.port}: ${status.message}`,
		);
	}

	return {
		stop: async () => {
			offEngine.dispose();
			offStatus();
			offSettings();
			await receiverHost.stop();
			await engine.close();
			ipcMain.removeHandler(OTELUX_INVOKE_CHANNEL);
		},
	};
}

/**
 * Two-phase settings update: validate, try to rebind, only then persist.
 *
 * The old "persist first, then bind" order corrupted `settings.json`
 * whenever the new port could not be acquired (EACCES on privileged
 * ports, EADDRINUSE on contended ones) — the bad value survived
 * restarts and bricked the app until the user wiped their user-data
 * directory. Doing the bind first means a failed save leaves both
 * disk state and the running receiver on the previous port, and the
 * renderer just shows the bind error inline.
 */
async function updateSettings(
	store: SettingsStore,
	receiverHost: ReceiverHost,
	patch: Parameters<SettingsStore['update']>[0],
): Promise<UpdateSettingsResult> {
	let next: Awaited<ReturnType<SettingsStore['preview']>>;
	try {
		next = store.preview(patch);
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}

	const previousStatus = receiverHost.status;
	const status = await receiverHost.start(next.otlp.port);
	if (status.kind === 'error') {
		// Best-effort rollback so the user is not left with a dead
		// receiver. Use the port the receiver was actually bound to —
		// that may differ from `store.get().otlp.port` when an env
		// override (`OTELUX_OTLP_PORT`) is in effect, and rolling back
		// to the persisted port would defeat the override.
		// If even the previous port is now contended (rare — requires a
		// third party to grab it in the gap) the host stays in
		// `kind: 'error'` and the renderer surfaces that too.
		if (previousStatus.kind === 'running' && previousStatus.port !== next.otlp.port) {
			await receiverHost.start(previousStatus.port);
		}
		return { ok: false, error: status.message };
	}

	try {
		await store.commit(next);
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	return { ok: true, settings: next, status };
}

function createWindow(): void {
	// Window icon source. In dev `__dirname` is `out/main/`, so we walk
	// two levels up to reach the project root (`apps/desktop/`). In a
	// packaged build, electron-builder copies `build/icon.png` next to
	// the asar and Electron picks it up automatically from the resource
	// path the platform expects — we still pass it explicitly so the
	// taskbar/dock identity is correct on Linux where the desktop file
	// is the only ambient icon source.
	const iconPath = join(__dirname, '..', '..', 'build', 'icon.png');

	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		title: 'OTelux',
		icon: iconPath,
		backgroundColor: '#1e1e1e',
		autoHideMenuBar: true,
		show: false,
		webPreferences: {
			// Sandboxed preload is built as CommonJS by `electron.vite.config.ts`;
			// Electron loads it via an internal `require`-style runtime, so the
			// preload extension is `.js` regardless of this package's
			// `"type": "module"`.
			preload: join(__dirname, '../preload/index.js'),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	win.once('ready-to-show', () => {
		win.show();
	});

	// DevTools accelerators: F12 and Ctrl/Cmd+Shift+I. `autoHideMenuBar`
	// suppresses the default Electron menu (which would otherwise bind
	// these), so we wire them through `before-input-event` instead.
	// Only active in dev — packaged builds get no inspector surface.
	if (isDev) {
		win.webContents.on('before-input-event', (event, input) => {
			if (input.type !== 'keyDown') {
				return;
			}
			const ctrlOrCmd = process.platform === 'darwin' ? input.meta : input.control;
			const isF12 = input.key === 'F12';
			const isInspector = ctrlOrCmd && input.shift && input.key.toLowerCase() === 'i';
			if (isF12 || isInspector) {
				win.webContents.toggleDevTools();
				event.preventDefault();
			}
		});
	}

	// Open external links in the system browser, never in-window.
	win.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: 'deny' };
	});

	if (isDev && process.env.ELECTRON_RENDERER_URL) {
		void win.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		void win.loadFile(join(__dirname, '../renderer/index.html'));
	}
}

// Single-instance lock so we never double-bind the OTLP port.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on('second-instance', () => {
		const [existing] = BrowserWindow.getAllWindows();
		if (existing) {
			if (existing.isMinimized()) {
				existing.restore();
			}
			existing.focus();
		}
	});

	let backendStop: (() => Promise<void>) | undefined;

	void app.whenReady().then(async () => {
		const backend = await startBackend();
		backendStop = backend.stop;

		createWindow();
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				createWindow();
			}
		});
	});

	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit();
		}
	});

	app.on('will-quit', (event) => {
		if (!backendStop) {
			return;
		}
		event.preventDefault();
		const stop = backendStop;
		backendStop = undefined;
		void stop()
			.catch((err) => {
				console.error('[otelux] error shutting down backend', err);
			})
			.finally(() => {
				app.quit();
			});
	});
}
