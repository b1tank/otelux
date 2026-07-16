#!/usr/bin/env node

/**
 * OTelux plugin bridge: MCP stdio <-> authenticated desktop MCP HTTP.
 *
 * Claude Code and Codex spawn plugin MCP servers over stdio, while the OTelux
 * desktop app owns the live engine/SQLite store and exposes it over loopback
 * HTTP with a per-install bearer token. This bridge connects those two worlds:
 * one JSON-RPC message per stdin line is forwarded to the desktop listener and
 * the response is written as one JSON line on stdout.
 *
 * Discovery order:
 *   1. OTELUX_MCP_URL / OTELUX_MCP_TOKEN / OTELUX_MCP_TOKEN_FILE overrides.
 *   2. OTELUX_USER_DATA_DIR override.
 *   3. Platform user-data candidates (packaged OTelux first).
 *
 * stdout is reserved for MCP protocol messages. Diagnostics go to stderr.
 */

import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const JSON_RPC_VERSION = '2.0';
const INTERNAL_ERROR = -32603;
const INVALID_REQUEST = -32600;
const PARSE_ERROR = -32700;

function platformUserDataCandidates() {
	const override = process.env.OTELUX_USER_DATA_DIR;
	if (override) return [override];

	const home = homedir();
	if (process.platform === 'darwin') {
		const base = join(home, 'Library', 'Application Support');
		return [join(base, 'OTelux'), join(base, 'otelux'), join(base, '@otelux', 'desktop')];
	}
	if (process.platform === 'win32') {
		const base = process.env.APPDATA || join(home, 'AppData', 'Roaming');
		return [join(base, 'OTelux'), join(base, 'otelux'), join(base, '@otelux', 'desktop')];
	}

	const base = process.env.XDG_CONFIG_HOME || join(home, '.config');
	return [join(base, 'OTelux'), join(base, 'otelux'), join(base, '@otelux', 'desktop')];
}

async function firstReadableFile(paths) {
	for (const path of paths) {
		try {
			await access(path, fsConstants.R_OK);
			return path;
		} catch {
			// Try the next platform candidate.
		}
	}
	return undefined;
}

async function readSettings(userDataDirs) {
	const settingsPath = await firstReadableFile(
		userDataDirs.map((dir) => join(dir, 'settings.json')),
	);
	if (!settingsPath) return {};
	try {
		return JSON.parse(await readFile(settingsPath, 'utf8'));
	} catch (error) {
		throw new Error(`Could not parse OTelux settings at ${settingsPath}: ${error.message}`);
	}
}

async function discoverConnection() {
	const userDataDirs = platformUserDataCandidates();
	const settings = await readSettings(userDataDirs);
	const configuredPort = settings?.mcp?.port;
	const url = process.env.OTELUX_MCP_URL || `http://127.0.0.1:${configuredPort ?? 4320}/`;

	if (settings?.mcp?.enabled === false && !process.env.OTELUX_MCP_URL) {
		throw new Error(
			'OTelux MCP is disabled. Enable it in OTelux Settings, then restart this session.',
		);
	}

	let token = process.env.OTELUX_MCP_TOKEN;
	let tokenFile = process.env.OTELUX_MCP_TOKEN_FILE;
	if (!token && !tokenFile) {
		tokenFile = await firstReadableFile(userDataDirs.map((dir) => join(dir, 'mcp-token')));
	}
	if (!token && tokenFile) {
		token = (await readFile(tokenFile, 'utf8')).trim();
	}
	if (!token) {
		throw new Error(
			`Could not find the OTelux MCP token. Start OTelux once, or set OTELUX_USER_DATA_DIR / OTELUX_MCP_TOKEN_FILE. Checked: ${userDataDirs.join(', ')}`,
		);
	}

	return { url, token };
}

function emit(payload) {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function errorResponse(id, code, message) {
	return { jsonrpc: JSON_RPC_VERSION, id: id ?? null, error: { code, message } };
}

async function forward(line, connection) {
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		emit(errorResponse(null, PARSE_ERROR, 'invalid JSON'));
		return;
	}
	if (!request || request.jsonrpc !== JSON_RPC_VERSION || typeof request.method !== 'string') {
		emit(errorResponse(request?.id, INVALID_REQUEST, 'not a JSON-RPC 2.0 request'));
		return;
	}

	try {
		const response = await fetch(connection.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${connection.token}`,
			},
			body: JSON.stringify(request),
		});

		if (response.status === 204) return;
		const text = await response.text();
		if (!response.ok) {
			let detail = text;
			try {
				detail = JSON.parse(text)?.error?.message || JSON.parse(text)?.error || text;
			} catch {
				// Keep raw response text.
			}
			emit(errorResponse(request.id, INTERNAL_ERROR, `OTelux MCP HTTP ${response.status}: ${detail}`));
			return;
		}
		emit(JSON.parse(text));
	} catch (error) {
		emit(
			errorResponse(
				request.id,
				INTERNAL_ERROR,
				`Cannot reach OTelux MCP at ${connection.url}. Start the OTelux desktop app and enable MCP. ${error.message}`,
			),
		);
	}
}

async function main() {
	let connection;
	try {
		connection = await discoverConnection();
	} catch (error) {
		console.error(`[otelux-plugin] ${error.message}`);
		process.exitCode = 1;
		return;
	}

	const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
	// Preserve request/response order even if a client sends multiple lines quickly.
	let queue = Promise.resolve();
	for await (const line of input) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		queue = queue.then(() => forward(trimmed, connection));
	}
	await queue;
}

await main();
