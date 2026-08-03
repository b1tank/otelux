# OTelux — Plan Ahead

Updated: 2026-08-02

This plan only covers work ahead of us. Completed implementation detail lives in git history and the package READMEs; this file is for deciding what to build next.

> **Active `v0.1.0` overlay:** [release-sprint.md](release-sprint.md) orders launch work and records temporary decisions and evidence. This plan remains the owner of product sequencing. Remove this note when the sprint is retired after `v0.1.0`.

See the specification's [Current Baseline](spec.md#current-baseline) for implemented capabilities and limits. The phases below contain only work that remains ahead; remove completed work as it ships.

## Phase 1 — Workbench Polish

Goal: make the current three signal views feel like a professional local debugging tool.

Tasks:

- Normalize section count badges and action menus across span and log details.
- Add metric grouping controls for Service and Type without losing the current meter-first explorer layout.
- Improve histogram labels with clearer bucket boundaries, count/sum context, and table parity.
- Add pause/resume (live-tail freeze), result footer state, and clear data with confirmation across traces, logs, and metrics — **done**.
- Add trace-list and logs sort controls (traces: Most recent, Slowest, Most errors, Most spans, Name; logs: Newest, Oldest, Highest severity) — **done**; dense/table-like trace-list headers when the list owns enough horizontal space remain.
- Virtualize logs with the shared fixed-row primitive once the visible log page grows beyond the current bounded 100 rows.

Done when:

- [x] A user can inspect a log or span, search inside details, copy useful values, and close the pane without losing list context.
- A user can navigate metrics by meter, compare instruments by service, type, latest value, update time, and details, then focus one instrument without losing meter context.
- Streaming data can be paused, cleared with confirmation, and understood from visible footer/status state. — **done**

## Phase 2 — Durable Local Storage

Goal: replace the current memory-backed storage with a real local store that survives restarts.

Status: **foundation delivered; audited hardening required before daemon release.** `@otelux/engine-node` is a durable `node:sqlite` store wired into the desktop app, with user-configurable retention, a forward-migration framework, corruption recovery, and a contract suite shared with the memory backend. The schema/query audit in [storage.md](storage.md) found correctness and N+1 issues that block treating this phase as complete for multi-client use.

Tasks:

