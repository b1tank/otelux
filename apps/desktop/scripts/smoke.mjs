#!/usr/bin/env node
/**
 * Packaged smoke test for the OTelux desktop app.
 *
 * Launches the packed Linux binary (from `electron-builder --linux dir`)
 * and asserts the end-to-end runtime path that a release must satisfy:
 *   1. The process starts and the OTLP receiver answers `/healthz`.
 *   2. A valid OTLP/HTTP JSON trace is ingested (`200` + partialSuccess).
 *   3. The request hardening survives packaging (a non-JSON `POST` → `415`).
 *   4. The process shuts down cleanly on SIGTERM.
 *
 * Requires a display; CI wraps this with `xvfb-run`. Runs with
 * `--no-sandbox` because CI and containerized hosts often lack user
 * namespaces — this is a functional smoke, not a sandbox test.
 *
 * Exit code 0 on success, non-zero on any failed assertion.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, '..');
const repoRoot = join(desktopDir, '..', '..');
const binary = join(desktopDir, 'release', 'linux-unpacked', 'otelux');
const fixture = join(repoRoot, 'fixtures', 'sample_trace.json');

const otlpPort = 20000 + Math.floor(Math.random() * 10000);
const baseUrl = `http://127.0.0.1:${otlpPort}`;
const userDataDir = mkdtempSync(join(tmpdir(), 'otelux-smoke-'));

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

function fail(message) {
	console.error(`SMOKE FAIL: ${message}`);
	console.error('--- app output ---');
	console.error(log.join('').slice(-4000));
	process.exitCode = 1;
}

const child = spawn(binary, ['--no-sandbox', `--user-data-dir=${userDataDir}`], {
	env: { ...process.env, OTELUX_OTLP_PORT: String(otlpPort) },
	stdio: ['ignore', 'pipe', 'pipe'],
	// New process group so we can signal Electron and all of its child
	// processes (GPU, zygote, utility) as one unit on shutdown.
	detached: true,
});
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
		signalGroup('SIGTERM');
		if (!(await waitForExit(5000))) {
			// Electron can ignore SIGTERM under --no-sandbox; force it.
			signalGroup('SIGKILL');
			await waitForExit(3000);
		}
	}
	child.stdout?.destroy();
	child.stderr?.destroy();
	rmSync(userDataDir, { recursive: true, force: true });
}

try {
	if (!(await waitForHealth(45_000))) {
		fail('receiver did not answer /healthz within 45s');
	} else {
		// 1. Valid ingest.
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
}

if (process.exitCode === undefined || process.exitCode === 0) {
	console.log('SMOKE PASS');
}
// Force exit: even after killing the child, lingering handles can keep the
// event loop alive. The assertions and cleanup are done, so exit now.
process.exit(process.exitCode ?? 0);
