import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { McpStatus, ReceiverStatus } from '@otelux/protocol';

export const RUNTIME_LOCK_FILE = 'runtime.lock';
export const RUNTIME_STATE_FILE = 'runtime.json';

export interface RuntimeLockOwner {
	readonly version: 1;
	readonly instanceId: string;
	readonly pid: number;
	readonly acquiredAt: string;
}

export interface RuntimeState {
	readonly version: 1;
	readonly runtimeVersion: string;
	readonly protocolVersion: string;
	readonly instanceId: string;
	readonly pid: number;
	readonly startedAt: string;
	readonly dataDirectory: string;
	readonly databasePath: string;
	readonly mcpTokenFile: string;
	readonly receiver: ReceiverStatus;
	readonly mcp: McpStatus;
}

export interface ClaimRuntimeOwnershipOptions {
	readonly dataDirectory: string;
	readonly processId?: number;
	readonly instanceId?: string;
	readonly isProcessAlive?: (pid: number) => boolean;
	readonly maxAttempts?: number;
}

export type RuntimeOwnershipClaim =
	| {
			readonly role: 'owner';
			readonly owner: RuntimeLockOwner;
			release(): Promise<void>;
	  }
	| {
			readonly role: 'client';
			readonly owner?: RuntimeLockOwner;
			readonly state?: RuntimeState;
			release(): Promise<void>;
	  };

export async function claimRuntimeOwnership(
	options: ClaimRuntimeOwnershipOptions,
): Promise<RuntimeOwnershipClaim> {
	await ensurePrivateDirectory(options.dataDirectory);
	const lockPath = join(options.dataDirectory, RUNTIME_LOCK_FILE);
	const processId = options.processId ?? process.pid;
	if (!isValidPid(processId)) {
		throw new Error(`Runtime process ID must be a positive integer; got ${processId}`);
	}
	const instanceId = options.instanceId ?? randomUUID();
	const isProcessAlive = options.isProcessAlive ?? defaultProcessLiveness;
	const maxAttempts = options.maxAttempts ?? 3;
	const owner: RuntimeLockOwner = {
		version: 1,
		instanceId,
		pid: processId,
		acquiredAt: new Date().toISOString(),
	};

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (await tryCreateLock(lockPath, owner)) {
			return {
				role: 'owner',
				owner,
				release: () => removeOwnedFile(lockPath, instanceId),
			};
		}

		const existing = await readLockOwner(lockPath);
		if (existing && isProcessAlive(existing.pid)) {
			const state = await readRuntimeState(options.dataDirectory);
			return {
				role: 'client',
				owner: existing,
				...(state?.instanceId === existing.instanceId ? { state } : {}),
				release: async () => {},
			};
		}

		if (!existing && (await isRecentFile(lockPath, 30_000))) {
			return { role: 'client', release: async () => {} };
		}

		if (existing) {
			await removeRuntimeState(options.dataDirectory, existing.instanceId);
		}
		await rm(lockPath, { force: true });
	}

	throw new Error(`Failed to claim OTelux runtime ownership at ${lockPath}`);
}

export async function readRuntimeState(dataDirectory: string): Promise<RuntimeState | undefined> {
	const path = join(dataDirectory, RUNTIME_STATE_FILE);
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<RuntimeState>;
		if (
			parsed.version === 1 &&
			typeof parsed.runtimeVersion === 'string' &&
			typeof parsed.protocolVersion === 'string' &&
			typeof parsed.instanceId === 'string' &&
			isValidPid(parsed.pid) &&
			typeof parsed.startedAt === 'string' &&
			typeof parsed.dataDirectory === 'string' &&
			typeof parsed.databasePath === 'string' &&
			typeof parsed.mcpTokenFile === 'string' &&
			isReceiverStatus(parsed.receiver) &&
			isMcpStatus(parsed.mcp)
		) {
			return parsed as RuntimeState;
		}
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') {
			return undefined;
		}
		return undefined;
	}
	return undefined;
}

export async function writeRuntimeState(dataDirectory: string, state: RuntimeState): Promise<void> {
	await ensurePrivateDirectory(dataDirectory);
	const path = join(dataDirectory, RUNTIME_STATE_FILE);
	const temporary = `${path}.tmp-${state.instanceId}-${randomUUID()}`;
	try {
		await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function removeRuntimeState(dataDirectory: string, instanceId: string): Promise<void> {
	await removeOwnedFile(join(dataDirectory, RUNTIME_STATE_FILE), instanceId);
}

async function tryCreateLock(path: string, owner: RuntimeLockOwner): Promise<boolean> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	let created = false;
	try {
		handle = await open(path, 'wx', 0o600);
		created = true;
		await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`);
		await handle.sync();
		return true;
	} catch (error) {
		if (isNodeError(error) && error.code === 'EEXIST') {
			return false;
		}
		if (created) {
			await rm(path, { force: true });
		}
		throw error;
	} finally {
		await handle?.close();
	}
}

async function readLockOwner(path: string): Promise<RuntimeLockOwner | undefined> {
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<RuntimeLockOwner>;
		if (
			parsed.version === 1 &&
			typeof parsed.instanceId === 'string' &&
			isValidPid(parsed.pid) &&
			typeof parsed.acquiredAt === 'string'
		) {
			return parsed as RuntimeLockOwner;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

async function removeOwnedFile(path: string, instanceId: string): Promise<void> {
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8')) as { instanceId?: unknown };
		if (parsed.instanceId === instanceId) {
			await rm(path, { force: true });
		}
	} catch (error) {
		if (isNodeError(error) && error.code === 'ENOENT') {
			return;
		}
		// A malformed file cannot be proven to belong to this owner. Preserve it
		// rather than deleting another process's replacement by mistake.
		return;
	}
}

async function isRecentFile(path: string, maximumAgeMs: number): Promise<boolean> {
	try {
		const info = await stat(path);
		return Date.now() - info.mtimeMs < maximumAgeMs;
	} catch {
		return false;
	}
}

async function ensurePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	if (process.platform !== 'win32') {
		await chmod(path, 0o700);
	}
}

function defaultProcessLiveness(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return isNodeError(error) && error.code === 'EPERM';
	}
}

function isReceiverStatus(value: unknown): value is ReceiverStatus {
	if (typeof value !== 'object' || value === null || !('kind' in value)) {
		return false;
	}
	const status = value as Partial<ReceiverStatus>;
	if (status.kind === 'starting') {
		return true;
	}
	if (status.kind === 'running') {
		return typeof status.host === 'string' && isValidPort(status.port);
	}
	return (
		status.kind === 'error' &&
		typeof status.host === 'string' &&
		isValidPort(status.port) &&
		typeof status.message === 'string'
	);
}

function isMcpStatus(value: unknown): value is McpStatus {
	if (typeof value !== 'object' || value === null || !('kind' in value)) {
		return false;
	}
	const status = value as Partial<McpStatus>;
	if (status.kind === 'starting' || status.kind === 'disabled') {
		return true;
	}
	if (status.kind === 'running') {
		return typeof status.host === 'string' && isValidPort(status.port);
	}
	return (
		status.kind === 'error' &&
		typeof status.host === 'string' &&
		isValidPort(status.port) &&
		typeof status.message === 'string'
	);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}

function isValidPid(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isValidPort(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535;
}
