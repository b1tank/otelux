import { join } from 'node:path';
import { createEngine, createMemoryStorage } from '@otelux/engine';
import { createReceiver } from '@otelux/receiver';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { type InvokeMessage, OTELUX_EVENT_CHANNEL, OTELUX_INVOKE_CHANNEL } from '../shared/ipc.js';

const isDev = !app.isPackaged;

// Default OTLP/HTTP port (per the spec). Override via OTELUX_OTLP_PORT to
// dodge a collision with another collector running locally.
const OTLP_PORT = Number.parseInt(process.env.OTELUX_OTLP_PORT ?? '4318', 10);

async function startBackend(): Promise<{
	stop: () => Promise<void>;
	port: number;
}> {
	const storage = createMemoryStorage();
	const engine = createEngine({ storage });

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
		}
	});

	// Fan out change events to every open window. Renderers subscribe via
	// the preload bridge and refresh their queries when this fires.
	const subscription = engine.subscribe((event) => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				win.webContents.send(OTELUX_EVENT_CHANNEL, event);
			}
		}
	});

	const receiver = createReceiver({ engine, port: OTLP_PORT });
	await receiver.start();

	return {
		port: receiver.port,
		stop: async () => {
			subscription.dispose();
			await receiver.stop();
			await engine.close();
			ipcMain.removeHandler(OTELUX_INVOKE_CHANNEL);
		},
	};
}

function createWindow(): void {
	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		title: 'OTelux',
		backgroundColor: '#1e1e1e',
		autoHideMenuBar: true,
		show: false,
		webPreferences: {
			preload: join(__dirname, '../preload/index.js'),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	win.once('ready-to-show', () => {
		win.show();
	});

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
		console.log(`[otelux] OTLP/HTTP receiver listening on 127.0.0.1:${backend.port}`);

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
