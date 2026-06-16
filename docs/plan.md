# OTelux — Plan

Version: 3.1
Updated: 2026-06-16

This is the execution plan for OTelux. It says **how** we get from today to
the product defined in [spec.md](spec.md). It is intentionally slow. Phases
are effort budgets, not calendar weeks. Finish one well, breathe, start the
next.

> **Status at a glance:** Phase 0 ✅ · Phase 1 (M1 trace workbench) ✅ ·
> Phase 2 (structured logs) ✅ shipped · Phase 3 (metrics) 🚧 in progress ·
> Phases 4–5 not started.

---

## 1. Honest audit

### What we are keeping

- The OTel data model thinking and waterfall layout algorithm baked into the
  prior C++ core — ported to TypeScript in `@otelux/engine`.
- Trace fixtures under `fixtures/` — driving Storybook stories, parity
  tests, and integration tests.
- This `docs/` set as the single source of design truth.
- Lessons from the GTK Cairo waterfall prototype (label collision, depth
  indent, time-ruler placement) — they inform the React waterfall design.

### What we are deleting

- `src/core/`, `src/cli/`, `src/shells/` (C++ core, smoke CLI, GTK shell).
- `meson.build`, `subprojects/`, `vendor/`, `build/`.
- All pre-pivot C files in `src/app.*`, `src/main.c`, `src/ingest`,
  `src/store`, `src/render`, `src/ui`, `src/util` and their tests.

This is a clean break, not a fork. Git history preserves the C++ ideas;
commits `46ddc43..d25998c` are the reference if we ever need them.

### What we are reusing from prior prototypes

A standalone VS Code branch experiment proved several things we now treat as
load-bearing assumptions:

- `node:sqlite` works inside a webview-hosting extension without native
  modules.
- A typed `{ query → result }` postMessage facade is the right boundary
  between a Node-side store and a webview UI.
- Denormalizing hot attributes alongside a generic attributes table gives
  fast filtered queries while keeping the schema OTEL-generic.
- Theming via host CSS variables maps cleanly to a component theme.

`@otelux/engine-node` and `@otelux/adapter-vscode` formalize those patterns
as published packages.

---

## 2. Milestone 1 — Ship a Linux desktop app **and** a VS Code extension you can use

**M1 is the single guiding goal of the first phase block.** Everything we
build through M1 has to contribute to two consumers of the same packages:
a Linux desktop binary you can install, and a VS Code extension you can
side-load. Shipping both at once is the cheapest way to prove the
package boundaries are right; deferring the second consumer is how monorepos
rot into single-app monorepos.

**Definition of M1 done — all of these are true:**

1. You can install OTelux on Linux (AppImage and `.deb`) **and** install
   the OTelux VS Code extension as a `.vsix` from CI.
2. You launch the desktop app like any desktop app; cold start to first
   paint is under 300 ms (warm cache). The VS Code extension activates
   on startup and exposes the Telemetry Explorer panel within the same
   budget once opened.
3. The desktop app listens on `http://localhost:4319` for OTLP/HTTP
   (JSON + protobuf). The VS Code extension listens on the standard
   `http://localhost:4318`. Any OpenTelemetry SDK pointing at either
   shows traces in its workbench with zero configuration. gRPC is
   explicitly out of M1 — it lands in Phase 5.
4. A trace list shows all received traces with timestamp, name, services,
   span count, duration, status. It is virtualized, sortable, searchable,
   and filterable by service, status, and time window. **The same
   `@otelux/ui` component renders in both consumers** — no per-app fork.
5. Clicking a trace opens a waterfall view: per-service color, depth indent,
   time ruler, hover tooltip, keyboard navigation, error styling.
6. Clicking a span opens a detail panel: attributes, events, context
   (trace/span/parent IDs, scope, version), resource attributes.
7. Live ingest works: new traces appear without restarting the app or
   reopening the panel, with pause/resume.
8. Data persists across restarts in a local SQLite file with retention
   (age and count) configurable in a Settings page.
9. The desktop app feels like an OS-native window: proper menus, keyboard
   shortcuts, light/dark/high-contrast, screen-reader-labeled controls,
   focus rings. The extension's webview inherits VS Code theme via the
   `--vscode-*` mapping in `@otelux/ui` and meets the same a11y bar.
