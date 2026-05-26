/**
 * stdio transport for {@link McpServer}.
 *
 * MCP stdio transport per https://modelcontextprotocol.io/specification:
 * one JSON-RPC request per line on stdin, one response per line on
 * stdout. Lines that are not valid JSON return a `-32700 Parse error`.
 *
 * Spawn-on-demand clients (Codex CLI, Claude Code, Cursor) launch the
 * extension/desktop's `--mcp-stdio` mode and pipe through it. Tests
 * inject in-memory streams in lieu of `process.stdin/stdout`.
 */

import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { ERROR_CODES, JSON_RPC_VERSION, type JsonRpcRequest } from '../protocol.js';
import type { McpServer } from '../server.js';

interface ReadableLike {
	on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
	on(event: 'end', listener: () => void): unknown;
	[Symbol.asyncIterator]?(): AsyncIterator<unknown>;
}

interface WritableLike {
	write(chunk: string): unknown;
}

export interface StdioTransportOptions {
	readonly server: McpServer;
	readonly input?: ReadableLike;
	readonly output?: WritableLike;
}

export interface StdioRunResult {
	readonly stop: () => void;
	readonly done: Promise<void>;
}

export function runStdioTransport(options: StdioTransportOptions): StdioRunResult {
	const { server } = options;
	const input = (options.input ?? process.stdin) as ReadableLike;
	const output = (options.output ?? process.stdout) as WritableLike;

	// readline.createInterface is the simplest correct line-splitter for
	// MCP's "one message per line" convention; it also handles partial
	// reads across `data` events without us reimplementing buffering.
	const rl: ReadlineInterface = createInterface({
		input: input as NodeJS.ReadableStream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	let stopped = false;
	let done!: () => void;
	const completion = new Promise<void>((resolve) => {
		done = resolve;
	});

	const handleLine = async (line: string): Promise<void> => {
		const trimmed = line.trim();
		if (trimmed === '') {
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			emit({
				jsonrpc: JSON_RPC_VERSION,
				id: null,
				error: { code: ERROR_CODES.PARSE_ERROR, message: 'invalid JSON' },
			});
			return;
		}
		if (!isJsonRpcRequest(parsed)) {
			emit({
				jsonrpc: JSON_RPC_VERSION,
				id: null,
				error: { code: ERROR_CODES.INVALID_REQUEST, message: 'not a JSON-RPC 2.0 request' },
			});
			return;
		}
		const response = await server.handle(parsed);
		if (response !== undefined) {
			emit(response);
		}
	};

	function emit(payload: unknown): void {
		output.write(`${JSON.stringify(payload)}\n`);
	}

	rl.on('line', (line) => {
		void handleLine(line);
	});
	rl.on('close', () => {
		if (!stopped) {
			stopped = true;
			done();
		}
	});

	return {
		stop: () => {
			if (!stopped) {
				stopped = true;
				rl.close();
				done();
			}
		},
		done: completion,
	};
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const v = value as Partial<JsonRpcRequest>;
	return v.jsonrpc === JSON_RPC_VERSION && typeof v.method === 'string';
}
