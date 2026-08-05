# OTelux — Plan Ahead

Updated: 2026-08-03

This plan only covers work ahead of us. Completed implementation detail lives in git history and the package READMEs; this file is for deciding what to build next.

> **Active presentation/distribution overlay:** [sprint.plan.md](sprint.plan.md) contains the evidence-based OSS branding, demo, cross-platform artifact, and package-manager rollout. This plan remains the owner of product sequencing.

See the specification's [Current Baseline](spec.md#current-baseline) for implemented capabilities and limits. The phases below contain only work that remains ahead; remove completed work as it ships.

## Phase 0 — Public OSS Readiness

Goal: make the repository safe and accurate to expose publicly without waiting for unrelated product roadmap work or claiming stable cross-platform maturity.

Essential visibility gates:

- Re-run pinned Gitleaks and TruffleHog scans across full Git history and record clean evidence.
- Audit the current tree for credentials, private endpoints, real telemetry, machine paths, personal data, and sensitive screenshots/fixtures.
- Reconcile stale spec/plan/release claims so shipped work is not marked pending and unsupported work is not described as live.
- Verify public `.deb` download, checksum, SBOM, clean install/upgrade/launch/ingest/restart/uninstall, privacy guidance, and known limitations.
- Enable and verify private vulnerability reporting, secret scanning, push protection, Dependabot, and public CodeQL results.
- Protect `main` with pull requests, required green CI, up-to-date branches, and force-push/deletion protection.
- Verify LICENSE detection, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, support policy, issue forms, and PR template; disclose the sole-maintainer conduct escalation limitation until additional maintainers join.
- After changing visibility, verify CI/CodeQL, vulnerability reporting, release links, repository metadata, and public-facing wording.

Important before stable-product claims, but not blockers for repository visibility:

- SQL statement/query-plan budgets; runtime IPC/HTTP/MCP validation and wire schemas; accessibility and coverage gates; full packaged regression; patch/security runbooks; and an external beta.

Not OSS visibility blockers:

- The daemon, browser workbench, CLI, independent plugin packaging, gRPC, Windows/macOS signing, service UI, correlation fallback, FTS, profiles, and service maps remain public roadmap work.