10. Crashes are recoverable: WAL pragma is set, partial writes do not
    corrupt the store, ingest backpressure is bounded. Running both
    consumers simultaneously is handled by `@otelux/receiver`'s
    `claimSingleInstance` (see [spec.md § 7.1](spec.md)).
11. **Copilot LM Tools** are registered in the extension and callable from
    Copilot Chat for the canonical troubleshooting questions (see
    [spec.md § 12.3](spec.md)). MCP server endpoint is mounted on the
    same store; a one-click "Enable Codex / Claude Code / Cursor
    integration" command writes the corresponding MCP config.

**Out of M1:** logs, metrics, profiles, services overview, macOS/Windows
desktop, auto-update, code signing, web demo, OTLP/gRPC. Those are
explicit later phases.

The package architecture is the means, not the end. We still build the
packages — they are how M1 gets built — but during M1 they live as
workspace packages consumed by `apps/desktop` **and** `apps/vscode-extension`
via workspace links. Public npm publish happens in a later phase once the
contracts have shaken out against two real consumers.

---

## 3. Phases

### Phase 0 — Pivot landing (1 week)

Goal: clean tree, scaffolded monorepo, CI green.

Tasks:

- Commit `chore: retire C++ core` — deletes `src/`, `meson.build`,
  `subprojects/`, `vendor/`, `build/`, old test directories, dead C files.
- Scaffold the npm monorepo: root `package.json` with workspaces,
  `turbo.json`, `tsconfig.base.json`, `biome.json`, `.changeset/`,
  `.npmrc` with `engine-strict=true`.
- Create empty packages with `package.json`, `src/index.ts`,
  `tsup.config.ts`, `vitest.config.ts`:
  - `@otelux/types`
  - `@otelux/engine`
  - `@otelux/engine-node`
  - `@otelux/protocol`
  - `@otelux/ui` (plus Storybook 8 boot)
  - `@otelux/adapter-direct`
  - `@otelux/adapter-vscode`
  - `@otelux/receiver`
  - `@otelux/mcp-server`
- Create empty `apps/desktop` (Electron + electron-builder + Vite renderer).
- Create empty `apps/vscode-extension` (esbuild for host entry, Vite for
  webview entry; see [spec.md § 5.1](spec.md)).
- CI: GitHub Actions running `turbo run lint typecheck test build` on
  Ubuntu × Node 22.
- README rewrite stating the M1 goal in one paragraph.

Exit criteria: `npm install && npm run build && npm test` passes on a clean
Ubuntu checkout. `npm run -w apps/desktop dev` opens an empty Electron
window. `npm run -w apps/vscode-extension package` produces a `.vsix`
that activates in a fresh VS Code and opens an empty webview.

### Phase 1 — M1: trace workbench shipped as desktop + VS Code extension (8–12 weeks)

The single end-to-end phase that delivers M1. Tracks run in parallel. The
extension is a peer consumer of `@otelux/*`, not a follow-up port —
shipping it in lockstep is what proves the package boundaries.

Track A — Types and protocol:

- `@otelux/types`: OTLP types — Trace, Span (status, kind, events, links),
  Resource, InstrumentationScope.
- `@otelux/protocol`: `DataSource` interface with `listTraces`, `getTrace`,
  `getSpanDetails`, `subscribe`. Query/result types versioned.

Track B — Engine:

- Port waterfall layout from the retired C++ `append_layout_rows` to TS,
  with parity tests against the same fixtures.
- Trace queries: service filter, kind filter, status filter, name search,
  duration/time-window filter, sort, pagination, total count.
- Span detail fetch with full attribute parsing.
- Live subscription: emit a "new traces" event the UI can poll/observe.
- `@otelux/engine-node` (`node:sqlite`): schema versioning, WAL pragma,
  prepared statements, retention (age + count), recovery on partial writes.

Track C — Receiver:

- `@otelux/receiver`: Hono server with `POST /v1/traces` for JSON and
  protobuf using `@opentelemetry/otlp-transformer`.
