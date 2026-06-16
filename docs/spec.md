# OTelux — Specification

Updated: 2026-06-16

OTelux is a local-first OpenTelemetry workbench. It receives local telemetry, keeps it on the user's machine, renders it in a dense debugging UI, and exposes read-only query tools to local coding agents.

This document defines what the product is. Delivery sequencing lives in [plan.md](plan.md). The project pitch lives in [proposal.md](proposal.md).

## Product Principles

| Principle | Meaning |
|---|---|
| Local-first | No cloud account, no backend dependency, no multi-tenant core. |
| Workbench, not dashboard | Dense comparison where users scan rows; spacious detail where users inspect one item. |
| One engine, many hosts | Desktop, VS Code, and agent tools query the same engine data. |
| Package-first | Shared behavior belongs in `packages/*`; apps assemble packages. |
| Embed-friendly | UI is browser-safe, themeable through CSS variables, and usable inside webviews. |
| A11y is part of done | Keyboard access, focus states, labels, and readable high-contrast states are required. |
| Performance budgets bind | Slow query, layout, or ingest regressions are product bugs. |

## Current Baseline

The repository currently contains:

- `apps/desktop`: Electron app hosting the receiver, engine, MCP server, IPC, settings, and React renderer.
- `apps/vscode-extension`: VS Code extension shell with embedded receiver, MCP server, webview workbench, and LM Tool registration.
- OTLP/HTTP JSON ingest for traces, logs, and metrics.
- In-memory storage for all signals.
- Live Traces, Logs, and Metrics rail surfaces in `@otelux/ui`.
- Direct and VS Code postMessage `DataSource` adapters.
- MCP and LM tool plumbing over the same query layer.

Important current limits:

- `@otelux/engine-node` currently forwards to memory storage. Durable `node:sqlite` storage is planned, not shipped.
- Protobuf and gRPC ingest are planned, not shipped.
- Logs and dense trace modes need real grid polish.
- Agent-run correlation and service overview tools are schema-stable but not fully implemented.

## Signals In Scope

| Signal | Status | Product surface |
|---|---|---|
| Traces | Live | Trace list, waterfall, span details, filters. |
| Structured logs | Live | Severity-aware rows, search, details, attributes. Needs grid polish. |
| Metrics | Live | Meter grouping, instrument cards, graph/table views. |
| Services overview | Planned | Derived service rollups across traces, logs, and metrics. |
| Profiles | Later | Flame graph and trace/profile correlation. |

