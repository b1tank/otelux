# Sprint — Runtime Boundary Hardening

## Goal

Resolve the confirmed stop-now resource, confused-deputy, retry, and multi-client mutation blockers before Desktop daemon-client conversion.

## Tasks

- [x] **T1 — Server output, batch, and SSE backpressure bounds**
  - Cap aggregate wire strings and encoded RPC responses at 2 MiB.
  - Reduce batches to 10 and execute calls sequentially so batching cannot multiply concurrency.
  - Return a deterministic response-too-large error and disconnect slow SSE clients for resync.
  - Isolate projector listener failures.
- [x] **T2 — HTTP client trust, deadlines, and retry lifecycle**
  - Require loopback Runtime URLs, reject credentials/paths/fragments, and disable redirects.
  - Add RPC deadline, bounded streamed response reads, recoverable initialization, and observable connection failures.
  - Bound SSE buffers, clean abort listeners, delay normal EOF reconnects, and isolate subscribers.
- [x] **T3 — Serialized runtime mutations**
  - Serialize settings and clear mutations so concurrent/batched clients cannot interleave rebind/rollback/commit.
  - Add concurrency regression tests.
- [x] **T4 — Production-shaped gates and documentation**
  - Add oversized log result, batch concurrency, slow SSE, hung RPC, hostile URL, and retry tests.
  - Update canonical docs and run lint/tests/typecheck/build/package smoke.

## Hiccups & Notes

- The concurrent-mutation test initially attempted to restore persisted OTLP `4319` while using a one-shot free-port override; the production listener already owned `4319`. The test now explicitly preserves the runtime's effective port, isolating the intended mutation-order assertion.
- The first oversized-response implementation returned JSON-RPC id `null`, so a correct client rejected the envelope before seeing `-32005`. Single-call overflow now preserves the request id; batch-wide overflow remains id `null`.

## Final verification

- Added a real 3 MB ingest / 30-log HTTP fixture; list response fails deterministically with `-32005` under the 2 MiB budget.
- Protocol and local-runtime focused suites pass, including aggregate string, batch width, response size, SSE, and mutation ordering.
- HTTP adapter tests pass for hostile URLs, deadlines, oversized responses, and initialization recovery.
- Biome lint PASS (256 files); workspace tests/typecheck PASS (20 tasks); build PASS (11 packages).
- Adapter boundary tests PASS (8); local-runtime tests PASS (47 plus 2 daemon process tests); protocol tests PASS (46).
- Native x64 `.deb`/AppImage package build and packaged smoke PASS, including authenticated Runtime RPC and full three-listener shutdown.
