# Sprint — HTTP DataSource And Daemon Foundation

## Goal

Make the authenticated Runtime API usable by real clients and prove one query contract across direct and HTTP transports. Add a standalone foreground `oteluxd` owner without switching Desktop ownership yet; this creates the executable daemon foundation while preserving current packaged behavior.

## Prioritized tasks

- [x] **T1 — Browser-safe HTTP/SSE Runtime client**
  - Add `@otelux/adapter-http` with protocol initialization, tagged-bigint JSON-RPC, deterministic errors, and the complete current `DataSource` query surface.
  - Implement one authenticated fetch-based SSE connection shared by subscribers, revision tracking, reconnect/resync, abort/disposal, and signal-to-`ChangeEvent` projection without tokens in URLs.
  - Expose status/settings/sample/clear control methods needed by future CLI/Desktop clients.
- [x] **T2 — Direct/HTTP parity and failure tests**
  - Run identical bounded trace/log/metric/facet/waterfall/span queries against one real SQLite-backed runtime through direct calls and the HTTP adapter.
  - Verify bigint fidelity, auth failure, protocol negotiation, runtime errors, SSE invalidation, reconnect, and disposal.
- [x] **T3 — Standalone `oteluxd` foreground owner**
  - Add a Node daemon app that starts/discovers one runtime, reports endpoints without secrets, handles SIGINT/SIGTERM once, and exits deterministically on ownership conflict/startup/shutdown failure.
  - Add process-level lifecycle tests proving runtime state publication, authenticated RPC, second-owner rejection, and complete listener/state cleanup.
  - Keep Desktop embedded for now; daemon and Desktop must never own the same data directory concurrently.
- [x] **T4 — Documentation and full verification**
  - Update architecture/protocol/spec/plan/onboarding/test documentation.
  - Run lint, all tests, typecheck, full build, daemon process smoke, packaged Desktop smoke, and Deskpal visible verification.

## Out of scope

- Converting Desktop renderer from IPC to HTTP in this sprint.
- Background service registration or installer bundling for `oteluxd`.
- Browser cookie/bootstrap and runtime-served static workbench.
- CLI command parser and agent integration adapters.

## Hiccups & Notes

- Adding a workspace caused npm to re-resolve unrelated optional tooling (including Lightning CSS). The lockfile was reconstructed from the prior lock plus only the generated `@otelux/adapter-http` workspace subtree, then `npm ci --dry-run` verified consistency.
- Adapter integration/parity tests need a real `LocalRuntime`; keeping them in `@otelux/local-runtime` avoids a runtime↔adapter dependency cycle. The adapter's package-local Vitest command therefore explicitly permits no local files while the workspace parity suite provides its substantive coverage.
- The first daemon bundle had two shebangs because both source and tsup banner supplied one. The banner was removed; process tests now execute the actual built `dist/daemon.js` and assert its lifecycle.
- The first public CI run added enough concurrent SQLite parity load that the existing 4,000-write size-retention test exceeded Vitest's generic 5-second default by a small margin. Its explicit timeout is now 15 seconds; assertions/workload are unchanged, and local execution still completes well below the bound.
- CodeQL conservatively flagged trailing-slash normalization (`/\\/+$/`) on caller-provided base URLs as a polynomial-regex risk. It was replaced with a bounded-character loop; behavior is unchanged and the high-severity PR gate is satisfied.

## Final verification

- Biome lint: PASS (254 files).
- Workspace tests: PASS (20 tasks; local-runtime 44 Vitest tests plus 2 built-daemon process tests; protocol 46; Desktop 35 plus 16 release-script tests).
- Workspace typecheck: PASS (20 tasks).
- Workspace build: PASS (11 packages, including browser-safe ESM/CJS HTTP adapter and daemon entry; sandboxed preload verifier passed).
- `npm ci --dry-run`: PASS with the minimal workspace lock update.
- Native x64 `.deb`/AppImage build and packaged Desktop smoke: PASS; authenticated RPC and all listener shutdown checks passed.
- Foreground daemon process smoke: PASS — state/RPC published, second owner exited `2`, SIGTERM exited `0`, listeners and ownership state removed, invalid env exited `1`.
- Deskpal scoped UI smoke: PASS — isolated Desktop rendered one synthetic trace while authenticated HTTP RPC returned the same trace count and tagged bigint timestamp.
