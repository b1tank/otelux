/**
 * @otelux/mcp-server — read-only Model Context Protocol server.
 *
 * The dispatcher is transport-agnostic: an MCP "server" is just a
 * JSON-RPC handler over a {@link Transport}. Two transports ship today:
 *
 * - {@link httpRouter} returns a Hono router that can be mounted in any
 *   Hono app (typically `@otelux/receiver`'s app on `/mcp`).
 * - {@link runStdioTransport} pipes `process.stdin`/`process.stdout`
 *   through the dispatcher for spawn-on-demand clients.
 *
 * Tool surface is frozen in `docs/spec.md` § 12.3. Tools are thin
 * wrappers over `@otelux/engine` so the LM Tools in
 * `apps/vscode-extension` and the MCP tools here return identical
 * results from the same query path.
 */

export {
	createMcpServer,
	type McpServer,
	type McpServerOptions,
	type ToolHandler,
	type ToolDefinition,
} from './server.js';
export { httpRouter, type HttpRouterOptions } from './transports/http.js';
export { runStdioTransport, type StdioTransportOptions } from './transports/stdio.js';
export {
	type JsonRpcRequest,
	type JsonRpcResponse,
	type JsonRpcError,
	JSON_RPC_VERSION,
	MCP_PROTOCOL_VERSIONS,
} from './protocol.js';

export const OTELUX_MCP_SERVER_VERSION = '0.1.0' as const;
