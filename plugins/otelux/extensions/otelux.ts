import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

type JsonObject = Record<string, unknown>;

type McpTool = {
	name: string;
	description: string;
	inputSchema: JsonObject;
};

type McpContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType?: string };

type McpToolResult = {
	content?: McpContent[];
	isError?: boolean;
	[key: string]: unknown;
};

type PendingRequest = {
	resolve: (value: JsonObject) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_BRIDGE = fileURLToPath(new URL('../bin/otelux-mcp-bridge.mjs', import.meta.url));

function resultText(result: McpToolResult): string {
	return (result.content ?? [])
		.filter((item): item is Extract<McpContent, { type: 'text' }> => item.type === 'text')
		.map((item) => item.text)
		.join('\n');
}

class OTeluxBridge {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, PendingRequest>();
	private stdoutBuffer = '';
	private stdoutBytes = 0;
	private nextId = 1;
	private stderrTail = '';
	private stopped = false;

	private constructor(child: ChildProcessWithoutNullStreams) {
		this.child = child;
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
		child.stderr.on('data', (chunk: string) => {
			this.stderrTail = (this.stderrTail + chunk).slice(-4096);
		});
		child.once('exit', (code, signal) => {
			this.stopped = true;
			const detail = this.stderrTail.trim();
			this.rejectAll(
				new Error(
					`OTelux bridge exited (${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`})${detail ? `: ${detail}` : ''}`,
				),
			);
		});
	}

	static async start(bridgePath: string): Promise<OTeluxBridge> {
		await access(bridgePath);
		const bridge = new OTeluxBridge(
			spawn(process.execPath, [bridgePath], { stdio: ['pipe', 'pipe', 'pipe'] }),
		);
		await bridge.request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'otelux-pi', version: '0.1.0' },
		});
		bridge.notify('notifications/initialized', {});
		return bridge;
	}

	get running(): boolean {
		return !this.stopped && this.child.exitCode === null;
	}

	async listTools(): Promise<McpTool[]> {
		const response = await this.request('tools/list', {});
		return (response.tools ?? []) as McpTool[];
	}

	async callTool(name: string, args: JsonObject): Promise<McpToolResult> {
		return (await this.request('tools/call', { name, arguments: args })) as McpToolResult;
	}

	async stop(): Promise<void> {
		if (this.stopped) return;
		this.stopped = true;
		this.child.stdin.end();
		await new Promise<void>((resolve) => {
			if (this.child.exitCode !== null) return resolve();
			const timer = setTimeout(() => {
				this.child.kill('SIGTERM');
				resolve();
			}, 500);
			this.child.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
		});
		this.rejectAll(new Error('OTelux session stopped'));
	}

	private notify(method: string, params: JsonObject): void {
		this.write({ jsonrpc: '2.0', method, params });
	}

	private request(method: string, params: JsonObject): Promise<JsonObject> {
		if (!this.running) return Promise.reject(new Error('OTelux bridge is not running'));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`OTelux request timed out: ${method}`));
			}, DEFAULT_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			this.write({ jsonrpc: '2.0', id, method, params });
		});
	}

	private write(message: JsonObject): void {
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private handleStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		this.stdoutBytes += Buffer.byteLength(chunk, 'utf8');
		let newline = this.stdoutBuffer.indexOf('\n');
		while (newline !== -1) {
			const line = this.stdoutBuffer.slice(0, newline);
			this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
			this.stdoutBytes = Buffer.byteLength(this.stdoutBuffer, 'utf8');
			this.handleLine(line);
			newline = this.stdoutBuffer.indexOf('\n');
		}
		if (this.stdoutBytes > MAX_RESPONSE_BYTES) {
			this.rejectAll(new Error('OTelux response exceeded 16 MiB without a delimiter'));
			this.child.kill('SIGTERM');
		}
	}

	private handleLine(line: string): void {
		let response: JsonObject;
		try {
			response = JSON.parse(line) as JsonObject;
		} catch {
			this.rejectAll(new Error(`OTelux emitted non-JSON stdout: ${line.slice(0, 200)}`));
			this.child.kill('SIGTERM');
			return;
		}
		if (typeof response.id !== 'number') return;
		const pending = this.pending.get(response.id);
		if (!pending) return;
		this.pending.delete(response.id);
		clearTimeout(pending.timer);
		const rpcError = response.error as { message?: string } | undefined;
		if (rpcError) pending.reject(new Error(rpcError.message ?? 'OTelux JSON-RPC error'));
		else pending.resolve((response.result ?? {}) as JsonObject);
	}

	private rejectAll(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

export default function oteluxExtension(pi: ExtensionAPI) {
	const bridgePath = process.env.OTELUX_PI_BRIDGE || DEFAULT_BRIDGE;
	const registered = new Set<string>();
	let bridge: OTeluxBridge | undefined;

	const ensureBridge = async (): Promise<OTeluxBridge> => {
		if (bridge?.running) return bridge;
		bridge = await OTeluxBridge.start(bridgePath);
		return bridge;
	};

	const registerTools = async (): Promise<number> => {
		const server = await ensureBridge();
		const tools = await server.listTools();
		for (const tool of tools) {
			if (registered.has(tool.name)) continue;
			registered.add(tool.name);
			pi.registerTool({
				name: tool.name,
				label: tool.name.replaceAll('_', ' '),
				description: tool.description,
				parameters: tool.inputSchema as never,
				async execute(_toolCallId, params) {
					const result = await (await ensureBridge()).callTool(tool.name, params as JsonObject);
					if (result.isError) throw new Error(resultText(result) || `${tool.name} failed`);
					const content = (result.content ?? []).map((item) =>
						item.type === 'image'
							? { type: 'image' as const, data: item.data, mimeType: item.mimeType ?? 'image/png' }
							: { type: 'text' as const, text: item.text },
					);
					return { content, details: { oteluxTool: tool.name } };
				},
			});
		}
		return tools.length;
	};

	pi.on('session_start', async (_event, ctx) => {
		try {
			const count = await registerTools();
			ctx.ui.setStatus('otelux', `otelux: ${count} tools`);
		} catch (error) {
			ctx.ui.setStatus('otelux', 'otelux: unavailable');
			ctx.ui.notify(error instanceof Error ? error.message : String(error), 'warning');
		}
	});

	pi.on('session_shutdown', async () => {
		await bridge?.stop();
		bridge = undefined;
	});

	pi.registerCommand('otelux-status', {
		description: 'Show OTelux Pi extension status',
		handler: async (_args, ctx) => {
			try {
				const count = await registerTools();
				ctx.ui.notify(`OTelux is running with ${count} MCP tools registered.`, 'info');
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
			}
		},
	});
}
