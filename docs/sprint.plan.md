# Sprint — Runtime RPC And Event Transport Foundation

## Goal

Deliver the authenticated loopback Runtime API foundation that Desktop, the future CLI, browser workbench, and daemon client will share. Keep Desktop as the runtime owner in this sprint; expose the same owned runtime safely over validated JSON-RPC/SSE before moving ownership into `oteluxd`.

## Prioritized tasks

- [x] **T1 — Runtime JSON-RPC registry and protocol negotiation**
  - Define JSON-safe request/response/error/initialize/status DTOs and stable error codes.
  - Add bounded envelope/method-param validation and tagged-bigint wire conversion.
  - Implement protocol-major negotiation and a canonical dispatcher over `LocalRuntime`.
  - Add method registry tests for status/settings, trace/log/metric queries, sample data, and confirmation-gated clear.
- [x] **T2 — Runtime SSE event envelope and revision behavior**
  - Define validated v1 event/resync envelopes with decimal revisions and bounded signal/ID hints.
  - Add a monotonic event projector that coalesces runtime events into transport-safe invalidations without telemetry bodies or secrets.
  - Add reconnect/resync and malformed-envelope tests plus checked schemas.
- [x] **T3 — Authenticated loopback HTTP host**
  - Create a separate owner-only Runtime control token.
  - Serve health, JSON-RPC, and SSE routes on loopback with body, method, content-type, Host, Origin, and bearer-token enforcement.
  - Integrate host lifecycle/status into `LocalRuntime` without making API bind failure stop OTLP/MCP/SQLite.
  - Add end-to-end HTTP authentication, RPC, SSE, overload/bounds, and shutdown tests.
- [x] **T4 — Documentation and full verification**
  - Update protocol/spec/architecture/plan/current-state docs and schemas.
  - Run lint, all tests, typecheck, full build, packaged smoke where affected, and Deskpal visible Desktop verification.

## Out of scope

- Moving runtime ownership out of Electron into `oteluxd`.
- Browser cookie/bootstrap and static workbench serving.
- CLI executable or Desktop daemon-client conversion.
- Agent configuration adapters.

## Hiccups & Notes

- Node's `fetch` normalizes the `Host` header, so the hostile-Host integration test uses `node:http` directly. Production validation was unchanged and the raw request proves the `400 invalid_host` path.
- The first Windows preview passed Runtime RPC/package smoke but NSIS still held its install directory briefly after silent uninstall, producing `EBUSY` during harness cleanup. Cleanup now uses bounded Node `rmSync` retries on Windows; product uninstall behavior and all listener shutdown assertions had already passed.
- Runtime API bind failure is intentionally nonfatal: OTLP, MCP, SQLite, and Desktop continue while `runtime.json` reports an API error. This preserves observability collection during a local control-port conflict.
- Desktop remains on validated IPC by design. The new HTTP/SSE host is exercised directly and through packaged smoke, but switching the renderer before the HTTP `DataSource` adapter/parity suite would create an incomplete client path.

## Final verification

- Biome lint: PASS (247 files).
- Workspace tests: PASS (all packages; protocol 46 tests, local-runtime 40, Desktop 35 plus 16 release-script tests).
- Workspace typecheck: PASS (18 tasks).
- Workspace build: PASS (10 packages; sandboxed preload verifier passed).
- Native x64 `.deb`/AppImage package build and unpacked packaged smoke: PASS; authenticated Runtime RPC answered status and explicit Quit stopped OTLP, MCP, and Runtime API.
- Deskpal scoped UI smoke: PASS — isolated Desktop bound OTLP `14375` and Runtime API `14376`, authenticated RPC returned sanitized API status with no token text, and a synthetic trace rendered visibly.
- Post-close probe: PASS — Runtime API unreachable and ownership files removed.