The reference dogfood workload is Codex CLI telemetry. Its user-visible content rides the logs pipeline, while latency and token information ride metrics and traces. That is why OTelux treats logs and metrics as core signals rather than follow-on decoration.

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Apps                                                         │
│   apps/desktop            apps/vscode-extension              │
├──────────────────────────────────────────────────────────────┤
│ UI adapters                                                  │
│   @otelux/adapter-direct  @otelux/adapter-vscode             │
├──────────────────────────────────────────────────────────────┤
│ @otelux/ui                                                   │
│   Traces, Logs, Metrics, details, primitives, theme tokens    │
├──────────────────────────────────────────────────────────────┤
│ @otelux/protocol                                             │
│   DataSource interface and query/result shapes                │
├──────────────────────────────────────────────────────────────┤
│ @otelux/engine                                               │
│   ingest, query, layout, live subscription, storage boundary   │
├──────────────────────────────────────────────────────────────┤
│ Storage                                                      │
│   memory today; @otelux/engine-node SQLite planned            │
├──────────────────────────────────────────────────────────────┤
│ Ingest and agent tools                                       │
│   @otelux/receiver      @otelux/mcp-server      VS Code tools │
└──────────────────────────────────────────────────────────────┘
```

The load-bearing boundary is `DataSource` from `@otelux/protocol`. The UI asks for telemetry through this interface. Hosts decide whether the request is served directly, over Electron IPC, or over VS Code postMessage.

The engine is the source of truth for ingest, query, layout, and subscriptions. The receiver writes into it. The UI and agent tools read from it.

## Packages

| Package | Purpose | Current state |
|---|---|---|
| `@otelux/types` | Shared trace, log, metric, resource, scope, and attribute types. | Live. |
| `@otelux/protocol` | `DataSource` interface and query/result contracts. | Live for traces/logs/metrics. |
| `@otelux/engine` | Pure TypeScript ingest, query, layout, subscriptions, memory storage. | Live. |
| `@otelux/engine-node` | Node storage package. | Placeholder that currently uses memory storage; SQLite planned. |
| `@otelux/receiver` | OTLP/HTTP receiver and single-instance helper. | JSON routes live for traces/logs/metrics. |
| `@otelux/ui` | React workbench and primitives. | Traces/logs/metrics live; polish ongoing. |
| `@otelux/adapter-direct` | In-process `DataSource` wrapper. | Live. |
| `@otelux/adapter-vscode` | VS Code webview postMessage `DataSource` bridge. | Live. |
| `@otelux/mcp-server` | Read-only MCP JSON-RPC dispatcher. | Live with some stubbed tools. |

Apps are not published packages:

| App | Purpose | Current state |
|---|---|---|
| `apps/desktop` | Main Electron workbench. | Runnable Linux-focused pre-release. |
| `apps/vscode-extension` | VS Code-hosted workbench plus MCP/LM tools. | Shell implemented; needs hardening and packaging. |

Future packages or apps, such as a WASM storage adapter or web demo, should be added to this spec when they enter active implementation.

## Technology

| Layer | Choice |
|---|---|
| Language | TypeScript strict mode. |
| Package manager | npm workspaces. |
| Monorepo orchestration | Turborepo. |
| Lint/format | Biome. |
| Tests | Vitest. |
| Desktop | Electron, electron-vite, electron-builder. |
| VS Code extension | esbuild host bundle, Vite webview bundle. |
| UI | React 18, CSS variables, hand-rolled primitives where small. |
| Receiver | Hono over Node. |
| Agent protocol | Hand-written MCP JSON-RPC dispatcher with HTTP and stdio transports. |
| Storage | Memory today; Node 22 `node:sqlite` planned. |

Do not document dependencies as adopted until they are present in manifests and used by code. Storybook, Playwright visual snapshots, TanStack, Radix, visx, Zustand, SQLite-WASM, protobuf, and gRPC remain future decisions unless added by implementation.

## Receiver Contract

The receiver accepts OTLP/HTTP JSON today:

| Route | Body | Result |
|---|---|---|
| `POST /v1/traces` | `ExportTraceServiceRequest` JSON | `{ "partialSuccess": {} }` on success. |
| `POST /v1/logs` | `ExportLogsServiceRequest` JSON | `{ "partialSuccess": {} }` on success. |
| `POST /v1/metrics` | `ExportMetricsServiceRequest` JSON | `{ "partialSuccess": {} }` on success. |
| `GET /healthz` | none | `ok`. |

Malformed JSON returns `400`. Unknown routes return `404`. The default host is `127.0.0.1` so a desktop install is not exposed on the LAN unless explicitly configured by a host.

Planned receiver work:

- OTLP/HTTP protobuf.
- OTLP/gRPC.
- Backpressure and dropped-record counters.
- Optional local auth token and configurable CORS.

## Port Defaults

| Consumer | OTLP/HTTP | MCP HTTP | Notes |
|---|---:|---:|---|
| Desktop | `4319` | host-controlled | Avoids colliding with a user's standard collector on `4318`. |
| VS Code extension | `4318` | `4319` by default | Standard OTLP endpoint for editor-local ingest. |

Ports are host settings. The receiver package also exposes single-instance claiming so hosts can handle collisions deliberately.

## Data Model And Query Contracts

The `DataSource` contract covers:

- `listTraces`, `getTrace`, `getSpanDetails`.
- `listLogs`.
- `listMetrics`.
- `subscribe` for trace/log/metric change events.

Queries should be bounded by limit and filters. Results should include counts where the UI needs to show scope. Optional fields should not be passed as explicit `undefined` in TypeScript code because `exactOptionalPropertyTypes` is enabled.

## Telemetry Workbench UX Requirements

### Workbench Principles

- Every dense signal needs real grid behavior: sticky column headers, visible sort state, keyboardable headers, and predictable column widths.
- Toolbars are operational controls, not decoration. Search, service filters, severity/status filters, pause/resume, and clear should be direct and visible.
- Summary/detail is reusable. Selecting a trace, span, log, or metric preserves list context and opens a predictable details area.
- Details panes are searchable. Span and log details need internal search over property names and values.
- Property sections expose counts before expansion.
- Rows expose actions consistently: details, copy, value viewer, and pivots.
- Long values use the full value viewer wherever messages, attributes, JSON, XML, Markdown, or multiline text exceed the pane.
- Footer and empty states communicate result scope, live/paused state, and the expected table shape.
- Endpoint state is explicit: listening port, health, paused/live state, and local trust posture are visible to the user.

### Logs Requirements

- Logs must have visible and semantic column headers for Level, Time, Service, Message, Trace, and Actions.
- Logs with trace/span IDs expose a shortened trace pivot in the row.
- Row actions include View details, Copy message, Copy trace/span IDs, and Open value viewer.
- Empty and loading states keep the table header and column layout visible.
- The details pane shows log facts, attributes, resource, and scope, with section counts and internal search.

### Trace Requirements

- The narrow trace list can stay card-like for scannability.
- Full-width or dense trace-list mode should expose table-like headers and sort affordances.
- Sort options should include timestamp, duration, span count, error count, and name when backed by the data source.
- Waterfall rows should support selection, copy/detail actions, and later log markers for logs emitted inside spans.
- Closing span details must not lose the selected span unexpectedly.

### Metrics Requirements

- Metrics are grouped by meter/scope and instrument.
- Instruments show type, unit, description when present, and current service context when known.
- Graph and table modes are both first-class. The table is the exact-value fallback when charts are not enough.
- Future exemplar markers should pivot to the originating trace.

### Cross-Signal Requirements

- Pause/resume and clear data apply across traces, logs, and metrics.
- Result footers show `Showing N ...` and live/paused state outside the scroll region.
- Active filters show a count and a clear affordance.
- Service is the user-facing label. Raw OTel resource attributes belong in details.
- OTelux keeps its own visual language. Interaction patterns can be borrowed; brand chrome should not be copied from other tools.
- AI explain buttons are not a core feature. Hosts may layer assistance on top of deterministic local data.

## Agent Tool Surface

Initial MCP tools, mirrored where useful by VS Code LM Tools:

| Tool | Status | Question |
|---|---|---|
| `otel_find_recent_errors` | Live | What just broke? |
| `otel_get_slowest_spans` | Live | What is slow? |
| `otel_search_logs` | Live | Why did this log fire? |
| `otel_get_trace` | Live | Show this trace. |
| `otel_get_span_details` | Live | Show this span. |
| `otel_correlate_agent_run` | Stub | What was my app doing during this agent run? |
| `otel_get_service_overview` | Live, approximate | What services emitted telemetry? |

All tools are read-only. Tool handlers should stay thin wrappers over engine queries so desktop, extension, MCP, and LM tools do not fork behavior. Service overview currently derives recent service stats from trace summaries; richer cross-signal service rollups are planned.

## Reference Workload: Codex CLI

Codex CLI is the first concrete three-signal workload:

| Codex exporter | OTLP signal | Carries |
|---|---|---|
| logs exporter | Logs | Human-readable events, prompts when enabled, tool context. |
| trace exporter | Traces | Operation shape, spans, timing, status. |
| metrics exporter | Metrics | Request counts, tool counts, token usage, duration histograms. |

OTelux must support Codex by accepting full-path JSON endpoints:

```toml
[otel]
environment = "dev"
log_user_prompt = true

