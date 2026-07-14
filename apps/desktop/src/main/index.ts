import { join } from 'node:path';
import { createEngine, createMemoryStorage } from '@otelux/engine';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import {
	type InvokeMessage,
	MAX_PORT,
	MIN_PORT,
	type McpStatus,
	OTELUX_EVENT_CHANNEL,
	OTELUX_INVOKE_CHANNEL,
	type OteluxEvent,
	type UpdateSettingsResult,
} from '../shared/ipc.js';
import { McpHost } from './mcpHost.js';
import { ReceiverHost } from './receiverHost.js';
import { SettingsStore } from './settings.js';

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

async function startBackend(): Promise<{
	stop: () => Promise<void>;
}> {
	const storage = createMemoryStorage();
	const engine = createEngine({ storage });

	const settingsFile = join(app.getPath('userData'), 'settings.json');
	const settings = await SettingsStore.open(settingsFile);
	const receiverHost = new ReceiverHost(
		engine,
		'127.0.0.1',
		resolveMaxBodyBytes('OTELUX_OTLP_MAX_BODY_BYTES'),
	);
	const mcpHost = new McpHost(engine, '127.0.0.1', resolveMaxBodyBytes('OTELUX_MCP_MAX_BODY_BYTES'));

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
 *
 * MCP follows the same recipe: try to apply the requested MCP state
 * (start at the new port / stop entirely) before writing settings.
 * If MCP fails, we roll back both the receiver (if its port changed)
 * and MCP itself, and surface the error.
 */
async function updateSettings(
	store: SettingsStore,
	receiverHost: ReceiverHost,
	mcpHost: McpHost,
	patch: Parameters<SettingsStore['update']>[0],
): Promise<UpdateSettingsResult> {
	let next: Awaited<ReturnType<SettingsStore['preview']>>;
	try {
		next = store.preview(patch);
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}

	const previousReceiverStatus = receiverHost.status;
	const previousMcpStatus = mcpHost.status;
	const currentReceiverPort =
		previousReceiverStatus.kind === 'running' ? previousReceiverStatus.port : undefined;
	const currentMcpEnabled = previousMcpStatus.kind === 'running';
	const currentMcpPort = previousMcpStatus.kind === 'running' ? previousMcpStatus.port : undefined;

	// Receiver: only rebind if the port actually changes. Avoids a
	// pointless drop in OTLP ingest when the user toggles MCP.
	let status = previousReceiverStatus;
	if (currentReceiverPort !== next.otlp.port) {
		status = await receiverHost.start(next.otlp.port);
		if (status.kind === 'error') {
			if (previousReceiverStatus.kind === 'running' && currentReceiverPort !== next.otlp.port) {
				await receiverHost.start(previousReceiverStatus.port);
			}
			return { ok: false, error: status.message };
		}
	}

	// MCP: enable/disable + restart on port change. Rollback on failure
	// returns the user to exactly the MCP state they had before the
	// edit, so a busted toggle never leaves orphaned listeners.
	let mcpStatus: McpStatus = mcpHost.status;
	const wantMcp = next.mcp.enabled;
	const portChanged = currentMcpPort !== next.mcp.port;
	if (!wantMcp) {
		await mcpHost.disable();
		mcpStatus = mcpHost.status;
	} else if (!currentMcpEnabled || portChanged) {
		mcpStatus = await mcpHost.start(next.mcp.port);
		if (mcpStatus.kind === 'error') {
			// Roll back MCP to its previous shape so the user keeps a
			// working server when their edit was invalid.
			if (currentMcpEnabled && currentMcpPort !== undefined) {
				await mcpHost.start(currentMcpPort);
			} else {
				await mcpHost.disable();
			}
			// Also roll back the receiver port if we rebound it above.
			if (previousReceiverStatus.kind === 'running' && currentReceiverPort !== next.otlp.port) {
				await receiverHost.start(previousReceiverStatus.port);
			}
			return { ok: false, error: mcpStatus.message };
		}
	}

	try {
		await store.commit(next);
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	return { ok: true, settings: next, status, mcpStatus };
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
