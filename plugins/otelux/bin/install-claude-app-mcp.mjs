#!/usr/bin/env node

/**
 * Install the OTelux MCP bridge at a stable per-user path and register it as a
 * user-scoped Claude MCP server.
 *
 * Claude Code loads plugin-bundled MCP servers directly. Some Claude desktop
 * local-agent sessions currently load plugin skills but snapshot only app/user
 * MCP servers. Registering the same bridge at user scope makes it available to
 * new desktop sessions without duplicating any server/tool implementation.
 *
 * The bridge is copied out of the versioned plugin cache so later plugin
 * updates do not invalidate the registered command path. Re-run this installer
 * after updating the plugin to refresh the stable copy.
 */

import { spawn } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function stableBridgePath() {
	const home = homedir();
	if (process.platform === 'darwin') {
		return join(home, 'Library', 'Application Support', 'OTelux', 'plugin', 'otelux-mcp-bridge.mjs');
	}
	if (process.platform === 'win32') {
		const base = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
		return join(base, 'OTelux', 'plugin', 'otelux-mcp-bridge.mjs');
	}
	const base = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
	return join(base, 'otelux', 'plugin', 'otelux-mcp-bridge.mjs');
}

function run(command, args, { allowFailure = false } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code) => {
			if (code === 0 || allowFailure) resolve();
			else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
		});
	});
}

async function main() {
	const source = join(dirname(fileURLToPath(import.meta.url)), 'otelux-mcp-bridge.mjs');
	const target = stableBridgePath();
	await mkdir(dirname(target), { recursive: true });
	await copyFile(source, target);

	const claude = process.env.CLAUDE_BIN || 'claude';
	// Replacement is intentionally idempotent. Remove the former compatibility
	// name too so Claude presents the same `otelux` server name as Codex.
	await run(claude, ['mcp', 'remove', 'otelux-local', '--scope', 'user'], { allowFailure: true });
	await run(claude, ['mcp', 'remove', 'otelux', '--scope', 'user'], { allowFailure: true });
	await run(claude, [
		'mcp',
		'add',
		'--transport',
		'stdio',
		'--scope',
		'user',
		'otelux',
		'--',
		process.execPath,
		target,
	]);

	console.log(`\nOTelux Claude App MCP bridge installed at ${target}`);
	console.log(
		'Fully start a new Claude App session, then approve the read-only OTelux tools when prompted.',
	);
}

await main();
