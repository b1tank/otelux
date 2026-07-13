/**
 * Cross-process single-instance election for the OTLP receiver.
 *
 * The desktop app and the VS Code extension both want to listen on the
 * same default OTLP/HTTP port (4318) on `127.0.0.1`. Only one of them
 * can win the bind. This helper decides — based on a small JSON
 * lockfile — whether the current process is the "owner" (must start a
 * receiver) or a "client" (should forward to the already-running
 * receiver instead of binding).
 *
 * Why a lockfile rather than just attempting `listen()` and falling
 * back on EADDRINUSE? Because we also need to know **what URL to send
 * to** when we lose the race. A free-port fallback would leave the
 * client without an endpoint to point at. The lockfile carries that
 * endpoint metadata.
 *
 * Algorithm:
 * 1. Try to atomically create the lockfile with `O_EXCL` (`wx` flag).
 *    Success → write `{pid, host, port}` and return `{role: 'owner'}`.
 * 2. If the file already exists, read it and ask the caller-supplied
 *    `ping` predicate whether the recorded endpoint is alive. If alive,
 *    return `{role: 'client'}` carrying that endpoint.
 * 3. If not alive (process died without releasing), the lock is stale.
 *    Delete the file and retry from step 1. Bounded retry budget keeps
 *    pathological inputs from spinning.
 *
 * The `ping` predicate is injectable so tests can simulate liveness
 * without an HTTP server and so production callers can choose whatever
 * probe matches their receiver (GET /healthz today, gRPC reflection
 * later).
 */

import { type FileHandle, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SingleInstanceEndpoint {
	readonly host: string;
	readonly port: number;
}

export interface ClaimSingleInstanceOptions {
	/** Absolute path to the lockfile. Parent directory is created if missing. */
	readonly lockfile: string;
	/** Port we want to bind if we become the owner. */
	readonly preferredPort: number;
	/** Host we want to bind if we become the owner. Defaults to `127.0.0.1`. */
	readonly host?: string;
	/** Returns true if the recorded endpoint is reachable; we use this to detect stale lockfiles. */
	readonly ping: (endpoint: SingleInstanceEndpoint) => Promise<boolean>;
	/** Max attempts before giving up. Defaults to 3. */
	readonly maxAttempts?: number;
}

export type SingleInstanceClaim =
	| {
			readonly role: 'owner';
			readonly ownerEndpoint: SingleInstanceEndpoint;
			readonly release: () => Promise<void>;
	  }
	| {
			readonly role: 'client';
			readonly ownerEndpoint: SingleInstanceEndpoint;
			readonly release: () => Promise<void>;
	  };

interface LockfilePayload {
	readonly pid: number;
	readonly host: string;
	readonly port: number;
	readonly createdAt: string;
}

export async function claimSingleInstance(
	options: ClaimSingleInstanceOptions,
): Promise<SingleInstanceClaim> {
	const host = options.host ?? '127.0.0.1';
	const maxAttempts = options.maxAttempts ?? 3;

	// Ensure the parent directory exists once, up front. mkdir({recursive})
	// is a no-op if it already exists.
	await mkdir(dirname(options.lockfile), { recursive: true });

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const acquired = await tryAcquire(options.lockfile, {
			pid: process.pid,
			host,
			port: options.preferredPort,
			createdAt: new Date().toISOString(),
		});
		if (acquired) {
			return {
				role: 'owner',
				ownerEndpoint: { host, port: options.preferredPort },
				release: () => safeUnlink(options.lockfile),
			};
		}

		const existing = await readLockfile(options.lockfile);
		if (existing === undefined) {
			// Either the file vanished between EEXIST and read (race with an
			// owner that exited) or its contents are corrupt JSON. In both
			// cases delete-and-retry is correct: safeUnlink handles ENOENT.
			await safeUnlink(options.lockfile);
			continue;
		}

		const endpoint: SingleInstanceEndpoint = { host: existing.host, port: existing.port };
		const alive = await safePing(options.ping, endpoint);
		if (alive) {
			return {
				role: 'client',
				ownerEndpoint: endpoint,
				// Clients never release the lock; only the owner can.
				release: async () => {},
			};
		}

		// Stale lock. Reclaim by deleting and retrying.
		await safeUnlink(options.lockfile);
	}

	throw new Error(
		`claimSingleInstance: failed to acquire ${options.lockfile} after ${maxAttempts} attempts`,
	);
}

async function tryAcquire(path: string, payload: LockfilePayload): Promise<boolean> {
	let handle: FileHandle | undefined;
	try {
		// `wx` = O_WRONLY | O_CREAT | O_EXCL — atomic create-or-fail per
		// https://man7.org/linux/man-pages/man2/open.2.html. This is the
		// primitive that makes the election race-free.
		handle = await open(path, 'wx');
		await handle.writeFile(JSON.stringify(payload, null, 2));
		return true;
	} catch (err) {
		if (isNodeError(err) && err.code === 'EEXIST') {
			return false;
		}
		throw err;
	} finally {
		await handle?.close();
	}
}

async function readLockfile(path: string): Promise<LockfilePayload | undefined> {
	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch (err) {
		if (isNodeError(err) && err.code === 'ENOENT') {
			return undefined;
		}
		throw err;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<LockfilePayload>;
		if (
			typeof parsed.pid === 'number' &&
			typeof parsed.host === 'string' &&
			typeof parsed.port === 'number' &&
			typeof parsed.createdAt === 'string'
		) {
			return parsed as LockfilePayload;
		}
	} catch {
		// Corrupt JSON — treat as a missing/stale lock.
	}
	return undefined;
}

async function safeUnlink(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (err) {
		if (isNodeError(err) && err.code === 'ENOENT') {
			return;
		}
		throw err;
	}
}

async function safePing(
	ping: (endpoint: SingleInstanceEndpoint) => Promise<boolean>,
	endpoint: SingleInstanceEndpoint,
): Promise<boolean> {
	try {
		return await ping(endpoint);
	} catch {
		return false;
	}
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && 'code' in err;
}