Done when the concise gate in [sprint.plan.md](sprint.plan.md) passes. The detailed one-time GitHub settings checklist remains in [release-sprint.md](release-sprint.md#going-public-checklist).

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
- [x] Split metric list metadata from selected-series history; schema v5 adds event-time ordering/indexing, selected history uses bounded cursor pages with explicit attribute projection metadata, and service overview no longer builds per-instrument point-tail unions.
- [x] Add grouped resource facet queries so inactive workbench views do not fetch raw records to discover filters; protocol 0.5 and schema v4 use standard `service.namespace` as the primary Source dimension with exact `service.name` fallback and a contextual component-Service facet.
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

Done when:

- Common OTel SDK defaults can send to OTelux without forcing JSON protocol, and overload is visible rather than silent.

## Phase 5 — OSS Presentation, Distribution, And Platform Polish

Goal: make OTelux immediately understandable, demonstrable, trustworthy, and easy to install through native platform conventions.

The decomposed audit and rollout are in [sprint.plan.md](sprint.plan.md).

Tasks:

- Keep the repository hero, synthetic demo, social preview, status badges, current version, and support matrix synchronized with releases.
- Keep prerelease status explicit; publish a non-prerelease “Latest” release only after the advertised stable support matrix passes its release gate.
- Extend the native Linux package gates to signed macOS and Windows releases with OS trust UI, cross-version upgrade, and public-artifact download verification.
- Evaluate Linux RPM only from demonstrated demand; maintain the qualified x64/arm64 `.deb` and AppImage paths.
- Ship signed and notarized macOS arm64/x64 artifacts before adding a Homebrew tap/cask.
- Ship a signed Windows x64 installer before submitting versioned Winget manifests; add arm64 only after runtime validation.
- Publish checksums, SBOMs, provenance/signatures, platform limitations, and complete install/upgrade/uninstall instructions for every artifact.
- Add desktop menus, shortcuts, window-state persistence, and release-channel documentation.
- Defer silent auto-update until signed artifact and rollback policy are defined.

Done when:

- A repository visitor can identify the product, see it in use, find the current version/support matrix, and reach a safe installation path in seconds.
- A user on every advertised platform can install, launch, ingest, upgrade, and uninstall OTelux through a tested native artifact or package-manager channel.
- Settings and retained data survive supported upgrades, explicit uninstall/data-removal behavior is documented, and GitHub release presentation matches the actual stability level.

## Phase 6 — Shared Runtime, CLI, And Agent Ecosystem

Goal: make every local OTelux form reuse one per-user runtime, receiver, active database, tool implementation, and visual workbench, with safe CLI/Desktop onboarding for supported coding agents.

The command contract, packaging names, adapter safety model, Settings → Agents UX, onboarding flow, milestones, and acceptance matrix are defined in [agent-onboarding.md](agent-onboarding.md).

Tasks:

- [x] Ship one dual Claude/Codex plugin package with shared skills and a secure bridge to the desktop MCP listener.
- [x] Publish local Claude and Codex marketplace catalogs and validate/install both plugins.
- [x] Add MCP safety annotations required by agent hosts and public plugin review.
- [x] Add a thin Pi package adapter that registers the existing MCP bridge tools natively without forking their implementation.
- [x] Extract backend composition into `@otelux/local-runtime`; Desktop now delegates SQLite, migrations, retention, OTLP, MCP, settings, and sample data to it.
- [x] Build and process-test a foreground `oteluxd` owner with normal runtime state/RPC, duplicate-owner rejection, and complete signal shutdown.
- Package/register `oteluxd` with per-user background lifecycle, compatibility-aware discovery/start/stop, and upgrade rollback; then stop embedding runtime ownership in Electron.
- [x] Add canonical per-user data-home resolution, nonce-protected state/locking, protocol/runtime version metadata, and resumable copy-only legacy Desktop migration.
- [x] Add bounded tagged-bigint wire codecs, path-aware Electron IPC/event and runtime-state validation, checked transition schemas, and backward/compatible-future fixtures in `@otelux/protocol`.
- [x] Define and validate the initial Runtime JSON-RPC method registry, protocol-major negotiation, revisioned SSE envelopes, checked transport schemas, direct dispatcher tests, and authenticated loopback HTTP/SSE host.
- [x] Add browser-safe authenticated HTTP/SSE `DataSource` and control client plus real SQLite-backed direct/HTTP parity for current query methods.
- [x] Harden Runtime HTTP with loopback endpoint pinning, redirects disabled, RPC deadlines, bounded streamed responses/SSE frames, aggregate batch/output budgets, slow-client disconnect, recoverable initialization, and serialized settings/clear mutations.
- [x] Split metric metadata from selected bounded point history across direct, Runtime HTTP, and Electron IPC adapters, then convert the workbench UI to the split methods.
- Add IPC to the shared direct/HTTP parity suite.
- Add scoped browser session bootstrap, serve the existing `@otelux/ui` as a same-origin loopback workbench, and convert Desktop into a daemon client.
- Add dedicated runtime/API and MCP tokens/scopes plus one-time browser session bootstrap; tokens must never appear in dashboard URLs or `runtime.json`.
- Add the OTelux CLI for runtime lifecycle, status, endpoints, settings, dashboard/Desktop launch, diagnostics, and machine-readable output.
- Bundle a version-matched CLI and daemon with Desktop while keeping them independently packageable; reserve `otelux` for CLI and rename GUI executables before stable cross-platform release.
- Add `@otelux/agent-integrations` as the shared typed detector/planner/applier/verifier used by CLI and Desktop; configuration writes must be previewed, atomic, idempotent, reversible, permission-safe, and secret-redacted.
- Add Settings → Agents with capability/status cards, inspected paths, exact proposed operations, Install/Verify/Repair/Remove, restart continuation, and accessible vendor-neutral fallback icons.
- Add a resumable first-run flow for local-data/privacy explanation, sample data, endpoint health, agent detection, separate MCP/skills/telemetry/content choices, preview/apply, restart, and end-to-end verification.
- Support Claude Code, Codex, and Pi end-to-end first; add capability-pinned Copilot CLI and OpenCode adapters without assuming every host supports native plugins/extensions.
- Package the shared stdio MCP launcher for direct-MCP users and make agent integrations ensure the runtime without requiring Desktop.
- Add confirmation-backed workflows for configuring supported agents, OpenTelemetry SDKs, and Collectors, with sensitive telemetry capture disabled by default.
- Validate plugin-first, Desktop-first, CLI-first, direct-MCP, CLI-only, five-agent, concurrent-edit, rollback, upgrade, port-conflict, and uninstall scenarios on every supported platform.
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
