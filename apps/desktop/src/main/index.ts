import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	ensureRuntimeClient,
	prepareDataDirectory,
	resolveOteluxDataDirectory,
} from '@otelux/local-runtime';
import {
	MAX_PORT,
	MIN_PORT,
	parseInvokeMessage,
	parseInvokeResult,
	parseRuntimeEvent,
} from '@otelux/protocol';
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, shell } from 'electron';
import {
	type InvokeMessage,
	OTELUX_EVENT_CHANNEL,
	OTELUX_INVOKE_CHANNEL,
	type OteluxEvent,
} from '../shared/ipc.js';
import { isAllowedExternalUrl, isAllowedNavigation } from './security.js';
import { desktopStartupErrorMessage } from './startupError.js';
import { createDesktopWindowLifecycle, isPackagedQuitRequest } from './windowLifecycle.js';

declare const __OTELUX_APP_VERSION__: string;

const isDev = !app.isPackaged;
const desktopVersion = __OTELUX_APP_VERSION__;

// Renderers that have finished loading and haven't started navigating away.
// `webContents.send` does NOT throw when the underlying render frame is
// disposed — it logs "Render frame was disposed before WebFrameMain could be
// accessed" to stderr and drops the message. A try/catch around `.send` is
// therefore useless. The only reliable fix is to never call `send` for a
// frame that isn't ready, which we track via lifecycle events and verify by
// checking the current main frame before each broadcast.
const readyReceivers = new Set<Electron.WebContents>();

function registerReceiver(wc: Electron.WebContents): void {
	const add = (): void => {
		readyReceivers.add(wc);
	};
	const drop = (): void => {
		readyReceivers.delete(wc);
	};
	wc.on('did-finish-load', add);
	wc.on('did-start-loading', drop);
	wc.on('render-process-gone', drop);
	wc.on('destroyed', drop);
}

function isReceiverReady(wc: Electron.WebContents): boolean {
	return (
		!wc.isDestroyed() && !wc.isCrashed() && !wc.isLoadingMainFrame() && !wc.mainFrame.isDestroyed()
	);
}

/**
 * Resolve the OTLP port to bind at startup. Precedence:
 *   1. `OTELUX_OTLP_PORT` env var (one-shot dev/CI override; does NOT
 *      mutate the persisted settings).
 *   2. `undefined`, which lets the runtime use persisted settings and then
 *      its default port.
 */
function resolveStartupPortOverride(): number | undefined {
	const raw = process.env.OTELUX_OTLP_PORT;
	if (raw === undefined || raw === '') {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
		console.warn(`[otelux] ignoring invalid OTELUX_OTLP_PORT=${raw}; using persisted settings`);
		return undefined;
	}
	return parsed;
}

/**
 * Resolve a request body-size override from the environment. Used for
 * `OTELUX_OTLP_MAX_BODY_BYTES` and `OTELUX_MCP_MAX_BODY_BYTES` so tests
 * and constrained environments can shrink the limit. Precedence:
 *   1. The env var when it is a positive integer number of bytes.
 *   2. `undefined`, which lets the receiver/MCP package apply its own
 *      documented default (10 MiB OTLP, 1 MiB MCP).
 *
 * Invalid values fail closed to the package default rather than
 * disabling the limit.
 */