- Health endpoint, CORS, configurable port.
- Bounded ingest queue with drop metrics.
- `claimSingleInstance({ port })` helper (see
  [spec.md § 7.1](spec.md)) so two consumers (or two windows of the same
  consumer) cooperate rather than fight for the OTLP ports. Integration
  tests cover three cases: same kind, different kind, stale lockfile.
- OTLP/gRPC is explicitly out of M1; it lands in Phase 5.

Track D — UI:

- Theme tokens (`--otelux-fg`, `--otelux-bg-panel`, `--otelux-accent`, …)
  with sensible Linux-desktop defaults and a `--vscode-*` mapping layer so
  later embedders inherit theme.
- Components in Storybook with fixture-driven stories:
  - `Waterfall` (SVG via visx, virtualized rows, depth indent, time ruler,
    per-service color, error styling, hover, keyboard nav).
  - `TraceList` (TanStack Table + Virtual: timestamp, name, services,
    duration bar, status, sortable, virtualized).
  - `SpanDetail` (overview, attributes, events, context, resource).
  - `Toolbar` (service multi-select, status filter, search, pause, refresh).
  - `Settings` (port, retention, theme).
  - `EmptyState`, `ErrorBoundary`.
- Top-level `OTeluxWorkbench` assembles them.
- Keyboard map: up/down, page up/down, home/end, enter, escape, `/` to
  focus search, `ctrl+,` for settings.

Track E — Adapters:

- `@otelux/adapter-direct`: wraps an engine instance and exposes the
  `DataSource` interface to the renderer. Used by Electron's IPC bridge.
- `@otelux/adapter-vscode`: `serveDataSource(webview, engine)` on the
  extension host side; `createPostMessageDataSource(vscodeApi)` on the
  webview side. Round-trip latency budget verified against the trace
  list and waterfall pages.

Track F — Desktop app:

- `apps/desktop`: Electron main process boots the receiver + engine +
  `@otelux/mcp-server` + IPC bridge; renderer is a Vite-built React app
  consuming `@otelux/ui` via `@otelux/adapter-direct` over Electron IPC.
- Native menus, keyboard shortcuts, window state persistence.
- Default OTLP/HTTP port `4319` (off the standard, see spec § 7.1) so the
  desktop never collides with a user's standalone collector.
- electron-builder produces `.AppImage` and `.deb` artifacts for x64 and
  arm64 in CI.
- Smoke E2E with Playwright: launch the app, post a fixture to the
  receiver, assert the trace appears in the list, click it, assert the
  waterfall renders.

Track H — VS Code extension:

- `apps/vscode-extension`: extension host boots the same
  `@otelux/receiver` + `@otelux/engine-node` + `@otelux/mcp-server`
  pipeline as the desktop, then opens a webview that renders
  `@otelux/ui` via `@otelux/adapter-vscode`.
- Default OTLP/HTTP port `4318` so users point any SDK at the standard
  endpoint with zero configuration.
- Status-bar entry: endpoint, span count, status menu (start / restart /
  stop / open).
- Multi-window behavior: second window detects the first via
  `@otelux/receiver`'s `claimSingleInstance` and connects in client-only
  mode rather than failing.
- Webview CSP-clean (already a frozen spec requirement). Theme inherits
  from `--vscode-*` via the existing mapping in `@otelux/ui`.
- CI publishes a `.vsix` artifact per commit on `main`.

Track I — Copilot LM Tools:

- Register the canonical troubleshooting tools listed in
  [spec.md § 12.3](spec.md) via `vscode.lm.registerTool`, plus a
  `package.json` `languageModelTools` contribution so they appear as
  `#otel*` references in Copilot Chat.
- Each tool is a thin wrapper over an `@otelux/engine` query so the same
  logic powers the MCP server.
- Confirmation messages, JSON schemas, and result formatters match the
  VS Code LM Tool conventions.
- Smoke test: open Copilot Chat in a launched extension host, invoke
  `#otel_get_slowest_spans`, assert the answer cites span IDs from a
  fixture.

Track J — MCP surface and one-click integrations:

- `@otelux/mcp-server`: hand-written JSON-RPC dispatcher with HTTP
  (Hono-mounted) and stdio transports; protocol versions `2025-06-18`,
  `2025-03-26`, `2024-11-05`.
