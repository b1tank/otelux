#!/usr/bin/env node
import { RuntimeAlreadyRunningError, createLocalRuntime } from './runtime.js';

export interface DaemonEnvironment {
	readonly OTELUX_DATA_DIR?: string;
	readonly OTELUX_OTLP_PORT?: string;
	readonly OTELUX_API_PORT?: string;
	readonly OTELUX_OTLP_MAX_BODY_BYTES?: string;
	readonly OTELUX_MCP_MAX_BODY_BYTES?: string;
	readonly OTELUX_API_MAX_BODY_BYTES?: string;
	readonly OTELUX_RUNTIME_VERSION?: string;
}

export async function runDaemon(
	environment: DaemonEnvironment = process.env,
	output: Pick<Console, 'log' | 'error'> = console,
): Promise<number> {
	try {
		const runtime = await createLocalRuntime({
			...(environment.OTELUX_DATA_DIR ? { dataDirectory: environment.OTELUX_DATA_DIR } : {}),
			...optionalRuntimeVersion(environment.OTELUX_RUNTIME_VERSION),
			...optionalPort(environment.OTELUX_OTLP_PORT, 'OTELUX_OTLP_PORT', 'otlpPortOverride'),
			...optionalPort(environment.OTELUX_API_PORT, 'OTELUX_API_PORT', 'apiPortOverride'),
			...optionalPositive(
				environment.OTELUX_OTLP_MAX_BODY_BYTES,
				'OTELUX_OTLP_MAX_BODY_BYTES',
				'otlpMaxBodyBytes',
			),
			...optionalPositive(
				environment.OTELUX_MCP_MAX_BODY_BYTES,
				'OTELUX_MCP_MAX_BODY_BYTES',
				'mcpMaxBodyBytes',
			),
			...optionalPositive(
				environment.OTELUX_API_MAX_BODY_BYTES,
				'OTELUX_API_MAX_BODY_BYTES',
				'apiMaxBodyBytes',
			),
			logger: {
				info: (message) => {
					if (!message.includes('token is stored') && !message.includes('read it from')) {
						output.log(message);
					}
				},
				error: (message) => output.error(message),
			},
		});
		const state = runtime.getRuntimeState();
		output.log(
			JSON.stringify({
				event: 'ready',
				pid: state.pid,
				runtimeVersion: state.runtimeVersion,
				protocolVersion: state.protocolVersion,
				dataDirectory: state.dataDirectory,
				databasePath: state.databasePath,
				receiver: state.receiver,
				mcp: state.mcp,
				api: state.api,
			}),
		);
		await waitForShutdownSignal();
		try {
			await runtime.close();
			output.log(JSON.stringify({ event: 'stopped' }));
			return 0;
		} catch (error) {
			output.error(
				JSON.stringify({
					event: 'shutdown-error',
					message: error instanceof Error ? error.message : String(error),
				}),
			);
			return 3;
		}
	} catch (error) {
		if (error instanceof RuntimeAlreadyRunningError) {
			output.error(
				JSON.stringify({
					event: 'already-running',
					...(error.owner ? { pid: error.owner.pid, instanceId: error.owner.instanceId } : {}),
					...(error.state
						? {
								dataDirectory: error.state.dataDirectory,
								receiver: error.state.receiver,
								mcp: error.state.mcp,
								api: error.state.api,
							}
						: {}),
				}),
			);
			return 2;
		}
		output.error(
			JSON.stringify({
				event: 'startup-error',
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return 1;
	}
}

function optionalRuntimeVersion(value: string | undefined): { runtimeVersion?: string } {
	if (value === undefined || value === '') return {};
	if (value.length > 64 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
		throw new Error('OTELUX_RUNTIME_VERSION must be a semantic version');
	}
	return { runtimeVersion: value };
}

function optionalPort<K extends 'otlpPortOverride' | 'apiPortOverride'>(
	value: string | undefined,
	name: string,
	key: K,
): Partial<Record<K, number>> {
	if (value === undefined || value === '') return {};
	if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer between 0 and 65535`);
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
		throw new Error(`${name} must be an integer between 0 and 65535`);
	}
	return { [key]: parsed } as Record<K, number>;
}

function optionalPositive<K extends 'otlpMaxBodyBytes' | 'mcpMaxBodyBytes' | 'apiMaxBodyBytes'>(
	value: string | undefined,
	name: string,
	key: K,
): Partial<Record<K, number>> {
	if (value === undefined || value === '') return {};
	if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a positive safe integer`);
	return { [key]: parsed } as Record<K, number>;
}

async function waitForShutdownSignal(): Promise<void> {
	await new Promise<void>((resolve) => {
		let handled = false;
		const finish = (): void => {
			if (handled) return;
			handled = true;
			process.off('SIGINT', finish);
			process.off('SIGTERM', finish);
			resolve();
		};
		process.on('SIGINT', finish);
		process.on('SIGTERM', finish);
	});
}

if (process.argv[1]?.endsWith('daemon.js')) {
	process.exitCode = await runDaemon();
}
