import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

const BRIDGE = new URL('./otelux-mcp-bridge.mjs', import.meta.url);

async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	return server.address().port;
}

function nextLine(lines) {
	return new Promise((resolve, reject) => {
		const onLine = (line) => {
			cleanup();
			resolve(line);
		};
		const onClose = () => {
			cleanup();
			reject(new Error('bridge stdout closed before a response'));
		};
		const cleanup = () => {
			lines.off('line', onLine);
			lines.off('close', onClose);
		};
		lines.once('line', onLine);
		lines.once('close', onClose);
	});
}

test('proxies authenticated MCP JSON-RPC over stdio and ignores notification responses', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'otelux-plugin-bridge-'));
	const token = 'test-token';
	await writeFile(join(dir, 'mcp-token'), `${token}\n`, { mode: 0o600 });

	const requests = [];
	const server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		requests.push({ authorization: req.headers.authorization, body });
		if (body.id === undefined) {
			res.writeHead(204).end();
			return;
		}
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(
			JSON.stringify({
				jsonrpc: '2.0',
				id: body.id,
				result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
			}),
		);
	});

	const port = await listen(server);
	const child = spawn(process.execPath, [BRIDGE.pathname], {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: {
			...process.env,
			OTELUX_USER_DATA_DIR: dir,
			OTELUX_MCP_URL: `http://127.0.0.1:${port}/`,
		},
	});
	const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });

	try {
		child.stdin.write(
			`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
		);
		const response = JSON.parse(await nextLine(lines));
		assert.equal(response.id, 1);
		assert.equal(response.result.protocolVersion, '2025-06-18');

		child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
		child.stdin.end();
		await new Promise((resolve, reject) => {
			child.once('exit', (code) =>
				code === 0 ? resolve() : reject(new Error(`bridge exit ${code}`)),
			);
		});

		assert.equal(requests.length, 2);
		assert.equal(requests[0].authorization, `Bearer ${token}`);
		assert.equal(requests[0].body.method, 'initialize');
		assert.equal(requests[1].body.method, 'notifications/initialized');
	} finally {
		child.kill('SIGKILL');
		lines.close();
		await new Promise((resolve) => server.close(resolve));
		await rm(dir, { recursive: true, force: true });
	}
});

test('returns a JSON-RPC error when the desktop MCP endpoint is unreachable', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'otelux-plugin-bridge-'));
	await writeFile(join(dir, 'mcp-token'), 'test-token\n', { mode: 0o600 });

	// Reserve and release a port so the subsequent connection is refused.
	const server = createServer();
	const port = await listen(server);
	await new Promise((resolve) => server.close(resolve));

	const child = spawn(process.execPath, [BRIDGE.pathname], {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: {
			...process.env,
			OTELUX_USER_DATA_DIR: dir,
			OTELUX_MCP_URL: `http://127.0.0.1:${port}/`,
		},
	});
	const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });

	try {
		child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })}\n`);
		const response = JSON.parse(await nextLine(lines));
		assert.equal(response.id, 7);
		assert.equal(response.error.code, -32603);
		assert.match(response.error.message, /Cannot reach OTelux MCP/);
	} finally {
		child.stdin.end();
		child.kill('SIGKILL');
		lines.close();
		await rm(dir, { recursive: true, force: true });
	}
});