- Tools are the same shims used by Track I, ensuring LM Tools and MCP
  return identical results.
- Extension commands `Enable Codex Integration`, `Enable Claude Code
  Integration`, `Enable Cursor Integration` write each agent's MCP
  config file and drop bundled skills (if any) into the agent home.
- Integration test: spawn the extension host, run the
  `Enable Codex Integration` command against a tmp home, assert the
  emitted config file matches a golden snapshot.

Track G — Verification:

- A `scripts/send-traces.sh` posts the bundled fixtures to a running
  consumer (either app, port-aware).
- A `docs/m1-verification.md` checklist walks through the 11 done
  criteria, run once against the desktop and once against the extension.
- Performance harness: 100k-span ingest, query, scroll, waterfall layout
  measured against the budgets in [spec.md § 8](spec.md). UI budgets are
  measured once — they cover both apps by construction.
- Storybook + Playwright visual snapshots are the regression net for any
  `@otelux/ui` drift between desktop and extension; both must remain
  pixel-equal on representative stories.

Exit criteria: the M1 done definition above is met, end to end, on a
fresh Ubuntu install — both for the desktop binary and for the loaded
`.vsix`.

### Phase 2 — Structured logs (3–6 weeks) ✅ shipped

> **Shipped.** Logs ingest (`/v1/logs`), engine storage/query, the
> `Logs` rail tab + `LogsView` (severity tint, service chips, detail
> drawer, attribute/body search) and the Codex log fixture + decoder
> tests are all live. Trace-correlation deep-linking and live-tail
> pause/resume remain as follow-ups but the pillar is usable end-to-end
> against a real `codex exec` run.

**Reference workload:** the Codex CLI logs pipeline (see
[spec.md §13](spec.md)). Codex is where the content lives — `codex.user_prompt`
and other business events ride OTLP **logs**, not traces — so this phase is
what first makes human-readable agent content visible in OTelux. The explorer
feature bar mirrors the .NET Aspire dashboard `StructuredLogs` page.

Types / protocol:
- `@otelux/types`: `LogRecord` (timestamp, observed timestamp, severity
  number/text, `eventName`, optional `body`, attributes, `traceId`/`spanId`,
  resource, scope).
- `@otelux/protocol`: `ListLogsQuery` / `ListLogsResult`, `listLogs` on
  `DataSource`, `ChangeEvent` gains `{ kind: 'logsChanged' }`.

Receiver:
- `decodeExportLogsServiceRequest` reusing the `otlp.ts` `AnyValue`/attribute
  normalizers.
- `POST /v1/logs` route: lenient JSON, `{ partialSuccess: {} }` on success,
  `400` on malformed JSON (parity with `/v1/traces`).

Engine:
- Logs storage: id, timestamp, severity, body, scope, service, trace_id,
  span_id, attributes, resource attributes. Hot attributes denormalized for
  fast filtered queries (same pattern as spans).
- `ingestLogs` + `logsChanged` notification.
- Query: severity (≥ level), service/resource, scope, time window, trace_id,
  attribute equality, free-text on body **and on attribute values** (Codex
  content lives in `prompt`, not `body`), newest-first, paginated.

UI (`@otelux/ui`, features per Aspire `StructuredLogs`):
- `LogsTable` — virtualized, sticky header, severity row tint + severity icon
  column, sortable, resizable columns.
- `LogsToolbar` — resource/service selector (with grouping), **log-level
  select**, free-text message/attribute search, **structured attribute
  filters** (field / operator / value, with an enabled-filter count badge),
  pause/resume, clear.
- `LogDetail` — summary/detail split pane: event name + scope, full attribute
  list, resource attributes, context (trace/span IDs).
- Trace correlation: click `trace_id` → switch to Traces focused on that trace.
- Live tail mode (pause/resume), deep-linkable per-resource route.

Verification:
- Decoder unit tests over a captured Codex `ExportLogsServiceRequest` fixture.
- End-to-end: run a real Codex turn with `log_user_prompt = true` pointed at
  `:4319/v1/logs`; assert the `codex.user_prompt` record's `prompt` attribute
  holds the typed text and renders in `LogDetail`.

Exit criteria: a user can debug a real local crash via logs and one-click
correlate to its trace, **and** can read Codex prompt/tool content captured
from a live Codex session.