function resolveApiPortOverride(): number | undefined {
	const raw = process.env.OTELUX_API_PORT;
	if (raw === undefined || raw === '') return undefined;
	if (!/^\d+$/.test(raw)) {
		console.warn(
			`[otelux] ignoring invalid OTELUX_API_PORT=${raw}; using persisted/default settings`,
		);
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	if (parsed < 0 || parsed > MAX_PORT) {
		console.warn(
			`[otelux] ignoring invalid OTELUX_API_PORT=${raw}; using persisted/default settings`,
		);
		return undefined;
	}
	return parsed;
}

function resolveMaxBodyBytes(envName: string): number | undefined {
	const raw = process.env[envName];
	if (raw === undefined || raw === '') {
		return undefined;
	}
	// Require a pure non-negative integer. `Number.parseInt` would accept
	// a numeric prefix (e.g. "1MiB" -> 1), silently installing a 1-byte
	// cap instead of failing closed to the documented default.
	if (!/^\d+$/.test(raw)) {
		console.warn(`[otelux] ignoring invalid ${envName}=${raw}; using the default limit`);
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	if (parsed <= 0) {
		console.warn(`[otelux] ignoring invalid ${envName}=${raw}; using the default limit`);
		return undefined;
	}
	return parsed;
}

async function startBackend(): Promise<{ stop: () => Promise<void> }> {
	const dataDirectory = resolveOteluxDataDirectory();
	const discovered = await ensureRuntimeClient({
		dataDirectory,
		clientName: 'otelux-desktop',
		clientVersion: desktopVersion,
		expectedRuntimeVersion: desktopVersion,
		start: async () => {
			await prepareDataDirectory({
				dataDirectory,
				legacyDataDirectories: [app.getPath('userData')],
				logger: console,
			});
			startPackagedDaemon(dataDirectory);
		},
	});
	const runtime = discovered.client;

	const broadcast = (event: OteluxEvent): void => {
		let validated: OteluxEvent;
		try {
			validated = parseRuntimeEvent(event);
		} catch (error) {
			console.error(
				'[otelux] rejected invalid runtime event',
				error instanceof Error ? error.message : 'unknown validation error',
			);
			return;
		}
		for (const wc of readyReceivers) {
			if (!isReceiverReady(wc)) {
				readyReceivers.delete(wc);
				continue;
			}
			wc.send(OTELUX_EVENT_CHANNEL, validated);
		}
	};
	const events = runtime.subscribe(broadcast);
	let controlRefresh: Promise<void> | undefined;
	let controlRefreshTrailing = false;
	const refreshControls = (): void => {
		if (controlRefresh) {
			controlRefreshTrailing = true;
			return;
		}
		controlRefresh = Promise.all([runtime.getSettings(), runtime.getStatus()])
			.then(([settings, status]) => {
				broadcast({ kind: 'settings-changed', settings });
				broadcast({ kind: 'receiver-status-changed', status: status.receiver });
				broadcast({ kind: 'mcp-status-changed', status: status.mcp });
			})
			.catch((error) => console.error('[otelux] failed to refresh runtime controls', error))
			.finally(() => {
				controlRefresh = undefined;
				if (controlRefreshTrailing) {
					controlRefreshTrailing = false;
					refreshControls();
				}
			});
	};
	const controlSignals = runtime.subscribeSignals((signals) => {
		if (signals.includes('settings') || signals.includes('status')) refreshControls();
	});

	ipcMain.handle(OTELUX_INVOKE_CHANNEL, async (_event, input: unknown) => {
		const message: InvokeMessage = parseInvokeMessage(input);
		let result: unknown;
		switch (message.kind) {
			case 'listTraces':
				result = await runtime.listTraces(message.query);
				break;
			case 'getTrace':
				result = await runtime.getTrace(message.query);
				break;
			case 'getTraceWaterfall':
				result = await (runtime.getTraceWaterfall?.(message.query) ?? runtime.getTrace(message.query));
				break;
			case 'getSpanDetails':
				result = await runtime.getSpanDetails(message.query);
				break;
			case 'listLogs':
				result = await runtime.listLogs(message.query);
				break;
			case 'getLogDetails':
				result = await runtime.getLogDetails(message.query);
				break;
			case 'listMetricInstruments':
				result = await runtime.listMetricInstruments(message.query);
				break;
			case 'getMetricPoints':
				result = await runtime.getMetricPoints(message.query);
				break;
			case 'listResourceFacets':
				result = await runtime.listResourceFacets(message.query);
				break;
			case 'getSettings':
				result = await runtime.getSettings();
				break;
			case 'getReceiverStatus':
				result = (await runtime.getStatus()).receiver;
				break;
			case 'getMcpStatus':
				result = (await runtime.getStatus()).mcp;
				break;
			case 'getStoragePath':
				result = await runtime.getStoragePath();
				break;
			case 'getStorageUsage':
				result = await runtime.getStorageUsage();
				break;
			case 'loadSampleData':
				result = await runtime.loadSampleData();
				break;
			case 'updateSettings': {
				try {
					result = await runtime.updateSettings(message.patch, message.expectedRevision);
				} catch (error) {
					const failure = error as { code?: number; data?: { settings?: unknown } };
					if (failure.code !== -32004 || failure.data?.settings === undefined) throw error;
					result = {
						ok: false,
						conflict: true,
						error: 'Settings changed. Reload settings and try again.',
						settings: failure.data.settings,
					};
				}
				if (
					typeof result === 'object' &&
					result !== null &&
					'ok' in result &&
					(result as { ok: boolean }).ok
				) {
					const update = result as unknown as { settings: never; status: never; mcpStatus: never };
					broadcast({ kind: 'settings-changed', settings: update.settings });
					broadcast({ kind: 'receiver-status-changed', status: update.status });
					broadcast({ kind: 'mcp-status-changed', status: update.mcpStatus });
				}
				break;
			}
			case 'clearData':
				await runtime.clearData();
				result = undefined;
				break;
		}
		return parseInvokeResult(message.kind, result);
	});

	return {
		stop: async () => {
			events.dispose();
			controlSignals.dispose();
			await controlRefresh;
			runtime.close();
			ipcMain.removeHandler(OTELUX_INVOKE_CHANNEL);
		},
	};
}

function startPackagedDaemon(dataDirectory: string): void {
	const require = createRequire(import.meta.url);
	const runtimeEntry = require.resolve('@otelux/local-runtime');
	const daemon = app.isPackaged
		? join(
				process.resourcesPath,
				'app.asar',
				'node_modules',
				'@otelux',
				'local-runtime',
				'dist',
				'daemon.js',
			)
		: join(dirname(runtimeEntry), 'daemon.js');
	const child = spawn(process.execPath, [daemon], {
		detached: true,
		stdio: 'ignore',
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			OTELUX_DATA_DIR: dataDirectory,
			OTELUX_RUNTIME_VERSION: desktopVersion,
			...(resolveStartupPortOverride() !== undefined
				? { OTELUX_OTLP_PORT: String(resolveStartupPortOverride()) }
				: {}),
			...(resolveApiPortOverride() !== undefined
				? { OTELUX_API_PORT: String(resolveApiPortOverride()) }
				: {}),
			...daemonLimitEnvironment(),
		},
	});
	child.unref();
}

function daemonLimitEnvironment(): Record<string, string> {
	const result: Record<string, string> = {};
	for (const name of [
		'OTELUX_OTLP_MAX_BODY_BYTES',
		'OTELUX_MCP_MAX_BODY_BYTES',
		'OTELUX_API_MAX_BODY_BYTES',
	]) {
		const value = resolveMaxBodyBytes(name);
		if (value !== undefined) result[name] = String(value);
	}
	return result;
}

function resolveIconPath(kind: 'app' | 'tray'): string {
	if (app.isPackaged) {
		return join(process.resourcesPath, kind === 'app' ? 'app-icon.png' : 'tray-icon.png');
	}
	return join(
		__dirname,
		'..',
		'..',
		'build',
		kind === 'app' ? 'icon.png' : join('icons', '32x32.png'),
	);
}

function createWindow(): BrowserWindow {
	const iconPath = resolveIconPath('app');

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
	win.on('close', (event) => {
		windowLifecycle.handleWindowClose(event, win);
	});
	win.on('closed', () => {
		windowLifecycle.forgetWindow(win);
	});

	registerReceiver(win.webContents);

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

	// Open external links in the system browser, never in-window, and only
	// when they are explicit HTTPS destinations. A non-HTTPS or malformed
	// URL is dropped rather than handed to the OS, so a telemetry value can
	// never coax the app into launching `file:`, `javascript:`, or a
	// custom-scheme handler.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (isAllowedExternalUrl(url)) {
			void shell.openExternal(url);
		}
		return { action: 'deny' };
	});

	// The app is a single page; the only legitimate top-frame navigation is
	// a reload of its own URL. Deny everything else so a redirect or an
	// injected navigation cannot load a remote origin into the trusted,
	// preload-bearing window.
	const appUrl =
		isDev && process.env.ELECTRON_RENDERER_URL
			? process.env.ELECTRON_RENDERER_URL
			: pathToFileURL(join(__dirname, '../renderer/index.html')).href;
	win.webContents.on('will-navigate', (event, url) => {
		if (!isAllowedNavigation(url, appUrl)) {
			event.preventDefault();
		}
	});

	// The renderer needs no device or ambient-capability permissions
	// (camera, microphone, geolocation, notifications, …). Deny every
	// request and check so a compromised renderer cannot escalate.
	const { session } = win.webContents;
	session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
	session.setPermissionCheckHandler(() => false);

	// No part of the app embeds a <webview>; refuse any attempt to attach
	// one, which would otherwise be a fresh, less-restricted web frame.
	win.webContents.on('will-attach-webview', (event) => {
		event.preventDefault();
	});

	if (isDev && process.env.ELECTRON_RENDERER_URL) {
		void win.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		void win.loadFile(join(__dirname, '../renderer/index.html'));
	}

	return win;
}

