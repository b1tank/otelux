/**
 * Transport-agnostic MCP dispatcher.
 *
 * Owns the method registry (`initialize`, `tools/list`, `tools/call`)
 * and the tool registry. Transports (HTTP, stdio) just hand it raw
 * JSON-RPC requests and forward the responses.
 */

import type { Engine } from '@otelux/engine';
import {
	ERROR_CODES,
	JSON_RPC_VERSION,
	type JsonRpcError,
	type JsonRpcRequest,
	type JsonRpcResponse,
	MCP_PROTOCOL_VERSIONS,
} from './protocol.js';
import { defaultTools } from './tools/index.js';

/**
 * Implementation of a single MCP tool. `inputSchema` is sent verbatim
 * to clients during `tools/list` so they can drive a UI / completion;
 * `handler` receives the (already-validated against the schema) input
 * and returns whatever JSON-serializable value the spec calls for.
 *
 * Tools are passed an {@link McpToolContext} rather than the raw engine
 * so we can later layer auth, rate-limiting, or read-only enforcement
 * here without touching every handler.
 */
export type ToolHandler<TInput = unknown, TResult = unknown> = (
	input: TInput,
	context: McpToolContext,
) => Promise<TResult> | TResult;

export interface ToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: Record<string, unknown>;
	readonly handler: ToolHandler;
	/**
	 * When true, the tool is advertised but not yet functional: its schema
	 * is stable for early client integration, but calls return
	 * `supported: false`. Surfaced in `tools/list` so clients can filter or
	 * label it rather than discovering the gap only after a call.
	 */
	readonly experimental?: boolean;
}

export interface McpToolContext {
	readonly engine: Engine;
}

export interface McpServerOptions {
	readonly engine: Engine;
	/**
	 * Optional override of the bundled tool registry. Defaults to the
	 * 7 read-only tools frozen in `docs/spec.md` § 12.3. Tests pass a
	 * narrower list; downstream callers can register extra tools by
	 * concatenating `defaultTools` with their own.
	 */
	readonly tools?: readonly ToolDefinition[];
	/**
	 * Server identity reported to clients via `initialize`. The default
	 * matches the package name + version so logs/telemetry on the client
	 * side can identify OTelux unambiguously.
	 */
	readonly serverInfo?: { readonly name: string; readonly version: string };
}

export interface McpServer {
	readonly serverInfo: { readonly name: string; readonly version: string };
	readonly tools: readonly ToolDefinition[];
	handle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined>;
}

const DEFAULT_SERVER_INFO = { name: '@otelux/mcp-server', version: '0.1.0' } as const;

export function createMcpServer(options: McpServerOptions): McpServer {
	const tools = options.tools ?? defaultTools;
	const toolByName = new Map(tools.map((t) => [t.name, t] as const));
	const context: McpToolContext = { engine: options.engine };
	const serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;

	async function handle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
		// Notifications (no `id`) get no reply per JSON-RPC 2.0. We still
		// execute them — MCP uses `notifications/initialized` and similar
		// — but the transport must not write anything back.
		const id = request.id ?? null;
		const isNotification = request.id === undefined || request.id === null;

		try {
			switch (request.method) {
				case 'initialize':
					return ok(id, initialize(request.params, serverInfo, tools));
				case 'notifications/initialized':
					return undefined;
				case 'tools/list':
					return ok(id, { tools: tools.map(publicToolDescriptor) });
				case 'tools/call':
					return ok(id, await callTool(request.params, toolByName, context));
				case 'ping':
					return ok(id, {});
				default: {
					if (isNotification) {
						return undefined;
					}
					return err(id, ERROR_CODES.METHOD_NOT_FOUND, `method not found: ${request.method}`);
				}
			}
		} catch (e) {
			if (isNotification) {
				return undefined;
			}
			const message = e instanceof Error ? e.message : String(e);
			return err(id, ERROR_CODES.INTERNAL_ERROR, message);
		}
	}

	return { serverInfo, tools, handle };
}

interface InitializeParams {
	readonly protocolVersion?: string;
	readonly clientInfo?: { readonly name?: string; readonly version?: string };
}

function initialize(
	params: unknown,
	serverInfo: { name: string; version: string },
	tools: readonly ToolDefinition[],
): unknown {
	const p = (params ?? {}) as InitializeParams;
	// Echo the newest version we both support. If the client sent
	// something we do not recognize, fall back to our newest — clients
	// are required to handle that.
	const negotiated =
		p.protocolVersion && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(p.protocolVersion)
			? p.protocolVersion
			: MCP_PROTOCOL_VERSIONS[0];
	const experimentalCount = tools.filter((t) => t.experimental).length;
	return {
		protocolVersion: negotiated,
		serverInfo,
		// MCP 2025-06-18 `capabilities` shape. We declare tools support
		// only; resources and prompts are not part of OTelux's surface.
		capabilities: {
			tools: { listChanged: false },
		},
		// `instructions` is optional in the spec but useful as a hint to
		// LLMs about how to use this server.
		instructions: `OTelux exposes ${tools.length} read-only tools that query a local OpenTelemetry store. All tools are safe to call without confirmation; none mutate data.${
			experimentalCount > 0
				? ` ${experimentalCount} of them are experimental and return \`supported: false\` until implemented.`
				: ''
		}`,
	};
}

interface ToolsCallParams {
	readonly name?: string;
	readonly arguments?: unknown;
}

async function callTool(
	params: unknown,
	registry: ReadonlyMap<string, ToolDefinition>,
	context: McpToolContext,
): Promise<unknown> {
	const p = (params ?? {}) as ToolsCallParams;
	if (!p.name) {
		throw new Error('tools/call: missing `name`');
	}
	const tool = registry.get(p.name);
	if (!tool) {
		throw new Error(`tools/call: unknown tool ${p.name}`);
	}
	const result = await tool.handler(p.arguments ?? {}, context);
	// MCP returns tool output as `content` blocks. We always emit a single
	// text block carrying the JSON payload — that's the format clients
	// (Copilot, Codex, Claude) parse most reliably.
	return {
		content: [
			{
				type: 'text',
				text: JSON.stringify(result, replacer),
			},
		],
		isError: false,
	};
}

function publicToolDescriptor(t: ToolDefinition): Omit<ToolDefinition, 'handler'> {
	return {
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema,
		...(t.experimental ? { experimental: true } : {}),
	};
}

function ok(id: number | string | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: JSON_RPC_VERSION, id, result };
}

function err(id: number | string | null, code: number, message: string): JsonRpcError {
	return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message } };
}

/**
 * JSON.stringify replacer that downgrades bigint → string. Engine query
 * results contain `bigint` nanosecond timestamps; JSON.stringify would
 * otherwise throw `TypeError: Do not know how to serialize a BigInt`.
 * Strings round-trip cleanly because every consumer (LM Tools, Codex,
 * Claude) parses them numerically when needed.
 */
function replacer(_key: string, value: unknown): unknown {
	return typeof value === 'bigint' ? value.toString() : value;
}