### Phase 3 — Metrics (4–8 weeks) 🚧 in progress

> **In progress.** Backend (types → protocol → engine/storage →
> `/v1/metrics` decoder + route + Codex fixture/tests) lands first,
> followed by the `Metrics` rail tab with a meter→instrument tree and a
> per-instrument chart/table viewer. Exemplar→trace jumps and DuckDB
> evaluation remain explicit follow-ups.

**Reference workload:** the Codex CLI metrics pipeline (see
[spec.md §13](spec.md)) — monotonic Sums (`codex.api_request`,
`codex.tool.call`, `codex.turn.token_usage`) and Histograms (`*_ms` durations
like `codex.turn.e2e_duration_ms`), delta temporality. The explorer mirrors
the Aspire dashboard `Metrics` page (meter tree → instrument → chart).

Types / protocol:
- `@otelux/types`: `Metric` discriminated by type (`Sum` / `Gauge` /
  `Histogram`) with `NumberDataPoint` / `HistogramDataPoint`, plus
  `AggregationTemporality`.
- `@otelux/protocol`: `ListMetricsQuery` / result, `listMetrics` on
  `DataSource`, `ChangeEvent` gains `{ kind: 'metricsChanged' }`.

Receiver:
- `decodeExportMetricsServiceRequest`; `POST /v1/metrics` route (same lenient
  JSON contract as logs/traces).

Engine:
- Metric points storage; `ingestMetrics` + `metricsChanged`.
- Aggregation helpers (rate from delta sums, percentile from histogram
  buckets), grouped by meter/instrument and attribute dimensions.
- **Decision point:** introduce DuckDB-wasm only if SQLite cannot meet the
  100 ms chart query budget at 100k points (see [spec.md §10](spec.md)).

UI (`@otelux/ui`, features per Aspire `Metrics`):
- `MeterTree` — meter → instrument tree selector with per-instrument
  descriptions; deep-linkable routes (resource → meter → instrument).
- `MetricChart` — per-instrument chart with **graph and table views**
  (line for sums/gauges, histogram/heatmap for histograms via visx).
- Duration/time-window select; `DimensionFilter` for attribute dimensions.
- Exemplar markers → click jumps to the originating trace.

Verification:
- Decoder unit tests over a captured Codex `ExportMetricsServiceRequest`
  fixture (one Sum, one Histogram).
- End-to-end: drive a Codex session, assert `codex.api_request` and
  `codex.turn.e2e_duration_ms` render in `MetricChart` via `listMetrics`.

Exit criteria: users answer "what changed?" for a local service in OTelux,
and can chart Codex turn/token/latency metrics from a live session.

### Phase 4 — Services overview (3–5 weeks)

- Engine: service registry derived from `resource.attributes.service.*`.
  Per-service rollups (span count, error rate, p95 duration, log severity
  distribution).
- UI: `ServicesGrid`, per-service detail page combining recent traces,
  logs, key metrics, with cross-links.

### Phase 5 — Ingest production-readiness (3–6 weeks)

- OTLP/gRPC via `@grpc/grpc-js` for all three signals — the first time
  gRPC enters the receiver. Desktop default `4316`, extension default
  `4317`.
- Backpressure tuning, drop metrics surfaced in the UI.
- Crash safety verification under power-loss simulation.
- Optional simple auth token; CORS configurability.

### Phase 6 — Power features (4–8 weeks)

- Trace search by attribute (`http.method=POST AND http.status_code>=500`).
- Saved views.
- Span links graph.
- Synthesized peer resolution (db/http/queue) on the waterfall.
- Service map (nodes + edges from traces).
- Telemetry export/import (zip of SQLite + metadata) for shareable repros.
- FTS5-powered global search.
- Waterfall Canvas renderer for >5k spans (same component API).

### Phase 7 — macOS and Windows desktop (3–6 weeks)

- Add macOS and Windows targets to electron-builder.
- DMG, MSIX, AppImage, deb, rpm artifacts in CI.
- Platform-specific menus, system tray, default window placement.
- macOS notarization, Windows EV signing.
- electron-updater for in-app updates.

