/**
 * OTLP/HTTP and OTLP/gRPC receiver. The OTel-side ingress for OTelux.
 *
 * Phase 0 ships only the public type surface. Real Hono HTTP server,
 * gRPC server, and OTLP decoders land in Phase 1.
 */

import type { Engine } from '@otelux/engine';

export interface ReceiverOptions {
	engine: Engine;
	/** Port to bind. OTLP/HTTP default is 4318. */
	port?: number;
}

export interface Receiver {
	readonly port: number;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export function createReceiver(options: ReceiverOptions): Receiver {
	const port = options.port ?? 4318;
	return {
		port,
		async start(): Promise<void> {
			// Phase 0 stub.
		},
		async stop(): Promise<void> {
			// Phase 0 stub.
		},
	};
}

export const OTELUX_RECEIVER_VERSION = '0.0.0' as const;
