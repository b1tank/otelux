import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEngine } from '@otelux/engine';
import { type NodeSqliteStorage, createNodeSqliteStorage } from '@otelux/engine-node';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import {
	type InvokeMessage,
	MAX_PORT,
	MIN_PORT,
	OTELUX_EVENT_CHANNEL,
	OTELUX_INVOKE_CHANNEL,
	type OteluxEvent,
	type Settings,
} from '../shared/ipc.js';
import { McpHost } from './mcpHost.js';
import { loadOrCreateMcpToken } from './mcpToken.js';
import { ReceiverHost } from './receiverHost.js';
import { isAllowedExternalUrl, isAllowedNavigation } from './security.js';
import { SettingsStore } from './settings.js';
import { updateSettings } from './updateSettings.js';

const isDev = !app.isPackaged;

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

/**
 * Open the durable store at `preferredPath`, falling back to the default
 * location if that fails. A user-configured `storage.dbPath` that points at an
 * unwritable or invalid location (bad drive, permission denied, a directory)
 * would otherwise throw during startup and brick the app the same way a bad
 * persisted port used to — so a failed custom path degrades to the default
 * rather than preventing launch. Returns the path that was actually opened so
 * the UI can report the real active location.
 */
function openStorage(
	preferredPath: string,
	defaultPath: string,
	retention: Settings['retention'],
): { storage: NodeSqliteStorage; activeDbPath: string } {
	try {
		return {
			storage: createNodeSqliteStorage({ path: preferredPath, retention }),
			activeDbPath: preferredPath,
		};
	} catch (err) {
		if (preferredPath === defaultPath) {
			// The default location itself failed; nothing left to fall back to.
			throw err;
		}
		console.error(
			`[otelux] failed to open database at ${preferredPath}; falling back to ${defaultPath}: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
		return {
			storage: createNodeSqliteStorage({ path: defaultPath, retention }),
			activeDbPath: defaultPath,
		};
	}
}

async function startBackend(): Promise<{
	stop: () => Promise<void>;
}> {
	const settingsFile = join(app.getPath('userData'), 'settings.json');
	const settings = await SettingsStore.open(settingsFile);

	// Durable, on-disk store (node:sqlite). By default the DB lives in the
	// platform user-data directory so it survives restarts and app updates; the
	// user can point `storage.dbPath` at a custom absolute path. Retention is
	// seeded from settings and re-applied whenever the user changes it.
	const defaultDbPath = join(app.getPath('userData'), 'otelux.db');
	const configuredDbPath = settings.get().storage.dbPath;
	const { storage, activeDbPath } = openStorage(
		configuredDbPath !== '' ? configuredDbPath : defaultDbPath,
		defaultDbPath,
		settings.get().retention,
	);
	const engine = createEngine({ storage });

	const receiverHost = new ReceiverHost(
		engine,
		'127.0.0.1',
		resolveMaxBodyBytes('OTELUX_OTLP_MAX_BODY_BYTES'),
	);
	// The MCP listener is loopback but shares the host with other local
	// processes; a per-install bearer token keeps it from becoming an
	// unauthenticated telemetry read API for anything that can reach the port.
	const mcpTokenFile = join(app.getPath('userData'), 'mcp-token');
	const mcpToken = await loadOrCreateMcpToken(mcpTokenFile);
	const mcpHost = new McpHost(
		engine,
		'127.0.0.1',
		resolveMaxBodyBytes('OTELUX_MCP_MAX_BODY_BYTES'),
		mcpToken,
	);

	const broadcast = (event: OteluxEvent): void => {
		for (const wc of readyReceivers) {
			if (!isReceiverReady(wc)) {
				readyReceivers.delete(wc);
				continue;
			}
			wc.send(OTELUX_EVENT_CHANNEL, event);
		}
	};

	const offEngine = engine.subscribe((event) => {
		broadcast(event);
	});
	const offStatus = receiverHost.onChange((status) => {
		broadcast({ kind: 'receiver-status-changed', status });
	});
	const offMcp = mcpHost.onChange((status) => {
		broadcast({ kind: 'mcp-status-changed', status });
	});
	const offSettings = settings.onChange((next) => {
		// Retention is enforced by the storage layer; re-apply on every change so
		// tightening the bound prunes immediately rather than at the next timer.
		storage.applyRetention(next.retention);
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
			case 'listLogs':
				return engine.listLogs(message.query);
			case 'listMetrics':
				return engine.listMetrics(message.query);
			case 'getSettings':
				return settings.get();
			case 'getReceiverStatus':
				return receiverHost.status;
			case 'getMcpStatus':
				return mcpHost.status;
			case 'getStoragePath':
				return { activePath: activeDbPath, defaultPath: defaultDbPath };
			case 'updateSettings':
				return updateSettings(settings, receiverHost, mcpHost, message.patch);
		}
	});

	const initialPort = resolveStartupPort(settings.get().otlp.port);
	const status = await receiverHost.start(initialPort);
	if (status.kind === 'running') {
		console.log(
			`[otelux] OTLP/HTTP receiver listening on http://${status.host}:${status.port}/v1/{traces,logs,metrics}`,
		);
	} else if (status.kind === 'error') {
		console.error(
			`[otelux] OTLP/HTTP receiver failed to bind on ${status.host}:${status.port}: ${status.message}`,
		);
	}

	const current = settings.get();
	if (current.mcp.enabled) {
		const mcpStatus = await mcpHost.start(current.mcp.port);
		if (mcpStatus.kind === 'running') {
			console.log(`[otelux] MCP server listening on http://${mcpStatus.host}:${mcpStatus.port}/`);
			console.log(
				`[otelux] MCP requires an Authorization: Bearer token; read it from ${mcpTokenFile}`,
			);
		} else if (mcpStatus.kind === 'error') {
			console.error(
				`[otelux] MCP server failed to bind on ${mcpStatus.host}:${mcpStatus.port}: ${mcpStatus.message}`,
			);
		}
	} else {
		await mcpHost.disable();
	}

	return {
		stop: async () => {
			offEngine.dispose();
			offStatus();
			offMcp();
			offSettings();
			await receiverHost.stop();
			await mcpHost.stop();
			await engine.close();
			ipcMain.removeHandler(OTELUX_INVOKE_CHANNEL);
		},
	};
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
