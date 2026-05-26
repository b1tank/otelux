# OTelux — Specification

Version: 3.0
Updated: 2026-05-13

OTelux is a local-first OpenTelemetry workbench. It receives traces, logs,
metrics, and (later) profiles from local applications, stores them on disk,
and presents them through a fast, embeddable viewer.

The shipping vehicle is a **cross-platform desktop app**, starting with Linux.
The viewer itself is built as a set of **reusable npm packages** so it can
also be embedded in other surfaces (for example, a VS Code extension webview
that watches local agent telemetry) without forking the codebase.

This document fixes **what** OTelux is: principles, scope, signals,
packages, tech stack, boundaries, and budgets. Delivery sequencing lives in
[plan.md](plan.md).

---

## 1. Product principles

| Principle | Direction |
|---|---|
| Local-first, single-user | No cloud, no auth, no multi-tenant in the core. Embedders can layer that on. |
| One codebase, many surfaces | Desktop app, VS Code-style webview embeds, and pure-browser demos all consume the same packages. |
| Package-first, app-second | Every feature lives in a package; apps are thin assemblies. |
| Embed-friendly | Webview-safe: CSP-clean, postMessage-friendly, themable through CSS variables. |
| Slow is fine | Best product eventually, not fastest demo. One signal at a time, end to end. |
| A11y is part of done | Keyboard nav, ARIA, focus rings, roving tabindex from day one. |
| Performance budgets bind | Treat regressions as bugs. |

---

## 2. Signals in scope

| Signal | In core? | Notes |
|---|---|---|
| Traces | Yes | Trace list, waterfall, span detail, search, filters. |
| Structured logs | Yes | Severity-aware table, log detail, trace correlation. |
| Metrics | Yes | Gauges, sums, histograms; charts and meter browser. |
| Services overview | Yes | Derived from OTLP `resource.attributes.service.*`. |
| Profiles | Later | Flame graph + correlation; defined in a later milestone. |
| GenAI assistant | No | Optional, off by default, may never ship. |

---

