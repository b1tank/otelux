/**
 * Lifecycle wrapper for the embedded MCP HTTP server.
 *
 * Mirrors {@link ReceiverHost} so the renderer can treat MCP and OTLP
 * with the same status-dot UI. Bind failures (EADDRINUSE on the chosen
 * MCP port) become `{ kind: 'error', ... }` status rather than thrown
 * exceptions so the rest of the app stays usable.
 *
 * Why a separate HTTP listener (not multiplexed on the OTLP port)?
 * - The MCP HTTP transport speaks JSON-RPC at `POST /`, while OTLP
 *   speaks `POST /v1/traces`. Co-hosting would tangle two routers that
 *   evolve independently (OTLP gains protobuf in Phase 5; MCP gains
 *   SSE later) and conflate two security boundaries.
 * - Users may want to disable MCP without losing OTLP ingest, which is
 *   trivial when the two are separate processes-of-control.
 */

import { type ServerType, serve } from '@hono/node-server';
import type { Engine } from '@otelux/engine';
import { createMcpServer, httpRouter } from '@otelux/mcp-server';
import type { McpStatus } from '../shared/ipc.js';

export class McpHost {
	private server: ServerType | undefined;
	private currentStatus: McpStatus = { kind: 'disabled' };
	private readonly listeners = new Set<(status: McpStatus) => void>();

	constructor(
		private readonly engine: Engine,
		private readonly host: string,
		private readonly maxBodyBytes?: number,
		private readonly authToken?: string,
	) {}

	get status(): McpStatus {
		return this.currentStatus;
	}

	onChange(listener: (status: McpStatus) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Bind on the requested port. Tears down a previously-running server
	 * first so callers can safely use this for restarts. Returns the new
	 * status so the caller can branch on success/error without subscribing.
	 */
	async start(port: number): Promise<McpStatus> {
		await this.stop();
		this.setStatus({ kind: 'starting' });
		try {
			const mcp = createMcpServer({ engine: this.engine });
			const router = httpRouter({
				server: mcp,
				...(this.maxBodyBytes !== undefined ? { maxBodyBytes: this.maxBodyBytes } : {}),
				...(this.authToken !== undefined ? { authToken: this.authToken } : {}),
			});
			// @hono/node-server reports bind errors via the http server's
			// `error` event. Without an explicit listener those would bubble
			// up unhandled; wrap in a Promise so we can settle on either
			// `listening` (success) or `error` (EADDRINUSE / EACCES).
			const s = await new Promise<ServerType>((resolve, reject) => {
				const created = serve({ fetch: router.fetch, port, hostname: this.host }, () => {
					created.off('error', onError);
					resolve(created);
				});
				const onError = (err: Error): void => {
					created.off('error', onError);
					reject(err);
				};
				created.once('error', onError);
			});
			this.server = s;
			this.setStatus({ kind: 'running', port, host: this.host });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.setStatus({ kind: 'error', port, host: this.host, message });
		}
		return this.currentStatus;
	}

	async stop(): Promise<void> {
		const s = this.server;
		this.server = undefined;
		if (!s) {
			return;
		}
		await new Promise<void>((resolve, reject) => {
			s.close((err) => (err ? reject(err) : resolve()));
		});
	}

	/**
	 * Switch into `disabled` state (no listener, no error). Used when
	 * the user turns the MCP toggle off in Settings.
	 */
	async disable(): Promise<void> {
		await this.stop();
		this.setStatus({ kind: 'disabled' });
	}

	private setStatus(status: McpStatus): void {
		this.currentStatus = status;
		for (const listener of this.listeners) {
			listener(status);
		}
	}
}
