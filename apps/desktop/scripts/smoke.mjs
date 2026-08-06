#!/usr/bin/env node
/**
 * Packaged smoke test for the OTelux desktop app.
 *
 * Launches the native unpacked application produced by electron-builder on
 * Linux, macOS, or Windows and asserts the end-to-end runtime path that a
 * release must satisfy:
 *   1. The process starts and the OTLP receiver answers `/healthz`.
 *   2. The sandboxed preload bridge loads and the workbench renders.
 *   3. A valid OTLP/HTTP JSON trace is ingested (`200` + partialSuccess).
 *   4. The request hardening survives packaging (a non-JSON `POST` → `415`).
 *   5. A second invocation requests the same explicit clean-quit path as the
 *      tray menu, then OTLP/MCP and runtime ownership disappear.
 *
 * Linux requires a display; CI wraps it with `xvfb-run` and uses
 * `--no-sandbox` because containerized hosts may lack user namespaces. This
 * is a functional package smoke, not a sandbox-policy test.
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
const desktopDir = process.env.OTELUX_SMOKE_DESKTOP_DIR ?? join(here, '..');
const repoRoot = process.env.OTELUX_SMOKE_REPO_ROOT ?? join(desktopDir, '..', '..');
function packagedBinaryCandidates() {
	if (process.env.OTELUX_SMOKE_BINARY) {
		return [process.env.OTELUX_SMOKE_BINARY];
	}
	if (process.platform === 'win32') {
		return [join(desktopDir, 'release', 'win-unpacked', 'otelux.exe')];
	}
	if (process.platform === 'darwin') {
		const architectureDirectory = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
		return [
			join(desktopDir, 'release', architectureDirectory, 'otelux.app', 'Contents', 'MacOS', 'otelux'),
			join(desktopDir, 'release', 'mac', 'otelux.app', 'Contents', 'MacOS', 'otelux'),
			join(desktopDir, 'release', 'mac-arm64', 'otelux.app', 'Contents', 'MacOS', 'otelux'),
		];
	}
	const architectureDirectory = process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked';
	return [
		join(desktopDir, 'release', architectureDirectory, 'otelux'),
		join(desktopDir, 'release', 'linux-unpacked', 'otelux'),
		join(desktopDir, 'release', 'linux-arm64-unpacked', 'otelux'),
	];
}

const candidates = packagedBinaryCandidates();
const binary = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
if (!binary || !existsSync(binary)) {
	throw new Error(`packaged application not found; checked: ${candidates.join(', ')}`);
}
const fixture = join(repoRoot, 'fixtures', 'sample_trace.json');
const quitFlag = '--otelux-request-quit';
const platformArguments =
	process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=x11'] : [];

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
const apiPort = await availablePort();
const baseUrl = `http://127.0.0.1:${otlpPort}`;
const mcpUrl = `http://127.0.0.1:${mcpPort}/`;
let runtimeApiUrl;
let runtimePid;
const userDataDir = mkdtempSync(join(tmpdir(), 'otelux-smoke-'));
writeFileSync(
	join(userDataDir, 'settings.json'),
	JSON.stringify({
		version: 1,
		revision: 0,
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

async function waitForHealthStop(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!(await endpointResponds(`${baseUrl}/healthz`))) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
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

function closeRenderer(webSocketDebuggerUrl) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(webSocketDebuggerUrl);
		let sent = false;
		let finished = false;
		const finish = (callback) => {
			if (finished) {
				return;
			}
			finished = true;
			clearTimeout(timer);
			socket.close();
			callback();
		};
		const timer = setTimeout(() => {
			finish(() => (sent ? resolve() : reject(new Error('renderer CDP close command was not sent'))));
		}, 1_000);

		socket.addEventListener('open', () => {
			sent = true;
			socket.send(
				JSON.stringify({
					id: 1,
					method: 'Runtime.evaluate',
					params: { expression: 'window.close()' },
				}),
			);
		});
		socket.addEventListener('message', () => finish(resolve));
		socket.addEventListener('close', () => {
			finish(() => (sent ? resolve() : reject(new Error('renderer CDP closed before command'))));
		});
		socket.addEventListener('error', () => {
			finish(() => (sent ? resolve() : reject(new Error('renderer CDP connection failed'))));
		});
	});
}

function versionAtLeast(version, minimum) {
	const actual = version.split('.').map(Number);
	const required = minimum.split('.').map(Number);
	for (let index = 0; index < Math.max(actual.length, required.length); index++) {
		const difference = (actual[index] ?? 0) - (required[index] ?? 0);
		if (difference !== 0) {
			return difference > 0;
		}
	}
	return true;
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
							version: window.otelux?.version,
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
		...platformArguments,
		`--remote-debugging-port=${debuggingPort}`,
		`--user-data-dir=${userDataDir}`,
	],
	{
		env: {
			...process.env,
			OTELUX_DATA_DIR: userDataDir,
			OTELUX_OTLP_PORT: String(otlpPort),
			OTELUX_API_PORT: String(apiPort),
		},
		stdio: ['ignore', 'pipe', 'pipe'],
		// POSIX gets a process group for the final wedged-process fallback.
		// Windows does not support negative-PID process-group signals.
		detached: process.platform !== 'win32',
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
	if (process.platform === 'win32') {
		child.kill();
		return;
	}
	// Negative pid targets the whole process group created by `detached`.
	try {
		process.kill(-child.pid, signal);
	} catch {
		// Group already gone.
	}
}

function waitForProcessExit(process_, timeoutMs) {
	if (process_.exitCode !== null || process_.signalCode !== null) {
		return Promise.resolve(true);
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		process_.once('exit', () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

async function requestCleanQuit() {
	const helper = spawn(binary, [...platformArguments, quitFlag, `--user-data-dir=${userDataDir}`], {
		env: {
			...process.env,
			OTELUX_DATA_DIR: userDataDir,
			OTELUX_OTLP_PORT: String(otlpPort),
			OTELUX_API_PORT: String(apiPort),
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	helper.stdout?.on('data', record);
	helper.stderr?.on('data', record);
	if (!(await waitForProcessExit(helper, 10_000))) {
		helper.kill();
		throw new Error('packaged quit helper did not exit within 10s');
	}
}

async function shutdown() {
	if (!exited) {
		try {
			await requestCleanQuit();
		} catch (error) {
			record(`${error instanceof Error ? error.message : String(error)}\n`);
		}
		if (!(await waitForExit(10_000))) {
			// Preserve signal compatibility for POSIX process managers, then use
			// a final group/process kill only if the explicit path wedged.
			if (process.platform !== 'win32') {
				child.kill('SIGTERM');
			}
			if (!(await waitForExit(5_000))) {
				signalGroup('SIGKILL');
				await waitForExit(3_000);
			}
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
			runtimePid = state.pid;
			if (state.receiver?.kind !== 'running' || state.receiver.port !== otlpPort) {
				fail(`runtime.json did not report the live OTLP port ${otlpPort}`);
			}
			if (state.mcp?.kind !== 'running' || state.mcp.port !== mcpPort) {
				fail(`runtime.json did not report the live MCP port ${mcpPort}`);
			}
			if (state.api?.kind === 'running' && typeof state.runtimeTokenFile === 'string') {
				runtimeApiUrl = `http://${state.api.host}:${state.api.port}`;
				const token = readFileSync(state.runtimeTokenFile, 'utf8').trim();
				const response = await fetch(`${runtimeApiUrl}/api/v1/rpc`, {
					method: 'POST',
					headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'runtime/getStatus' }),
				});
				const result = await response.json();
				if (response.status !== 200 || result?.result?.api?.port !== state.api.port) {
					fail('authenticated Runtime RPC status check failed');
				} else {
					console.log('OK: authenticated Runtime RPC answered status');
				}
			}
		}

		const renderer = await waitForRenderer(45_000);
		if (!renderer) {
			fail('preload bridge or rendered workbench was not available within 45s');
		} else {
			console.log('OK: preload bridge loaded and workbench rendered');
			if (versionAtLeast(renderer.state.version, '0.1.2')) {
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
			} else {
				console.log(`OK: storage usage IPC is not part of desktop ${renderer.state.version}`);
			}
			await closeRenderer(renderer.webSocketDebuggerUrl);
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
	if (!(await endpointResponds(`${baseUrl}/healthz`))) {
		fail('daemon stopped when Desktop quit');
	} else {
		console.log('OK: Desktop quit left the daemon receiving');
	}
	if (typeof runtimePid === 'number') {
		try {
			process.kill(runtimePid, 'SIGTERM');
		} catch {
			// A failed startup may leave no daemon to stop.
		}
		await waitForHealthStop(10_000);
	}
	if (await endpointResponds(`${baseUrl}/healthz`)) {
		fail('OTLP receiver remained reachable after explicit daemon stop');
	} else {
		console.log('OK: explicit daemon stop closed the OTLP receiver');
	}
	if (await endpointResponds(mcpUrl)) {
		fail('MCP server remained reachable after full shutdown');
	} else {
		console.log('OK: explicit daemon stop closed the MCP server');
	}
	if (runtimeApiUrl && (await endpointResponds(`${runtimeApiUrl}/healthz`))) {
		fail('Runtime API remained reachable after full shutdown');
	} else if (runtimeApiUrl) {
		console.log('OK: explicit daemon stop closed the Runtime API');
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