[otel.exporter.otlp-http]
endpoint = "http://localhost:4319/v1/logs"
protocol = "json"

[otel.trace_exporter.otlp-http]
endpoint = "http://localhost:4319/v1/traces"
protocol = "json"

[otel.metrics_exporter.otlp-http]
endpoint = "http://localhost:4319/v1/metrics"
protocol = "json"
```

Acceptance for this workload:

- Logs, traces, and metrics ingest return OTLP partial-success responses.
- `codex.user_prompt` content is searchable through logs when enabled.
- Codex duration/token metrics appear in the Metrics view.
- Trace ingest remains unaffected by logs and metrics ingest.

## Performance Budgets

Treat these as targets until benchmark coverage exists:

| Surface | Budget |
|---|---:|
| Cold start to first paint | < 3 seconds in development, tighter for packaged builds. |
| Trace list query | < 100 ms for common local workloads. |
| Log search | < 150 ms for indexed local workloads after SQLite lands. |
| Metric chart query | < 150 ms for common local workloads after SQLite lands. |
| Waterfall layout | One frame for visible rows in typical traces. |
| UI interaction | No intentional blocking over one frame. |

Budgets should become stricter after durable storage and performance harnesses land.

## Verification

Routine verification:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Manual desktop verification lives in [test.md](test.md). UI/runtime smoke checks should use the repo's self-verification workflow.

## Open Questions

- When does the workbench need a separate Services surface versus compact service overview panels in existing views?
- How much column management is needed before durable storage makes row counts large enough to justify full data-grid behavior?
- Does a browser demo matter before desktop and VS Code are both hard enough for daily local use?
- Should MCP config writers live in the extension only, or graduate into a shared package after desktop needs them too?
