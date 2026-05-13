// Smoke harness: boot engine + receiver standalone on a non-default port,
// keep alive for ~5s, then dump what landed in the engine. Useful for
// verifying scripts/send-traces.sh end-to-end without launching Electron.
//
// Run from repo root with:
//   node scripts/smoke-receiver.mjs
//
// In a second terminal during the window:
//   PORT=14318 ./scripts/send-traces.sh

import { createEngine, createMemoryStorage } from '@otelux/engine';
import { createReceiver } from '@otelux/receiver';

const PORT = Number.parseInt(process.env.PORT ?? '14318', 10);
const HOLD_MS = Number.parseInt(process.env.HOLD_MS ?? '5000', 10);

const engine = createEngine({ storage: createMemoryStorage() });
const receiver = createReceiver({ engine, port: PORT, host: '127.0.0.1' });

await receiver.start();
console.log(`[smoke] listening on http://127.0.0.1:${receiver.port}/v1/traces`);
console.log(`[smoke] window: ${HOLD_MS}ms — POST OTLP/HTTP JSON during this window.`);

await new Promise((resolve) => setTimeout(resolve, HOLD_MS));

const { rows, totalCount } = await engine.listTraces({});
console.log(`[smoke] engine has ${totalCount} trace(s):`);
for (const t of rows) {
	console.log(
		`  - ${t.traceId}  root="${t.rootName}"  spans=${t.spanCount}  services=${t.services.join(',')}`,
	);
}

await receiver.stop();
await engine.close();
process.exit(0);
