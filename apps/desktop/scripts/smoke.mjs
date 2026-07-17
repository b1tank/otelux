#!/usr/bin/env node
/**
 * Packaged smoke test for the OTelux desktop app.
 *
 * Launches the packed Linux binary (from `electron-builder --linux dir`)
 * and asserts the end-to-end runtime path that a release must satisfy:
 *   1. The process starts and the OTLP receiver answers `/healthz`.
 *   2. The sandboxed preload bridge loads and the workbench renders.
 *   3. A valid OTLP/HTTP JSON trace is ingested (`200` + partialSuccess).
 *   4. The request hardening survives packaging (a non-JSON `POST` → `415`).
 *   5. The process shuts down cleanly on SIGTERM.
 *
 * Requires a display; CI wraps this with `xvfb-run`. Runs with
 * `--no-sandbox` because CI and containerized hosts often lack user
 * namespaces — this is a functional smoke, not a sandbox test.
 *
 * Exit code 0 on success, non-zero on any failed assertion.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, '..');
const repoRoot = join(desktopDir, '..', '..');
const binary = join(desktopDir, 'release', 'linux-unpacked', 'otelux');
const fixture = join(repoRoot, 'fixtures', 'sample_trace.json');

async function availablePort() {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('failed to allocate an available port'));
				return;
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});
}

const otlpPort = await availablePort();
const mcpPort = await availablePort();
const debuggingPort = await availablePort();
const baseUrl = `http://127.0.0.1:${otlpPort}`;
const mcpUrl = `http://127.0.0.1:${mcpPort}/`;
const userDataDir = mkdtempSync(join(tmpdir(), 'otelux-smoke-'));
writeFileSync(
	join(userDataDir, 'settings.json'),
	JSON.stringify({
		version: 1,
		otlp: { port: otlpPort },
		mcp: { enabled: true, port: mcpPort },
		retention: { maxAgeHours: 72, maxSizeMb: 512 },
		storage: { dbPath: '' },
	}),
);

const log = [];
function record(chunk) {
	log.push(chunk.toString());
}

async function waitForHealth(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${baseUrl}/healthz`);
			if (res.status === 200) {
				return true;
			}
		} catch {
			// Not listening yet; retry.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

async function endpointResponds(url) {
	try {
		await fetch(url);
		return true;
	} catch {
		return false;
	}
}

function evaluateRenderer(webSocketDebuggerUrl, expression) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(webSocketDebuggerUrl);
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error('renderer CDP evaluation timed out'));
		}, 2000);
		const finish = (callback) => {
			clearTimeout(timer);
			socket.close();
			callback();
		};

		socket.addEventListener('open', () => {
			socket.send(
				JSON.stringify({
					id: 1,
					method: 'Runtime.evaluate',
					params: {
						expression,
						awaitPromise: true,
						returnByValue: true,
					},
				}),
			);
		});
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id !== 1) {
				return;
			}
			if (message.error || message.result?.exceptionDetails) {
				finish(() => reject(new Error('renderer CDP evaluation failed')));
				return;
			}
			finish(() => resolve(JSON.parse(message.result.result.value)));
		});
		socket.addEventListener('error', () => {
			finish(() => reject(new Error('renderer CDP connection failed')));
		});
	});
}

async function waitForRenderer(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`)).json();
			const page = targets.find((target) => target.type === 'page' && target.url.startsWith('file:'));
			if (page) {
				const state = await evaluateRenderer(
					page.webSocketDebuggerUrl,
					`JSON.stringify({
							hasBridge: typeof window.otelux?.invoke === 'function',
							rootChildren: document.getElementById('root')?.childElementCount ?? 0,
							text: document.body.innerText
						})`,
				);
				if (state.hasBridge && state.rootChildren > 0 && state.text.includes('Traces')) {
					return { state, webSocketDebuggerUrl: page.webSocketDebuggerUrl };
				}
			}
		} catch {
			// Renderer or CDP is not ready yet; retry.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return undefined;
}

function fail(message) {
	console.error(`SMOKE FAIL: ${message}`);
	console.error('--- app output ---');
	console.error(log.join('').slice(-4000));
	process.exitCode = 1;
}

const child = spawn(
	binary,
	[
		'--no-sandbox',
		'--ozone-platform=x11',
		`--remote-debugging-port=${debuggingPort}`,
		`--user-data-dir=${userDataDir}`,
	],
	{
		env: {
			...process.env,
			OTELUX_DATA_DIR: userDataDir,
			OTELUX_OTLP_PORT: String(otlpPort),
		},
		stdio: ['ignore', 'pipe', 'pipe'],
		// New process group so we can signal Electron and all of its child
		// processes (GPU, zygote, utility) as one unit on shutdown.
		detached: true,
	},
);
child.stdout.on('data', record);
child.stderr.on('data', record);

let exited = false;
child.on('exit', () => {
	exited = true;
});

function waitForExit(timeoutMs) {
	if (exited) {
		return Promise.resolve(true);
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		child.once('exit', () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

function signalGroup(signal) {
	// Negative pid targets the whole process group created by `detached`.
	try {
		process.kill(-child.pid, signal);
	} catch {
		// Group already gone.
	}
}

async function shutdown() {
	if (!exited) {
		// Signal only Electron's main process first so it can run `will-quit`,
		// close the runtime, and terminate its own utility processes cleanly.
		child.kill('SIGTERM');
		if (!(await waitForExit(5000))) {
			// A wedged process gets a final process-group kill.
			signalGroup('SIGKILL');
			await waitForExit(3000);
		}
	}
	child.stdout?.destroy();
	child.stderr?.destroy();
}

try {
	if (!(await waitForHealth(45_000))) {
		fail('receiver did not answer /healthz within 45s');
	} else {
		const statePath = join(userDataDir, 'runtime.json');
		const lockPath = join(userDataDir, 'runtime.lock');
		if (!existsSync(statePath) || !existsSync(lockPath)) {
			fail('runtime state or ownership lock was not published');
		} else {
			const state = JSON.parse(readFileSync(statePath, 'utf8'));
			if (state.receiver?.kind !== 'running' || state.receiver.port !== otlpPort) {
				fail(`runtime.json did not report the live OTLP port ${otlpPort}`);
			}
			if (state.mcp?.kind !== 'running' || state.mcp.port !== mcpPort) {
				fail(`runtime.json did not report the live MCP port ${mcpPort}`);
			}
		}

		const renderer = await waitForRenderer(45_000);
		if (!renderer) {
			fail('preload bridge or rendered workbench was not available within 45s');
		} else {
			console.log('OK: preload bridge loaded and workbench rendered');
			const storageUsage = await evaluateRenderer(
				renderer.webSocketDebuggerUrl,
				`(async () => JSON.stringify(await window.otelux.invoke({ kind: 'getStorageUsage' })))()`,
			);
			if (
				storageUsage.retentionBytes <= 0 ||
				storageUsage.totalBytes !==
					storageUsage.databaseFileBytes + storageUsage.walBytes + storageUsage.sharedMemoryBytes
			) {
				fail('storage usage IPC returned an incoherent SQLite footprint');
			} else {
				console.log('OK: storage usage IPC returned a coherent SQLite footprint');
			}
			await evaluateRenderer(renderer.webSocketDebuggerUrl, 'window.close(); true');
			await new Promise((resolve) => setTimeout(resolve, 500));
			const hiddenHealth = await fetch(`${baseUrl}/healthz`);
			if (hiddenHealth.status !== 200) {
				fail(`receiver stopped after window close (${hiddenHealth.status})`);
			} else {
				console.log('OK: closing the window keeps the tray runtime receiving');
			}
		}

		// Valid ingest.
		const traceBody = readFileSync(fixture, 'utf8');
		const ingest = await fetch(`${baseUrl}/v1/traces`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: traceBody,
		});
		if (ingest.status !== 200) {
			fail(`trace ingest returned ${ingest.status}, expected 200`);
		} else {
			console.log('OK: receiver ingested a trace (200)');
		}

		// 2. Hardening survives packaging: wrong content type is refused.
		const wrongType = await fetch(`${baseUrl}/v1/traces`, {
			method: 'POST',
			headers: { 'content-type': 'text/plain' },
			body: traceBody,
		});
		if (wrongType.status !== 415) {
			fail(`non-JSON POST returned ${wrongType.status}, expected 415`);
		} else {
			console.log('OK: non-JSON POST rejected (415)');
		}
	}
} catch (err) {
	fail(err instanceof Error ? err.message : String(err));
} finally {
	await shutdown();
	if (await endpointResponds(`${baseUrl}/healthz`)) {
		fail('OTLP receiver remained reachable after full shutdown');
	} else {
		console.log('OK: full quit stopped the OTLP receiver');
	}
	if (await endpointResponds(mcpUrl)) {
		fail('MCP server remained reachable after full shutdown');
	} else {
		console.log('OK: full quit stopped the MCP server');
	}
	if (
		existsSync(join(userDataDir, 'runtime.json')) ||
		existsSync(join(userDataDir, 'runtime.lock'))
	) {
		fail('runtime state or ownership lock remained after clean shutdown');
	}
	rmSync(userDataDir, { recursive: true, force: true });
}

if (process.exitCode === undefined || process.exitCode === 0) {
	console.log('SMOKE PASS');
}
// Force exit: even after killing the child, lingering handles can keep the
// event loop alive. The assertions and cleanup are done, so exit now.
process.exit(process.exitCode ?? 0);