### Phase 8 — Web demo and `@otelux/engine-wasm` (2–4 weeks)

- `@otelux/engine-wasm`: `@sqlite.org/sqlite-wasm` + OPFS adapter, sharing
  the engine test suite with `engine-node`.
- `apps/web-demo`: pure-browser viewer with bundled fixtures. Deployed to
  GitHub Pages on every main push. Useful as a "try OTelux" link and as a
  CSP-clean test harness.

### Phase 9 — VS Code extension marketplace publish (1–2 weeks)

The extension itself ships in M1 alongside the desktop app (see Phase 1
Tracks H/I/J). This phase only covers the marketplace-publish work:

- `@otelux/adapter-vscode` published to npm.
- `apps/vscode-extension` published to the VS Code Marketplace and Open
  VSX, with screenshots, GIFs, and listing copy.
- `docs/integrations/vscode.md` recipe for users who want to embed
  `@otelux/ui` in their own extension via `@otelux/adapter-vscode`.

### Phase 10 — Accessibility audit and localization scaffolding (3–6 weeks)

- Full keyboard reachability, screen reader labels, high-contrast
  verification across the app.
- Localization scaffold with English baseline.

### Phase 11 — Profiles (4–8 weeks)

- OTLP profile ingest, sample/frame/label storage.
- `FlameGraph` component (Canvas-backed for performance).
- Trace ↔ profile correlation.

### Phase 12 — Tauri swap (optional)

Decide whether to stay on Electron or move to Tauri 2 + Node sidecar based
on Electron binary size complaints and any blocking limitation. UI and
engine packages are unchanged either way; only `apps/desktop` is rewritten.

### Phase 13 — Optional GenAI assistant

Strictly optional, fully off by default, pluggable backend, clear privacy
story. May never ship.

---

## 4. Cross-cutting tracks

### 4.1 Testing strategy

- `@otelux/types` — type tests via `tsd`.
- `@otelux/engine` — unit tests per module; parity tests against fixtures.
- `@otelux/engine-node` / `engine-wasm` — same suite parameterized over
  storage adapters.
- `@otelux/ui` — Storybook stories double as test surface; Playwright
  visual snapshots for representative states (loaded, empty, error,
  selected, dark, high-contrast).
- `@otelux/receiver` — integration tests posting OTLP payloads against an
  ephemeral SQLite DB.
- `apps/*` — smoke E2E with Playwright.
- Fuzzing on OTLP decoders once stable.

### 4.2 Packaging and distribution

- During M1, every `@otelux/*` package is a private workspace package
  consumed by `apps/desktop` and `apps/vscode-extension` via workspace
  links. Public npm publish is gated on M1 shipping, not the other way
  around — we only publish contracts that have shaken out against two
  real consumers.
- Packages: MIT, semver via Changesets. First public npm publish wave
  happens at the start of Phase 9 (marketplace publish), once the
  extension itself is going public.
- Desktop app: electron-builder → `.AppImage` and `.deb` in M1, full
  `.DMG`/`.MSIX`/`.rpm` set added in Phase 7, electron-updater added
  alongside.
- VS Code extension: `.vsix` artifact per `main` commit during M1;
  marketplace + Open VSX publish in Phase 9.
- Web demo: GitHub Pages, auto-deployed (Phase 8).

### 4.3 Documentation

- `docs/spec.md` — what we are building (this file's sibling).
- `docs/plan.md` — this file.
- `docs/m1-verification.md` — added in Phase 1, the manual checklist for
  M1 done.
- `docs/integrations/*.md` — added when each integration lands.
- `packages/*/README.md` — per-package usage docs.
- Storybook is the live UI doc.

### 4.4 Telemetry about OTelux itself

Off by default. Optional, opt-in, local-only diagnostics file.

---

## 5. How to execute this plan

- **One phase at a time.** Finish before opening the next. Re-audit at the
  start of each phase and update this file's "Honest audit" section.
- **Atomic commits**, conventional commit style, each touching code +
  tests + docs together.
- **Changesets** every PR that affects a published package (once publishing
  starts after M1).
- **Performance and a11y checks** are part of every PR that touches
  `@otelux/ui` or `apps/desktop`.

Slow is fine. Compounding wins. M1 first.
