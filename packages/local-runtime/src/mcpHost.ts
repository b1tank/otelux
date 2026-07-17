import { type ServerType, serve } from '@hono/node-server';
import type { Engine } from '@otelux/engine';
import { createMcpServer, httpRouter } from '@otelux/mcp-server';
import type { McpStatus } from '@otelux/protocol';

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

	async start(port: number): Promise<McpStatus> {
		await this.stop();
		this.setStatus({ kind: 'starting' });
		try {
			const server = createMcpServer({ engine: this.engine });
			const router = httpRouter({
				server,
				...(this.maxBodyBytes !== undefined ? { maxBodyBytes: this.maxBodyBytes } : {}),
				...(this.authToken !== undefined ? { authToken: this.authToken } : {}),
			});
			const httpServer = await new Promise<ServerType>((resolve, reject) => {
				const created = serve({ fetch: router.fetch, port, hostname: this.host }, () => {
					created.off('error', onError);
					resolve(created);
				});
				const onError = (error: Error): void => {
					created.off('error', onError);
					reject(error);
				};
				created.once('error', onError);
			});
			this.server = httpServer;
			this.setStatus({ kind: 'running', port, host: this.host });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus({ kind: 'error', port, host: this.host, message });
		}
		return this.currentStatus;
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		if (!server) {
			return;
		}
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}

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
