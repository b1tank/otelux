import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
	type AgentInspection,
	createClaudeCodeAdapter,
	createNodeCommandRunner,
	createNodePathInspector,
} from '@otelux/agent-integrations';
import {
	type ConnectRuntimeClientOptions,
	type DiscoveredRuntimeClient,
	type EnsureRuntimeClientOptions,
	connectRuntimeClient,
	ensureRuntimeClient,
	readRuntimeState,
	resolveOteluxDataDirectory,
} from '@otelux/local-runtime';
import {
	type PartialSettings,
	type RuntimeState,
	type Settings,
	parseSettings,
} from '@otelux/protocol';

export interface CliOutput {
	log(message: string): void;
	error(message: string): void;
}

export interface CliDependencies {
	connect(options: ConnectRuntimeClientOptions): Promise<DiscoveredRuntimeClient | undefined>;
	ensure(options: EnsureRuntimeClientOptions): Promise<DiscoveredRuntimeClient>;
	start(dataDirectory: string): void;
	waitStopped(dataDirectory: string, instanceId: string): Promise<void>;
	inspectRuntimeFiles(state: RuntimeState): Promise<string[]>;
	inspectAgents(): Promise<AgentInspection[]>;
}

declare const __OTELUX_CLI_VERSION__: string;

const defaultDependencies: CliDependencies = {
	connect: connectRuntimeClient,
	ensure: ensureRuntimeClient,
	start: startDaemon,
	waitStopped: waitForStopped,
	inspectRuntimeFiles,
	inspectAgents,
};