## 3. Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                                Apps                                  │
│  apps/desktop (Electron)   apps/web-demo   apps/vscode-example       │
├──────────────────────────────────────────────────────────────────────┤
│                            Adapters                                  │
│  @otelux/adapter-direct   @otelux/adapter-vscode   (later: tauri)    │
├──────────────────────────────────────────────────────────────────────┤
│        @otelux/ui (React)       │       @otelux/receiver (Node)      │
│  Waterfall, TraceList, SpanDet, │  OTLP/HTTP (Hono); gRPC in Phase 5 │
│  LogsTable, MetricChart, ...    │  writes via the engine ingest API  │
├──────────────────────────────────────┴──────────────────────────────────┤
│                      @otelux/mcp-server (Node)                       │
│  Read-only JSON-RPC dispatcher over @otelux/engine; HTTP + stdio.    │
├──────────────────────────────────────────────────────────────────────┤
│                          @otelux/protocol                            │
│  DataSource interface + { query → result } message shapes            │
├──────────────────────────────────────────────────────────────────────┤
│                          @otelux/engine                              │
│  ingest │ query │ layout │ live subscription (pure TS, no I/O)       │
│         │       │        │                                           │
│  @otelux/engine-node (node:sqlite)    @otelux/engine-wasm (OPFS)     │
├──────────────────────────────────────────────────────────────────────┤
│                          @otelux/types                               │
│  OTLP types (Trace, Span, Log, Metric, Resource)                     │
└──────────────────────────────────────────────────────────────────────┘
```

The load-bearing decision is the `DataSource` interface in `@otelux/protocol`:

```ts
interface DataSource {
  listTraces(q: ListTracesQuery): Promise<ListTracesResult>;
  getTrace(traceId: string): Promise<TraceWithSpans>;
  getSpanDetails(spanId: string): Promise<SpanDetails>;
  // …same shape for logs, metrics, services…
  subscribe?(handler: (event: ChangeEvent) => void): Disposable;
}
```

`@otelux/ui` consumes a `DataSource`. Three adapters fulfill it identically:

- **`adapter-direct`** — wraps an engine instance. Used by the desktop app
  (renderer talking to the main process) and the web demo.
- **`adapter-vscode`** — postMessage round-trip between a webview and an
  extension host that owns the engine. Lands in M1 alongside the
  VS Code extension; see [plan.md Phase 1](plan.md).
- **`adapter-tauri`** (later) — Tauri IPC.

`@otelux/mcp-server` is a fourth consumer of the engine: it exposes a
read-only Model Context Protocol surface over JSON-RPC (HTTP and stdio
transports). Both `apps/desktop` and `apps/vscode-extension` mount it on
the same engine instance, so external coding agents (Codex, Claude Code,
Cursor) get the same view as the local UI without ever touching the
`DataSource` boundary.

---

## 4. Packages (frozen contracts)

Every package is MIT, published to npm under `@otelux/*` from this repo.

| Package | Purpose | Runtime |
|---|---|---|
| `@otelux/types` | OTLP TS types. | iso |
| `@otelux/engine` | Pure-TS query, layout, ingest, agent-run detection. Pluggable storage. | iso |
| `@otelux/engine-node` | `node:sqlite` storage adapter. | node |
| `@otelux/engine-wasm` | `@sqlite.org/sqlite-wasm` + OPFS storage adapter. | browser |
| `@otelux/protocol` | `DataSource` interface + typed query/result shapes. | iso |
| `@otelux/ui` | React components: Waterfall, TraceList, SpanDetail, LogsTable, MetricChart, ServiceMap, Toolbar, theme. | browser |
| `@otelux/adapter-direct` | In-process `DataSource`. | iso |
| `@otelux/adapter-vscode` | postMessage `DataSource` for VS Code webviews + `serve()` helper for extension host. Ships in M1. | browser/node split |
| `@otelux/adapter-tauri` (later) | Tauri IPC `DataSource`. | browser |
| `@otelux/receiver` | OTLP/HTTP receiver (Hono) with single-instance lock and cross-process handoff. gRPC added in Phase 5. | node |
| `@otelux/mcp-server` | Read-only Model Context Protocol dispatcher over `@otelux/engine`; HTTP and stdio transports. Consumed by desktop and extension. | node |

Apps live under `apps/` and are not published to npm:

| App | Purpose |
|---|---|
| `apps/desktop` | Electron shell hosting `@otelux/receiver` + `@otelux/mcp-server` in main, `@otelux/ui` in renderer. The headline product. |
| `apps/vscode-extension` | VS Code extension hosting `@otelux/receiver` + `@otelux/mcp-server` in the extension host, `@otelux/ui` in a webview via `@otelux/adapter-vscode`, and registering VS Code Language-Model Tools that wrap `@otelux/engine` queries. Ships in M1 alongside `apps/desktop`. |
| `apps/web-demo` | Pure-browser demo on GitHub Pages; SQLite-WASM + fixtures. Phase 8. |

---

## 5. Tech stack (frozen)

| Layer | Pick |
|---|---|
| Language | **TypeScript** everywhere, strict mode. |
| Package manager | **npm** workspaces. |
| Monorepo orchestration | **Turborepo**. |
| Library bundling | **tsup** (ESM + CJS + types). |
| App bundling | **Vite**. |
| Test runner | **Vitest**. |
| Component workshop | **Storybook 8** (React-Vite framework). _Planned; not yet adopted — see [plan.md](plan.md)._ |
| E2E / visual regression | **Playwright**. |
| Lint + format | **Biome**, fall back to ESLint+Prettier only if Biome blocks. |
| Versioning + releases | **Changesets**. |
| UI framework | **React 18**. |
| UI styling | **CSS Modules + CSS variables**. Theme tokens map to `--vscode-*` when present, with `--otelux-*` fallbacks. |
| UI primitives | **Radix UI Primitives**. |
| Tables + virtualization | **TanStack Table + TanStack Virtual**. |
| Charts | **visx**. Waterfall: SVG below ~5k spans, Canvas above. |
| State | **Zustand**. |
| Async data | **TanStack Query**. |
| Icons | **Lucide React**, swappable via icon-slot prop (so VS Code can use codicons). |
| Node SQLite | **`node:sqlite`** (Node 22+ built-in, no native compile). |
| Browser SQLite | **`@sqlite.org/sqlite-wasm`** with OPFS persistence. |
| OTLP decoders | **`@opentelemetry/otlp-transformer`** + **`@opentelemetry/proto`**. |
| HTTP receiver | **Hono**. |
| gRPC receiver | **`@grpc/grpc-js`** (deferred to Phase 5 — M1 ships HTTP only). |
| MCP transport | Hand-written JSON-RPC dispatcher in `@otelux/mcp-server`; HTTP via Hono, stdio via Node streams. |
| Desktop shell | **Electron** + **electron-builder**. Tauri 2 only if size matters later. |
| Analytical engine | None initially. DuckDB-wasm reserved as an escape hatch for metrics if SQLite query budgets slip. |

### 5.1 Bundling per app

Each consumer assembles the same packages with different bundlers and
targets. The matrix is part of the contract — changing it later breaks
either the webview CSP, the Electron sandbox, or the extension host.

| App entry | Bundler | Format | Target | Notes |
|---|---|---|---|---|
| `apps/desktop` main process | electron-vite | CJS | Node 22 | Hosts `@otelux/receiver`, `@otelux/engine-node`, `@otelux/mcp-server`. |
| `apps/desktop` preload | electron-vite | CJS | Node 22 | Exposes `@otelux/adapter-direct` IPC. |
| `apps/desktop` renderer | electron-vite | ESM | Chromium | Imports `@otelux/ui`. |
| `apps/vscode-extension` host entry | esbuild | CJS | Node 22 | `external: ['vscode']`; hosts `@otelux/receiver`, `@otelux/engine-node`, `@otelux/mcp-server`, registers Language-Model Tools. |
| `apps/vscode-extension` webview entry | Vite | ESM | Chromium | CSP-clean; imports `@otelux/ui` + `@otelux/adapter-vscode/client`. |
| `apps/web-demo` | Vite | ESM | Chromium | Imports `@otelux/ui` + `@otelux/engine-wasm`. |
| `@otelux/*` libraries | tsup | ESM + CJS + dts | iso | Each library declares `"browser"` and `"default"` package exports so webview, Electron renderer, and Node consumers all resolve correctly. |

---

## 6. Boundaries (non-negotiable)

1. **`@otelux/ui` never imports `@otelux/engine`.** It accepts a `DataSource`.
2. **`@otelux/engine` knows nothing about React or DOM.** Pure TS, runs in
   browser, Node, and Web Workers.
3. **`@otelux/protocol` is the single source of truth** for query/result
   shapes. Every adapter implements it identically.
4. **No native modules** in any published package. `node:sqlite` is built-in
   to Node 22+, not a native dependency.
5. **No CSP-hostile dependencies.** No `eval`, no `new Function`, no
   inline-style injection by libraries. Production Vite builds must pass
   under a strict `script-src 'nonce-*'` CSP. Lint enforces this.
6. **Theme is a CSS-variable contract**, not a JS theme object. Consumers
   override `--otelux-*` tokens. Webview embedders that expose `--vscode-*`
   variables get correct theming automatically through the default mapping.
7. **A11y is part of every UI PR.** Keyboard nav, ARIA roles, focus rings,
   roving tabindex. Not deferred to a polish phase.
8. **Tests are non-negotiable.** Engine: unit + fixture parity. UI: Storybook
   stories + Playwright visual snapshots. Apps: smoke E2E.

---

## 7. Embedding consumers

The viewer is designed to live inside other host applications. The first
external embedder we plan for is a VS Code extension that monitors local
agent telemetry — but nothing in the package architecture is VS Code-specific.

A typical embedder splits work across two runtimes:

```ts
// host process (Node) — runs the engine
import { createEngine } from '@otelux/engine';
import { createNodeSqliteStorage } from '@otelux/engine-node';
import { serveDataSource } from '@otelux/adapter-vscode/server';

const engine = createEngine({
  storage: createNodeSqliteStorage({ path: dbPath }),
});

hostSpanSource.onSpan(span => engine.ingestSpan(span));

const panel = host.createWebview(/* … */);
serveDataSource(panel.webview, engine);
```

```tsx
// embedded webview (browser) — renders the UI
import { OTeluxWorkbench } from '@otelux/ui';
import { createPostMessageDataSource } from '@otelux/adapter-vscode/client';