- [x] Implement `@otelux/engine-node` using Node 22 `node:sqlite`.
- [x] WAL mode, prepared statements, and schema bootstrap on open (`PRAGMA user_version`).
- [x] Persist traces (+ materialized trace rollup), logs, metrics, interned resources/scopes, and hot indexed attributes.
- [x] Add retention controls by age and size (default 72h / 512 MB; `0` disables either bound), exposed in Settings and enforced by a background prune + on-change; each pass checkpoints and truncates WAL so sustained ingestion cannot leave an unbounded sidecar outside the database-page budget.
- [x] Add schema migration framework (versioned, forward-only) and corruption-tolerance recovery: failed upgrades roll back and remain in place for retry; unreadable or newer-version files are quarantined before starting fresh. Cover bootstrap, retry, newer-version, and corrupt-file cases.
- [x] Run the storage contract test suite against both memory and SQLite backends.
- [x] Change span identity and every detail lookup to `(traceId, spanId)`; schema v2 transactionally rebuilds v1 spans, repairs surviving rollups, and has duplicate-span-ID-across-traces coverage for memory and SQLite.
- [x] Normalize trace services in schema v3 and apply the same indexed service predicate before count and offset pagination; reuse it when cursor pagination lands.
- [x] Split metric list metadata from selected-series history, replace the point-query N+1 with one compound indexed tail query, and bound point windows/payloads.
- [x] Add grouped resource facet queries so inactive workbench views do not fetch raw records to discover filters; protocol 0.5 and schema v4 use standard `service.namespace` as the primary Source dimension with exact `service.name` fallback and a contextual component-Service facet.
- Add keyset cursor pagination for live lists and optional exact counts.
- Add statement-count and `EXPLAIN QUERY PLAN` tests enforcing the budgets in [storage.md](storage.md#query-contracts-and-statement-budgets).
- Add FTS5 log search only after tokenizer/fallback parity tests define exact semantics.

Done when:

- [x] Desktop data survives restart.
- [x] Existing engine tests pass against both memory and SQLite storage (shared contract suite).
- [x] Retention can bound disk growth (age and size) without blocking ingest.
- Span identity, filtered count/page results, and memory/SQLite behavior are correct under the adversarial fixtures in [storage.md](storage.md#verification).
- Trace, log, metric, facet, and detail operations satisfy their SQL statement and payload budgets.

## Phase 3 — Agent And Service Intelligence

Goal: make OTelux useful for agent-assisted debugging, not just human browsing.

Tasks:

- Extend agent-run correlation from exact searchable conversation/session IDs and propagated trace context to a bounded time-window fallback when the telemetry lacks trace IDs.
- Optimize cross-signal service overview rollups into dedicated durable-storage aggregation queries once dogfood volume makes the current bounded paged engine composition exceed budgets.
- Add a Services surface or compact overview panel if the UI needs one.

Done when:

- A human or LM tool can answer: what broke, what was slow, what logs explain it, and what app telemetry happened during an agent run.

## Phase 4 — Production Ingest Formats

Goal: accept more real-world OTLP senders without losing the local-first model.

Tasks:

- [x] Add OTLP/HTTP protobuf decoding for traces, logs, and metrics.
- Add OTLP/gRPC for traces, logs, and metrics.
- Add bounded ingest queues, dropped-record counters, and UI surfacing for receiver pressure.
- Harden CORS and optional local auth token settings.
- Add malformed, oversized, and concurrent ingest tests.

Done when:

- Common OTel SDK defaults can send to OTelux without forcing JSON protocol, and overload is visible rather than silent.

## Phase 5 — Distribution And Platform Polish

Goal: make OTelux easy to install and keep around.

Tasks:

- Stabilize Linux AppImage and `.deb` packaging.
- Add macOS and Windows packaging after Linux is stable.
- Add desktop menus, shortcuts, window-state persistence, and release-channel documentation.
- Decide whether auto-update is needed before a public release.

Done when:

- A user can install OTelux, run it like a normal app, and keep settings and data across sessions.

## Phase 6 — Shared Runtime And Agent Ecosystem

Goal: make every local OTelux form reuse one per-user runtime, receiver, active database, tool implementation, and visual workbench.

Tasks:

- [x] Ship one dual Claude/Codex plugin package with shared skills and a secure bridge to the desktop MCP listener.
- [x] Publish local Claude and Codex marketplace catalogs and validate/install both plugins.
- [x] Add MCP safety annotations required by agent hosts and public plugin review.
- [x] Add a thin Pi package adapter that registers the existing MCP bridge tools natively without forking their implementation.
- [x] Extract backend composition into `@otelux/local-runtime`; Desktop now delegates SQLite, migrations, retention, OTLP, MCP, settings, and sample data to it.
- Run `@otelux/local-runtime` as a single-instance per-user daemon instead of embedding it in Electron.
- [x] Add canonical per-user data-home resolution, nonce-protected state/locking, protocol/runtime version metadata, and resumable copy-only legacy Desktop migration.
- Define wire DTOs and codecs in `@otelux/protocol`, generate checked-in JSON Schema snapshots, and add backward/forward compatibility fixtures.
- Add JSON-RPC 2.0 Runtime RPC over loopback HTTP plus SSE invalidations, following [protocol.md](protocol.md); do not expose MCP as the UI API.
- Add an authenticated HTTP/SSE `DataSource` adapter, serve the existing `@otelux/ui` as a same-origin loopback workbench, and convert Desktop into a client of that runtime.
- Add dedicated runtime/API and MCP tokens/scopes plus one-time browser session bootstrap; tokens must never appear in dashboard URLs or `runtime.json`.
- Add the OTelux CLI for runtime lifecycle, status, settings, dashboard launch, and diagnostics.
- Package the shared stdio MCP launcher for direct-MCP users and make the Claude/Codex plugin ensure the runtime without requiring Desktop.
- Add confirmation-backed skills for configuring Claude, Codex, OpenTelemetry SDKs, and Collectors, with sensitive telemetry capture disabled by default.
- Validate plugin-first, Desktop-first, direct-MCP, CLI-only, multi-agent, upgrade, port-conflict, and uninstall scenarios on every supported platform.
- Add validated MCP input and output schemas; keep agent summaries separate from paginated UI query DTOs.
- Publish prebuilt CLI, direct-MCP, and self-contained Claude/Codex plugin artifacts that require no install-time compilation or separate Desktop installation.
- Complete marketplace metadata, support/privacy material, clean-install evidence, and Claude/Codex publishing workflows.

Done when:

- Plugin, direct-MCP, CLI, and Desktop users all reach the same local runtime and database, regardless of installation order.
- Claude/Codex users can install the plugin without Desktop, invoke analysis skills, configure telemetry with approval, and open the browser workbench.
- Installing Desktop later shows telemetry already collected by the plugin, and closing Desktop does not interrupt ingest or MCP access.

See [arch.md](arch.md).

## Phase 7 — Future Capabilities

These stay out of the near-term plan until the core workbench is strong:

- Profiles and flame graph view.
- Service map and span-link graph.
- Saved views and global search.
- Optional host-provided AI assistance. OTelux itself stays deterministic and local-first.

## Execution Rules

- Keep code, tests, and docs in the same change when behavior changes.
- Prefer package-level implementation over app-specific forks.
- Do not add another product form until traces, logs, metrics, storage, and tests stay coherent across plugin, direct MCP, CLI, and Desktop.
- Re-check [spec.md](spec.md) whenever this plan changes.
