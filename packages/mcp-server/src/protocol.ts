/**
 * Minimal JSON-RPC 2.0 shapes used by MCP.
 *
 * MCP layers a small protocol on top of JSON-RPC 2.0:
 * https://modelcontextprotocol.io/specification — `initialize`,
 * `tools/list`, `tools/call`, `notifications/initialized`, etc. We do
 * not need every method to be a useful subset for OTelux; the dispatcher
 * returns the standard `-32601 Method not found` for anything we have
 * not implemented.
 */

export const JSON_RPC_VERSION = '2.0' as const;

/**
 * MCP protocol revisions this server speaks. Returned (newest match)
 * from `initialize` so clients can negotiate. The list is ordered
 * newest first; the dispatcher picks the first one that also appears in
 * the client's `protocolVersion`.
 */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface JsonRpcRequest {
	readonly jsonrpc: typeof JSON_RPC_VERSION;
	readonly id?: number | string | null;
	readonly method: string;
	readonly params?: unknown;
}

export interface JsonRpcSuccess {
	readonly jsonrpc: typeof JSON_RPC_VERSION;
	readonly id: number | string | null;
	readonly result: unknown;
}

export interface JsonRpcError {
	readonly jsonrpc: typeof JSON_RPC_VERSION;
	readonly id: number | string | null;
	readonly error: {
		readonly code: number;
		readonly message: string;
		readonly data?: unknown;
	};
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/**
 * Standard JSON-RPC 2.0 error codes plus a handful of MCP extensions.
 * Keeping these as a const enum-equivalent avoids drift between the
 * dispatcher and tests.
 */
export const ERROR_CODES = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
} as const;