const ds = createPostMessageDataSource(acquireHostApi());
root.render(<OTeluxWorkbench dataSource={ds} theme="host" />);
```

Constraints honored by design (informed by VS Code webview rules, which are
the strictest case we plan for):

- Sandboxed webview → UI is plain browser code, no Node, no fs.
- Host ↔ webview is postMessage only → async `DataSource` over serializable
  messages.
- CSP forbids `eval` → no eval-using deps; Vite production build is
  CSP-clean. Lint enforces this.
- Asset loading is gated → UI ships as a self-contained bundle.
- Theming via host CSS variables → default theme maps `--otelux-*` onto
  whatever variables the host exposes (e.g. `--vscode-*`).
- Bundle size matters → tree-shakeable per-component imports.

When an external project wants to consume `@otelux/*` without a direct npm
dependency (for example, a host with a strict external-dependency policy),
the recommended pattern is to **vendor** the relevant package tarballs
into its own source tree at a pinned version.

### 7.1 Port assignments and single-instance handoff

The receiver runs in whatever process owns the engine — the Electron
main process for desktop, the extension host for the VS Code extension.
Users may have one or both installed and may run multiple VS Code
windows. Ports cannot collide.

**Defaults:**

| Consumer | OTLP/HTTP | OTLP/gRPC | UI / MCP HTTP | Rationale |
|---|---|---|---|---|
| `apps/desktop` | `4319` | (Phase 5) `4316` | n/a (local IPC) | Off-by-one from the OTel standard ports so the desktop app never fights a user's standalone collector. |
| `apps/vscode-extension` | `4318` | (Phase 5) `4317` | `3000` (configurable) | Matches the OTel standard; users point any SDK at `localhost:4318` with zero config. |

All defaults are overridable through settings and via
`OTELUX_OTLP_HTTP_PORT` / `OTELUX_OTLP_GRPC_PORT` env vars. The receiver
is a single source of truth — both desktop and extension consume it.

**Single-instance handoff** is a `@otelux/receiver` concern, not a
per-app concern. The package exposes a `claimSingleInstance({ port })`
helper that:

1. Tries to `listen` on the requested port and, on success, claims a
   lockfile in the OS temp directory recording the listener PID, the
   process kind (`desktop` / `vscode-extension`), and the engine RPC
   endpoint.
2. On `EADDRINUSE`, reads the lockfile and decides:
   - Same process kind + healthy probe → the second instance hands its
     work off to the first via the engine RPC endpoint and runs in
     "client" mode (UI only, no receiver, no MCP server).
   - Incompatible process or unreachable → surface a clear startup error
     ("another OTelux receiver is already on `4318`") with the conflicting
     PID.
3. Releases the lockfile on graceful shutdown.

This is the same pattern used by `vscode-otelme` and Splunk's
`observability-studio`, reimplemented in TypeScript inside the package so
the desktop and extension behave identically.

---

## 8. Performance budgets

Treat regressions as bugs.

| Surface | Budget |
|---|---|
| Cold start to first paint | < 300 ms warm cache |
| Trace list page query | < 50 ms at 100k spans |
| Waterfall layout | < 16 ms at 10k visible rows |
| Log table query | < 100 ms at 1M rows with index hits |
| Metric chart query | < 100 ms at 100k points |
| Sustained ingest | > 10k spans/sec on a developer laptop |
| `@otelux/ui` gzipped (no charts) | < 80 kB |
| `@otelux/ui` gzipped (with charts) | < 200 kB |
| Memory | Idle UI memory dominated by data, not framework. |

---

## 9. Acceptance per package (definition of done)

| Package | Done when |
|---|---|
| `@otelux/types` | All OTLP signal types covered, `tsd` type tests green, no runtime exports. |
| `@otelux/engine` | Ingest, query, layout, subscribe APIs stable. Storage interface fully abstracted. Fixture parity tests pass. |
| `@otelux/engine-node` | `engine` test suite green against `node:sqlite`. WAL pragma + schema versioning + retention proven. |
| `@otelux/engine-wasm` | `engine` test suite green against `sqlite-wasm` + OPFS. |
| `@otelux/protocol` | All query/result shapes versioned; `DataSource` interface frozen for a major release. |
| `@otelux/ui` | Every component has Storybook stories (loaded, empty, error, selected, dark, high-contrast). Playwright visual snapshots in CI. Keyboard nav verified per component. CSP-clean production build verified. |
| `@otelux/adapter-vscode` | Round-trip latency budget met on the M1 extension. Webview CSP and theme integration verified. |
| `@otelux/receiver` | OTLP/HTTP JSON+protobuf accepted for all signals in scope; ingest throughput budget met; `claimSingleInstance` proven by integration tests with two competing processes. gRPC adds same coverage in Phase 5. |
| `@otelux/mcp-server` | All MCP tools backed by `@otelux/engine` queries; HTTP + stdio transports; protocol-version negotiation; integration tests against a real Codex/Claude/Cursor MCP client. |
| `apps/desktop` | Cold-start budget met; ships installable artifacts for Linux first, then macOS and Windows. Auto-update wired in a later phase. |
| `apps/vscode-extension` | Loads in current VS Code stable; ingests OTLP without configuration; UI theme-correct in light/dark/high-contrast; LM Tools registered and callable from Copilot Chat; MCP server discoverable by external agents via one-click configure commands. |
| `apps/web-demo` | Deployed to GitHub Pages on every main push. CSP-clean. |

---

## 10. Open questions (re-evaluate as we go)

1. **DuckDB for metrics** — decide at the metrics-phase boundary based on
   observed SQLite query times against 100k–1M metric points.
2. **Tauri swap** — decide later based on Electron binary size complaints
   and any blocking limitation.
3. **Public docs site stack** — VitePress vs Docusaurus vs Astro Starlight;
   decide when a docs site becomes useful.
4. **GenAI assistant** — strictly optional, may never ship. Default: no.

---

## 11. Verification loop

Every change runs:

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Each command goes through Turborepo so only affected packages rebuild.

> The commands below are forward-looking — the corresponding scripts and
> apps (`web-demo`, `vscode-example`, Storybook, Playwright) land
> alongside the matching phases in `plan.md` and are not yet present in
> the workspace.

UI changes additionally pass:

```sh
npm run storybook -- --ci          # build static Storybook
npm run test:visual                # Playwright visual snapshots
```

App changes additionally pass:

```sh
npm run test:e2e -w apps/desktop
npm run test:e2e -w apps/web-demo
npm run test:e2e -w apps/vscode-example
```

A green pipeline on Ubuntu (and later macOS and Windows) × Node 22 LTS is
the floor.

---

## 12. Agent integration surfaces

The viewer is consumed by two kinds of agents: the user (a human) and AI
coding agents (Copilot in VS Code, plus external agents like Codex,
Claude Code, Cursor). The product principle is that **anything an AI
agent can see, the desktop app can also see**, so the agent surface is
implemented as packages, not as VS-Code-only code.

### 12.1 Surfaces and where they live

| Surface | Consumer | Where it lives | Available in |
|---|---|---|---|
| `DataSource` queries | Human UI | `@otelux/protocol` + `@otelux/ui` | Desktop + extension |
| MCP JSON-RPC tools | External AI agents (Codex, Claude, Cursor) | `@otelux/mcp-server` (HTTP + stdio) | Desktop + extension |
| VS Code Language-Model Tools | Copilot in VS Code | `apps/vscode-extension` (thin wrappers over `@otelux/engine`) | Extension only — the only genuinely extension-specific surface |
| One-click "Enable Codex / Claude Code / Cursor integration" | External AI agents | `apps/vscode-extension` first; promoted to `@otelux/agent-config` package once a second consumer needs it | Extension first, desktop later |

### 12.2 Agent-run correlation

Copilot agent mode and other AI coding agents already emit OTel-shaped
traces of their own work (tool calls, model requests, retries). When a
user instruments their app with OTel and runs it under such an agent,
both span streams land in the same `@otelux/engine` store. The engine
recognizes "agent runs" as a first-class derived entity and exposes
queries to:

- list agent runs in a time window,
- fetch the user-app spans that occurred during a given agent run,
- join an agent's tool-call span to the user-app trace it triggered,
  using either trace-context propagation or a timestamp + run-id heuristic
  when propagation is not present.

Because this logic lives in `@otelux/engine`, the desktop app shows an
"Agent runs" pane for free, the VS Code extension exposes the same
lookups as LM Tools, and external MCP clients can call them as MCP tools.
No per-consumer duplication.

### 12.3 MCP tool surface

The initial read-only MCP tool set, mirrored by VS Code LM Tools, covers
the four canonical troubleshooting questions:

| Tool | Question |
|---|---|
| `otel_find_recent_errors` | What just broke? |
| `otel_get_slowest_spans` | What's slow? |
| `otel_search_logs` | Why did this log fire? |
| `otel_correlate_agent_run` | What was my app doing during this agent run? |
| `otel_get_trace` / `otel_get_span_details` | Drill-down primitives. |
| `otel_get_service_overview` | What services emitted telemetry? |

All tools are thin wrappers over `@otelux/engine` query methods and ship
in both `@otelux/mcp-server` and the extension's LM Tools layer.
