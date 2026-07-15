# OTelux — Plan Ahead

Updated: 2026-07-13

This plan only covers work ahead of us. Completed implementation detail lives in git history and the package READMEs; this file is for deciding what to build next.

> **Active `v0.1.0` overlay:** [release-sprint.md](release-sprint.md) orders launch work and records temporary decisions and evidence. This plan remains the owner of product sequencing. Remove this note when the sprint is retired after `v0.1.0`.

See the specification's [Current Baseline](spec.md#current-baseline) for implemented capabilities and limits. The phases below contain only work that remains ahead; remove completed work as it ships.

## Phase 1 — Workbench Polish

Goal: make the current three signal views feel like a professional local debugging tool.

Tasks:

- Add detail-pane search for span and log details.
- Normalize section count badges and action menus across span and log details.
- Add metric grouping controls for Service and Type without losing the current meter-first explorer layout.
- Improve histogram labels with clearer bucket boundaries, count/sum context, and table parity.
- Add pause/resume, clear data, and result footer state across traces, logs, and metrics.
- Add dense trace-list headers and sort controls when the trace list owns enough horizontal space.
- Virtualize logs and trace rows once row counts exceed a few hundred.

Done when:

- A user can inspect a log or span, search inside details, copy useful values, and close the pane without losing list context.
- A user can navigate metrics by meter, compare instruments by service, type, latest value, update time, and details, then focus one instrument without losing meter context.
- Streaming data can be paused, cleared with confirmation, and understood from visible footer/status state.

## Phase 2 — Durable Local Storage

Goal: replace the current memory-backed storage with a real local store that survives restarts.

Status: **core delivered.** `@otelux/engine-node` is a durable `node:sqlite` store wired into the desktop app, with user-configurable retention. Migration/versioning and multi-backend contract tests remain.

Tasks:

- [x] Implement `@otelux/engine-node` using Node 22 `node:sqlite`.
- [x] WAL mode, prepared statements, and schema bootstrap on open (`PRAGMA user_version`).
- [x] Persist traces (+ materialized trace rollup), logs, metrics, interned resources/scopes, and hot indexed attributes.
- [x] Add retention controls by age and size (default 72h / 512 MB; `0` disables either bound), exposed in Settings and enforced by a background prune + on-change.
- Keep the engine storage interface portable so a future browser store can reuse the same query behavior.
- Add schema migration and corruption-tolerance tests (currently: schema bootstrap only; no cross-version migration yet).
- Run the storage contract test suite against both memory and SQLite backends.

Done when:

- [x] Desktop data survives restart.
- Existing engine tests pass against both memory and SQLite storage (shared contract suite pending).
- [x] Retention can bound disk growth (age and size) without blocking ingest.

## Phase 3 — VS Code Extension Hardening

Goal: make the extension a credible second consumer of the shared packages.

Tasks:

- Smoke-test the webview against live traces, logs, and metrics.
- Harden the postMessage adapter for errors, timeouts, and subscription cleanup.
- Verify VS Code-hosted theme inheritance, especially high-contrast behavior.
- Complete one-click MCP config writers for Copilot, Codex CLI, Claude Code, and Cursor using temporary homes in tests.
- Package a `.vsix` artifact from CI.
- Document extension settings and ports.

Done when:

- A fresh VS Code window can side-load the extension, receive local OTLP data, render the same workbench as desktop, and expose LM/MCP tools over the same engine data.

## Phase 4 — Agent And Service Intelligence

Goal: make OTelux useful for agent-assisted debugging, not just human browsing.

Tasks:

- Implement agent-run detection in `@otelux/engine` for known local agent telemetry shapes.
- Back `otel_correlate_agent_run` with real trace/log/time-window queries.
- Implement service overview rollups: span count, error count/rate, p50/p95 duration, log severity distribution, and metric availability.
- Upgrade `otel_get_service_overview` from recent-trace approximation to those richer cross-signal rollups.
- Add a Services surface or compact overview panel if the UI needs one.

Done when:

- A human or LM tool can answer: what broke, what was slow, what logs explain it, and what app telemetry happened during an agent run.

## Phase 5 — Production Ingest Formats

Goal: accept more real-world OTLP senders without losing the local-first model.

Tasks:

- [x] Add OTLP/HTTP protobuf decoding for traces, logs, and metrics.
- Add OTLP/gRPC for traces, logs, and metrics.
- Add bounded ingest queues, dropped-record counters, and UI surfacing for receiver pressure.
- Harden CORS and optional local auth token settings.
- Add malformed, oversized, and concurrent ingest tests.

Done when:

- Common OTel SDK defaults can send to OTelux without forcing JSON protocol, and overload is visible rather than silent.

## Phase 6 — Distribution And Platform Polish

Goal: make OTelux easy to install and keep around.

Tasks:

- Stabilize Linux AppImage and `.deb` packaging.
- Add macOS and Windows packaging after Linux is stable.
- Add desktop menus, shortcuts, window-state persistence, and release-channel documentation.
- Decide whether auto-update is needed before a public release.

Done when:

- A user can install OTelux, run it like a normal app, and keep settings and data across sessions.

## Phase 7 — Future Surfaces

These stay out of the near-term plan until the core workbench is strong:

- Pure-browser demo with a WASM/OPFS storage adapter.
- Profiles and flame graph view.
- Service map and span-link graph.
- Saved views and global search.
- Optional host-provided AI assistance. OTelux itself stays deterministic and local-first.

## Execution Rules

- Keep code, tests, and docs in the same change when behavior changes.
- Prefer package-level implementation over app-specific forks.
- Do not add a new surface until traces, logs, metrics, storage, and tests stay coherent on the existing desktop and VS Code surfaces.
- Re-check [spec.md](spec.md) whenever this plan changes.
