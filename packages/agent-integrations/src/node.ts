import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type {
	CommandResult,
	CommandRunner,
	InspectPathRequest,
	InspectedPath,
	PathInspector,
} from './contracts.js';

export interface NodeCommandRunnerOptions {
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
}

export function createNodeCommandRunner(options: NodeCommandRunnerOptions = {}): CommandRunner {
	const timeout = positiveInteger(options.timeoutMs, 5_000, 'timeoutMs');
	const maxBuffer = positiveInteger(options.maxOutputBytes, 128 * 1024, 'maxOutputBytes');
	return {
		run: async (executable, args) => {
			validateCommand(executable, args);
			return await new Promise<CommandResult>((done) => {
				execFile(
					executable,
					[...args],
					{ encoding: 'utf8', maxBuffer, timeout, windowsHide: true },
					(error, stdout, stderr) => {
						const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
						done({
							exitCode,
							stdout: bound(stdout, maxBuffer),
							stderr: bound(stderr, maxBuffer),
						});
					},
				);
			});
		},
	};
}

export function createNodePathInspector(): PathInspector {
	return { inspect: inspectAgentPath };
}

export async function inspectAgentPath(request: InspectPathRequest): Promise<InspectedPath> {
	const root = resolve(request.allowedRoot);
	const path = resolve(request.path);
	const issues: string[] = [];
	if (!inside(root, path)) {
		return result(request, path, false, false, undefined, ['path is outside the selected scope']);
	}
	await inspectParents(root, dirname(path), issues);
	let info: Stats;
	try {
		info = await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return result(request, path, false, issues.length === 0, undefined, issues);
		}
		return result(request, path, false, false, undefined, [...issues, 'path is unavailable']);
	}
	if (info.isSymbolicLink()) {
		return result(request, path, true, false, undefined, [...issues, 'path is a symbolic link']);
	}
	if (request.kind === 'file' ? !info.isFile() : !info.isDirectory()) {
		issues.push(`path is not a regular ${request.kind}`);
	}
	inspectOwnership(info, 'path', issues);
	let sha256: string | undefined;
	if (request.hashContents && info.isFile() && issues.length === 0) {
		try {
			sha256 = await hashFileBounded(path, 1024 * 1024);
		} catch {
			issues.push('file exceeds the inspection limit or could not be read');
		}
	}
	return result(request, path, true, issues.length === 0, sha256, issues);
}

async function inspectParents(root: string, start: string, issues: string[]): Promise<void> {
	let current = start;
	while (inside(root, current)) {
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink()) issues.push('scope parent is a symbolic link');
			else if (!info.isDirectory()) issues.push('scope parent is not a directory');
			inspectOwnership(info, 'scope parent', issues);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
				issues.push('scope parent is unavailable');
		}
		if (current === root) break;
		current = dirname(current);
	}
}

function inspectOwnership(info: Stats, label: string, issues: string[]): void {
	if (process.platform === 'win32') return;
	if ((info.mode & 0o002) !== 0) issues.push(`${label} is world-writable`);
	if (process.getuid && info.uid !== process.getuid())
		issues.push(`${label} has an unexpected owner`);
}

async function hashFileBounded(path: string, maximumBytes: number): Promise<string> {
	const handle = await open(path, 'r');
	try {
		const buffer = Buffer.allocUnsafe(maximumBytes + 1);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		if (bytesRead > maximumBytes) throw new Error('file exceeds the 1 MiB inspection limit');
		return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
	} finally {
		await handle.close();
	}
}

function inside(root: string, path: string): boolean {
	const value = relative(root, path);
	return value === '' || (!value.startsWith('..') && !value.startsWith('/'));
}

function result(
	request: InspectPathRequest,
	path: string,
	exists: boolean,
	secure: boolean,
	sha256: string | undefined,
	issues: readonly string[],
): InspectedPath {
	return {
		path,
		scope: request.scope,
		kind: request.kind,
		exists,
		secure,
		...(sha256 !== undefined ? { sha256 } : {}),
		issues,
	};
}

function validateCommand(executable: string, args: readonly string[]): void {
	if (executable.length === 0 || executable.length > 4096 || executable.includes('\0')) {
		throw new Error('executable is invalid');
	}
	if (args.length > 64) throw new Error('command has too many arguments');
	for (const argument of args) {
		if (argument.length > 4096 || argument.includes('\0'))
			throw new Error('command argument is invalid');
	}
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${name} must be positive`);
	return result;
}

function bound(value: string, maximum: number): string {
	return value.length <= maximum ? value : value.slice(0, maximum);
}
