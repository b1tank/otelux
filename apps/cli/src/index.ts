import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
	type ConnectRuntimeClientOptions,
	type DiscoveredRuntimeClient,
	type EnsureRuntimeClientOptions,
	connectRuntimeClient,
	ensureRuntimeClient,
	readRuntimeState,
	resolveOteluxDataDirectory,
} from '@otelux/local-runtime';

export interface CliOutput {
	log(message: string): void;
	error(message: string): void;
}

export interface CliDependencies {
	connect(options: ConnectRuntimeClientOptions): Promise<DiscoveredRuntimeClient | undefined>;
	ensure(options: EnsureRuntimeClientOptions): Promise<DiscoveredRuntimeClient>;
	start(dataDirectory: string): void;
	waitStopped(dataDirectory: string, instanceId: string): Promise<void>;
}

const defaultDependencies: CliDependencies = {
	connect: connectRuntimeClient,
	ensure: ensureRuntimeClient,
	start: startDaemon,
	waitStopped: waitForStopped,
};

export async function runCli(
	args: readonly string[],
	output: CliOutput = console,
	dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
	const json = args.includes('--json');
	const positional = args.filter((arg) => arg !== '--json');
	const command = positional[0];
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		output.log(help());
		return command ? 0 : 1;
	}
	if (positional.length !== 1) {
		output.error(`Unexpected arguments: ${positional.slice(1).join(' ')}`);
		return 1;
	}
	const dataDirectory = resolveOteluxDataDirectory();
	try {
		switch (command) {
			case 'status': {
				const found = await dependencies.connect({ dataDirectory, clientName: 'otelux-cli' });
				if (!found) return notRunning(output, json);
				try {
					const [status, settings, storage, usage] = await Promise.all([
						found.client.getStatus(),
						found.client.getSettings(),
						found.client.getStoragePath(),
						found.client.getStorageUsage(),
					]);
					print(output, json, { healthy: true, status, settings, storage, usage });
					return 0;
				} finally {
					found.client.close();
				}
			}
			case 'endpoints': {
				const found = await dependencies.connect({ dataDirectory, clientName: 'otelux-cli' });
				if (!found) return notRunning(output, json);
				try {
					const status = await found.client.getStatus();
					const endpoints = {
						otlp:
							status.receiver.kind === 'running'
								? `http://${status.receiver.host}:${status.receiver.port}`
								: null,
						mcp: status.mcp.kind === 'running' ? `http://${status.mcp.host}:${status.mcp.port}/` : null,
						api: status.api?.kind === 'running' ? `http://${status.api.host}:${status.api.port}` : null,
					};
					print(output, json, endpoints);
					return 0;
				} finally {
					found.client.close();
				}
			}
			case 'start': {
				const found = await dependencies.ensure({
					dataDirectory,
					clientName: 'otelux-cli',
					start: () => dependencies.start(dataDirectory),
				});
				print(output, json, {
					started: true,
					instanceId: found.state.instanceId,
					pid: found.state.pid,
				});
				found.client.close();
				return 0;
			}
			case 'stop': {
				const found = await dependencies.connect({ dataDirectory, clientName: 'otelux-cli' });
				if (!found) return notRunning(output, json);
				await found.client.shutdown();
				found.client.close();
				await dependencies.waitStopped(dataDirectory, found.state.instanceId);
				print(output, json, { stopped: true });
				return 0;
			}
			case 'restart': {
				const found = await dependencies.connect({ dataDirectory, clientName: 'otelux-cli' });
				if (found) {
					await found.client.shutdown();
					found.client.close();
					await dependencies.waitStopped(dataDirectory, found.state.instanceId);
				}
				const restarted = await dependencies.ensure({
					dataDirectory,
					clientName: 'otelux-cli',
					start: () => dependencies.start(dataDirectory),
				});
				print(output, json, {
					restarted: true,
					instanceId: restarted.state.instanceId,
					pid: restarted.state.pid,
				});
				restarted.client.close();
				return 0;
			}
			case 'doctor': {
				const found = await dependencies.connect({ dataDirectory, clientName: 'otelux-cli' });
				if (!found) return notRunning(output, json);
				try {
					const status = await found.client.getStatus();
					const issues = [
						...(status.receiver.kind === 'error' ? [`OTLP receiver: ${status.receiver.message}`] : []),
						...(status.mcp.kind === 'error' ? [`MCP server: ${status.mcp.message}`] : []),
						...(status.api?.kind === 'error' ? [`Runtime API: ${status.api.message}`] : []),
					];
					print(output, json, { healthy: issues.length === 0, issues, instanceId: status.instanceId });
					return issues.length === 0 ? 0 : 4;
				} finally {
					found.client.close();
				}
			}
			default:
				output.error(`Unknown command: ${command}\n\n${help()}`);
				return 1;
		}
	} catch (error) {
		const value = error as { code?: unknown; message?: unknown };
		output.error(json ? stringify({ error: String(value.code ?? 'internal') }) : safeError(value));
		return value.code === 'incompatible-version' ? 3 : 1;
	}
}

function startDaemon(dataDirectory: string): void {
	const require = createRequire(import.meta.url);
	const entry = require.resolve('@otelux/local-runtime');
	const daemon = join(dirname(entry), 'daemon.js');
	const child = spawn(process.execPath, [daemon], {
		detached: true,
		stdio: 'ignore',
		env: { ...process.env, OTELUX_DATA_DIR: dataDirectory },
	});
	child.unref();
}

async function waitForStopped(dataDirectory: string, instanceId: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const state = await readRuntimeState(dataDirectory);
		if (!state || state.instanceId !== instanceId) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error('Timed out waiting for the runtime to stop');
}

function notRunning(output: CliOutput, json: boolean): number {
	print(output, json, { healthy: false, running: false });
	return 2;
}

function print(output: CliOutput, json: boolean, value: unknown): void {
	output.log(json ? stringify(value) : human(value));
}

function stringify(value: unknown): string {
	return JSON.stringify(value, (_key, entry: unknown) =>
		typeof entry === 'bigint' ? entry.toString() : entry,
	);
}

function human(value: unknown): string {
	return JSON.stringify(
		value,
		(_key, entry: unknown) => (typeof entry === 'bigint' ? entry.toString() : entry),
		2,
	);
}

function safeError(value: { code?: unknown; message?: unknown }): string {
	if (value.code === 'incompatible-version' && typeof value.message === 'string')
		return value.message;
	return `OTelux command failed (${String(value.code ?? 'internal')})`;
}

function help(): string {
	return 'Usage: otelux <command> [--json]\n\nCommands:\n  start      Start or reuse the local runtime\n  stop       Stop the local runtime\n  restart    Restart the local runtime\n  status     Show runtime, settings, and storage status\n  endpoints  Show local OTLP, MCP, and Runtime API endpoints\n  doctor     Check listener health';
}

if (process.argv[1]?.endsWith('/otelux') || process.argv[1]?.endsWith('/index.js')) {
	process.exitCode = await runCli(process.argv.slice(2));
}
