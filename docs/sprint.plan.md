# Sprint — Runtime Contract Hardening

## Goal

Create the runtime-validated, JSON-safe contract foundation required before extracting the per-user daemon or adding CLI/agent-onboarding clients. This sprint does not start a second runtime process; it hardens the current Electron/runtime boundary first so the later daemon transport reuses proven DTOs and validators.

## Prioritized tasks

- [x] **T1 — Shared validation primitives and Electron IPC enforcement**
  - Add bounded, path-aware runtime decoders for every current query and settings patch.
  - Move the invoke-message union into `@otelux/protocol` and validate unknown renderer input before dispatch.
  - Validate runtime push events in preload before they enter the renderer.
  - Return stable validation errors without stack traces or SQL details.
- [x] **T2 — JSON-safe wire codec and compatibility fixtures**
  - Add recursive tagged-bigint JSON encoding/decoding, finite-number enforcement, depth/node/string limits, and malformed-input tests.
  - Add old/current/compatible-future fixtures proving unknown ordinary object fields are tolerated while malformed tags and unsupported discriminators fail.
- [x] **T3 — Runtime state decoder and checked-in schemas**
  - Move `runtime.json` validation to the shared protocol package.
  - Check in draft 2020-12 schemas for runtime state, invoke requests, runtime events, and tagged bigint values with stable OTelux schema IDs.
  - Add snapshot/fixture tests so schema and decoder changes are reviewed together.
- [x] **T4 — Documentation and full build verification**
  - Update protocol/spec/architecture/current-gap material to distinguish delivered validation from the still-planned daemon RPC registry.
  - Run edited-file formatting, package/full tests, typecheck, and the complete workspace build.

## Out of scope

- Starting `oteluxd` or changing Desktop runtime ownership.
- Runtime HTTP JSON-RPC/SSE transport.
- CLI commands or agent configuration mutations.
- Storage query-plan budgets, which remain the next independent hardening sprint.

## Hiccups & Notes

- Importing `@otelux/protocol` at runtime from Electron's sandboxed preload caused the preload verifier to reject an external `require()`. Runtime events are instead decoded once in Electron main immediately before broadcast; the preload remains dependency-free and sandbox-compatible while the renderer still receives only validated events.
- Protocol tests read checked-in JSON fixtures, so `@types/node` was added as an explicit protocol development dependency. The lockfile was updated narrowly rather than accepting npm's unrelated lock normalization.
- Generated JSON Schema snapshots use deterministic two-space JSON and are excluded from Biome reformatting; `schema:check` byte-compares them against the generator in every protocol test run.

## Final verification

- Biome lint: PASS (237 files).
- Workspace tests: PASS (all 10 packages; protocol 37 tests, local-runtime 28, Desktop 35 plus 16 release-script tests).
- Workspace typecheck: PASS (18 tasks).
- Workspace build: PASS (10 packages; sandboxed preload verifier passed).
- Deskpal scoped UI smoke: PASS — clean isolated Desktop received the synthetic trace and visibly rendered one `GET /api/users` trace with three spans.