export async function runCli(
	args: readonly string[],
	output: CliOutput = console,
	dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
	const json = args.includes('--json');
	const dryRun = args.includes('--dry-run');
	const yes = args.includes('--yes');
	const unknownFlag = args.find(
		(arg) => arg.startsWith('--') && !['--json', '--dry-run', '--yes', '--help'].includes(arg),
	);
	if (unknownFlag) {
		output.error(`Unknown option: ${unknownFlag}`);
		return 1;
	}
	const positional = args.filter((arg) => !['--json', '--dry-run', '--yes'].includes(arg));
	const command = positional[0];
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		output.log(help());
		return command ? 0 : 1;
	}
	if (!['config', 'agents'].includes(command) && (positional.length !== 1 || dryRun || yes)) {
		output.error(`Unexpected arguments: ${args.slice(1).join(' ')}`);
		return 1;
	}
	const dataDirectory = resolveOteluxDataDirectory();
	try {
		switch (command) {
			case 'status': {
				const found = await dependencies.connect(clientOptions(dataDirectory));
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
				const found = await dependencies.connect(clientOptions(dataDirectory));
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
					...clientOptions(dataDirectory),
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
				const found = await dependencies.connect(clientOptions(dataDirectory));
				if (!found) return notRunning(output, json);
				await found.client.shutdown();
				found.client.close();
				await dependencies.waitStopped(dataDirectory, found.state.instanceId);
				print(output, json, { stopped: true });
				return 0;
			}
			case 'restart': {
				const found = await dependencies.connect(clientOptions(dataDirectory));
				if (found) {
					await found.client.shutdown();
					found.client.close();
					await dependencies.waitStopped(dataDirectory, found.state.instanceId);
				}
				const restarted = await dependencies.ensure({
					...clientOptions(dataDirectory),
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
				const found = await dependencies.connect(clientOptions(dataDirectory));
				if (!found) return notRunning(output, json);
				try {
					const [status, settings, storage, usage, ownershipIssues] = await Promise.all([
						found.client.getStatus(),
						found.client.getSettings(),
						found.client.getStoragePath(),
						found.client.getStorageUsage(),
						dependencies.inspectRuntimeFiles(found.state),
					]);
					const desiredStoragePath = resolve(
						settings.storage.dbPath === '' ? storage.defaultPath : settings.storage.dbPath,
					);
					const restartRequired = desiredStoragePath !== resolve(storage.activePath);
					const issues = [
						...ownershipIssues,
						...(status.receiver.kind === 'running'
							? []
							: [
									`OTLP receiver: ${status.receiver.kind === 'error' ? status.receiver.message : status.receiver.kind}`,
								]),
						...(settings.mcp.enabled && status.mcp.kind !== 'running'
							? [`MCP server: ${status.mcp.kind === 'error' ? status.mcp.message : status.mcp.kind}`]
							: []),
						...(!settings.mcp.enabled && status.mcp.kind !== 'disabled'
							? ['MCP server is running while disabled in settings']
							: []),
						...(status.api?.kind === 'running'
							? []
							: [
									`Runtime API: ${status.api?.kind === 'error' ? status.api.message : (status.api?.kind ?? 'missing')}`,
								]),
						...(storage.activePath === usage.activePath
							? []
							: ['Storage path and usage snapshots disagree']),
					];
					print(output, json, {
						healthy: issues.length === 0,
						issues,
						restartRequired,
						instanceId: status.instanceId,
						versions: {
							cli: __OTELUX_CLI_VERSION__,
							runtime: status.runtimeVersion,
							protocol: status.protocolVersion,
						},
						ownership: { secure: ownershipIssues.length === 0 },
						storage: { ...storage, usage },
						listeners: { receiver: status.receiver, mcp: status.mcp, api: status.api },
					});
					return issues.length === 0 ? 0 : 4;
				} finally {
					found.client.close();
				}
			}
			case 'agents':
				return await runAgents(positional.slice(1), { json, dryRun, yes }, output, dependencies);
			case 'config':
				return await runConfig(
					positional.slice(1),
					{ json, dryRun, yes },
					output,
					dependencies,
					dataDirectory,
				);
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

async function runAgents(
	args: readonly string[],
	flags: ConfigFlags,
	output: CliOutput,
	dependencies: CliDependencies,
): Promise<number> {
	if (flags.dryRun || flags.yes) {
		output.error('Read-only agents commands do not accept mutation flags');
		return 1;
	}
	const operation = args[0];
	if (!['list', 'inspect', 'show-config'].includes(operation ?? '')) {
		output.error(
			'Usage: oteluxctl agents list | agents inspect <agent> | agents show-config <agent>',
		);
		return 1;
	}
	if ((operation === 'list' && args.length !== 1) || (operation !== 'list' && args.length !== 2)) {
		output.error(
			'Usage: oteluxctl agents list | agents inspect <agent> | agents show-config <agent>',
		);
		return 1;
	}
	const inspections = await dependencies.inspectAgents();
	if (operation === 'list') {
		print(
			output,
			flags.json,
			inspections.map((inspection) => ({
				id: inspection.agent.id,
				displayName: inspection.agent.displayName,
				detected: inspection.detected,
				installations: inspection.installations,
				capabilities: inspection.capabilities,
				issues: inspection.issues,
			})),
		);
		return 0;
	}
	const agent = args[1];
	const inspection = inspections.find(({ agent: descriptor }) => descriptor.id === agent);
	if (!inspection) {
		output.error(`Unknown or unsupported agent: ${agent ?? ''}`);
		return 1;
	}
	print(
		output,
		flags.json,
		operation === 'show-config'
			? {
					agent: inspection.agent,
					paths: inspection.paths,
					capabilities: inspection.capabilities,
					restartRequired: inspection.restartRequired,
				}
			: inspection,
	);
	return inspection.detected ? 0 : 6;
}

async function inspectAgents(): Promise<AgentInspection[]> {
	const context = {
		homeDirectory: homedir(),
		workingDirectory: process.cwd(),
		commandRunner: createNodeCommandRunner(),
		pathInspector: createNodePathInspector(),
	};
	return [await createClaudeCodeAdapter().inspect(context)];
}

interface ConfigFlags {
	readonly json: boolean;
	readonly dryRun: boolean;
	readonly yes: boolean;
}

async function runConfig(
	args: readonly string[],
	flags: ConfigFlags,
	output: CliOutput,
	dependencies: CliDependencies,
	dataDirectory: string,
): Promise<number> {
	const operation = args[0];
	if (operation !== 'get' && operation !== 'set') {
		output.error('Usage: oteluxctl config get [key] | config set <key> <value> (--dry-run | --yes)');
		return 1;
	}
	if (operation === 'get' && (args.length > 2 || flags.dryRun || flags.yes)) {
		output.error('Usage: oteluxctl config get [key] [--json]');
		return 1;
	}
	if (operation === 'set' && (args.length !== 3 || flags.dryRun === flags.yes)) {
		output.error('Usage: oteluxctl config set <key> <value> (--dry-run | --yes)');
		return 1;
	}
	const key = args[1];
	if (key !== undefined && !isConfigKey(key)) {
		output.error(`Unknown configuration key: ${key}`);
		return 1;
	}
	const found = await dependencies.connect(clientOptions(dataDirectory));
	if (!found) return notRunning(output, flags.json);
	try {
		const current = await found.client.getSettings();
		if (operation === 'get') {
			print(
				output,
				flags.json,
				key === undefined
					? current
					: { key, value: readConfigValue(current, key), revision: current.revision },
			);
			return 0;
		}
		if (key === undefined) return 1;
		let parsed: ConfigValue;
		let candidate: Settings;
		try {
			parsed = parseConfigValue(key, args[2] ?? '');
			candidate = applyConfigValue(current, key, parsed);
		} catch (error) {
			output.error(error instanceof Error ? error.message : String(error));
			return 1;
		}
		const previous = readConfigValue(current, key);
		const restartRequired = key === 'storage.dbPath' && previous !== parsed;
		if (flags.dryRun) {
			print(output, flags.json, {
				dryRun: true,
				changed: previous !== parsed,
				key,
				previous,
				value: parsed,
				expectedRevision: current.revision,
				restartRequired,
				settings: candidate,
			});
			return 0;
		}
		if (previous === parsed) {
			print(output, flags.json, {
				updated: false,
				changed: false,
				key,
				value: parsed,
				revision: current.revision,
			});
			return 0;
		}
		const result = await found.client.updateSettings(configPatch(key, parsed), current.revision);
		if (!result.ok) {
			output.error(
				flags.json ? stringify({ error: result.error, conflict: 'conflict' in result }) : result.error,
			);
			return 'conflict' in result ? 5 : 4;
		}
		print(output, flags.json, {
			updated: true,
			changed: true,
			key,
			value: parsed,
			revision: result.settings.revision,
			restartRequired,
			settings: result.settings,
		});
		return 0;
	} finally {
		found.client.close();
	}
}

const CONFIG_KEYS = [
	'otlp.port',
	'mcp.enabled',
	'mcp.port',
	'retention.maxAgeHours',
	'retention.maxSizeMb',
	'storage.dbPath',
] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];
type ConfigValue = string | number | boolean;

function isConfigKey(value: string): value is ConfigKey {
	return (CONFIG_KEYS as readonly string[]).includes(value);
}

function parseConfigValue(key: ConfigKey, value: string): ConfigValue {
	if (key === 'mcp.enabled') {
		if (value === 'true') return true;
		if (value === 'false') return false;
		throw new Error(`${key} must be true or false`);
	}
	if (key === 'storage.dbPath') return value;
	if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${key} must be a non-negative integer`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error(`${key} must be a safe integer`);
	return parsed;
}

function readConfigValue(settings: Settings, key: ConfigKey): ConfigValue {
	switch (key) {
		case 'otlp.port':
			return settings.otlp.port;
		case 'mcp.enabled':
			return settings.mcp.enabled;
		case 'mcp.port':
			return settings.mcp.port;
		case 'retention.maxAgeHours':
			return settings.retention.maxAgeHours;
		case 'retention.maxSizeMb':
			return settings.retention.maxSizeMb;
		case 'storage.dbPath':
			return settings.storage.dbPath;
	}
}

function configPatch(key: ConfigKey, value: ConfigValue): PartialSettings {
	switch (key) {
		case 'otlp.port':
			return { otlp: { port: value as number } };
		case 'mcp.enabled':
			return { mcp: { enabled: value as boolean } };
		case 'mcp.port':
			return { mcp: { port: value as number } };
		case 'retention.maxAgeHours':
			return { retention: { maxAgeHours: value as number } };
		case 'retention.maxSizeMb':
			return { retention: { maxSizeMb: value as number } };
		case 'storage.dbPath':
			return { storage: { dbPath: value as string } };
	}
}

function applyConfigValue(settings: Settings, key: ConfigKey, value: ConfigValue): Settings {
	const patch = configPatch(key, value);
	return parseSettings({
		...settings,
		otlp: { ...settings.otlp, ...patch.otlp },
		mcp: { ...settings.mcp, ...patch.mcp },
		retention: { ...settings.retention, ...patch.retention },
		storage: { ...settings.storage, ...patch.storage },
	});
}

async function inspectRuntimeFiles(state: RuntimeState): Promise<string[]> {
	const issues: string[] = [];
	await inspectPrivatePath(state.dataDirectory, 'data directory', 'directory', issues);
	await inspectPrivatePath(
		join(state.dataDirectory, 'runtime.json'),
		'runtime state',
		'file',
		issues,
	);
	await inspectPrivatePath(
		join(state.dataDirectory, 'runtime.lock'),
		'runtime lock',
		'file',
		issues,
	);
	await inspectPrivatePath(
		join(state.dataDirectory, 'runtime-token'),
		'runtime control token',
		'file',
		issues,
	);
	await inspectPrivatePath(
		state.mcpTokenFile ?? join(state.dataDirectory, 'mcp-token'),
		'MCP token',
		'file',
		issues,
	);
	return issues;
}

async function inspectPrivatePath(
	path: string,
	label: string,
	kind: 'file' | 'directory',
	issues: string[],
): Promise<void> {
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink() || (kind === 'file' ? !info.isFile() : !info.isDirectory())) {
			issues.push(`${label} is not a regular ${kind}`);
			return;
		}
		if (process.platform !== 'win32') {
			if ((info.mode & 0o077) !== 0) issues.push(`${label} is accessible by other users`);
			if (process.getuid && info.uid !== process.getuid()) {
				issues.push(`${label} is not owned by the current user`);
			}
		}
	} catch {
		issues.push(`${label} is unavailable`);
	}
}

function clientOptions(dataDirectory: string): ConnectRuntimeClientOptions {
	return {
		dataDirectory,
		clientName: 'oteluxctl',
		clientVersion: __OTELUX_CLI_VERSION__,
		expectedRuntimeVersion: __OTELUX_CLI_VERSION__,
	};
}

function startDaemon(dataDirectory: string): void {
	const require = createRequire(import.meta.url);
	const entry = require.resolve('@otelux/local-runtime');
	const daemon = join(dirname(entry), 'daemon.js');
	const child = spawn(process.execPath, [daemon], {
		detached: true,
		stdio: 'ignore',
		env: {
			...process.env,
			OTELUX_DATA_DIR: dataDirectory,
			OTELUX_RUNTIME_VERSION: __OTELUX_CLI_VERSION__,
		},
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
	return 'Usage: oteluxctl <command> [--json]\n\nCommands:\n  start      Start or reuse the local runtime\n  stop       Stop the local runtime\n  restart    Restart the local runtime\n  status     Show runtime, settings, and storage status\n  endpoints  Show local OTLP, MCP, and Runtime API endpoints\n  doctor     Check runtime health\n  config get [key]\n  config set <key> <value> (--dry-run | --yes)\n  agents list\n  agents inspect <agent>\n  agents show-config <agent>';
}

if (process.argv[1]?.endsWith('/otelux') || process.argv[1]?.endsWith('/index.js')) {
	process.exitCode = await runCli(process.argv.slice(2));
}