const windowLifecycle = createDesktopWindowLifecycle(createWindow, () => app.quit());

let tray: Tray | undefined;

function createTray(): void {
	tray = new Tray(resolveIconPath('tray'));
	tray.setToolTip('OTelux Desktop — local runtime continues independently');
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{
				label: 'Open OTelux',
				click: () => windowLifecycle.showWindow(),
			},
			{ type: 'separator' },
			{
				label: 'Quit Desktop',
				click: () => windowLifecycle.requestQuit(),
			},
		]),
	);
	tray.on('click', () => windowLifecycle.showWindow());
}

// Process managers and packaged smoke tests stop Electron with signals rather
// than a tray action. Use the same explicit-quit path so window close is not
// intercepted and `will-quit` can release listeners, SQLite, and ownership.
process.once('SIGTERM', () => windowLifecycle.requestQuit());
process.once('SIGINT', () => windowLifecycle.requestQuit());

// Single-instance lock so we never double-bind the OTLP port.
const gotLock = app.requestSingleInstanceLock();
const packagedQuitRequested = isPackagedQuitRequest(process.argv);
if (!gotLock) {
	app.quit();
} else if (packagedQuitRequested) {
	// A smoke-test quit helper acquired the lock because no primary instance
	// exists. Exit without starting a runtime or creating a window.
	app.quit();
} else {
	app.on('second-instance', (_event, argv) => {
		if (isPackagedQuitRequest(argv)) {
			windowLifecycle.requestQuit();
			return;
		}
		windowLifecycle.showWindow();
	});

	let backendStop: (() => Promise<void>) | undefined;
	let backendStartup: Promise<() => Promise<void>> | undefined;
	let shutdownStarted = false;
	let shutdownComplete = false;

	void app
		.whenReady()
		.then(async () => {
			backendStartup = startBackend().then((backend) => backend.stop);
			backendStop = await backendStartup;
			if (windowLifecycle.isQuitting()) {
				app.quit();
				return;
			}

			createTray();
			windowLifecycle.markReady();
			windowLifecycle.showWindow();
			app.on('activate', () => {
				windowLifecycle.showWindow();
			});
		})
		.catch((error) => {
			dialog.showErrorBox('OTelux could not start', desktopStartupErrorMessage(error));
			windowLifecycle.requestQuit();
		});

	app.on('before-quit', () => {
		windowLifecycle.beginQuit();
		tray?.destroy();
		tray = undefined;
	});

	// Electron exits by default when the last window is closed unless this
	// event has a listener. The tray owns the process lifetime; explicit Quit
	// paths above still reach `will-quit` and stop the runtime.
	app.on('window-all-closed', () => {});

	app.on('will-quit', (event) => {
		if (shutdownComplete) {
			return;
		}
		if (!backendStop && !backendStartup) {
			return;
		}
		event.preventDefault();
		if (shutdownStarted) {
			return;
		}
		shutdownStarted = true;
		void (async () => {
			let stop = backendStop;
			if (!stop && backendStartup) {
				try {
					stop = await backendStartup;
				} catch {
					// Startup failed before a runtime handle was returned.
				}
			}
			backendStop = undefined;
			backendStartup = undefined;
			await stop?.();
		})()
			.catch((err) => {
				console.error('[otelux] error shutting down backend', err);
			})
			.finally(() => {
				shutdownComplete = true;
				app.quit();
			});
	});
}
