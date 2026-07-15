# OTelux — Specification

Updated: 2026-07-13

OTelux is a local-first OpenTelemetry workbench. It receives local telemetry, keeps it on the user's machine, renders it in a dense debugging UI, and exposes read-only query tools to local coding agents.

This document is the source of truth for what the product is, what is implemented now, and what behavior a supported release must provide. [plan.md](plan.md) owns future work, [test.md](test.md) owns release verification, and [proposal.md](proposal.md) owns the product rationale.

User operation lives in [getting-started.md](getting-started.md), data handling in [privacy.md](privacy.md), and trust boundaries in [security-model.md](security-model.md).

The **Current Baseline** and status tables are descriptive and must match the code. Sections labeled **Requirements** are normative product targets; an item there is not shipped unless the Current Baseline says it is live. Release-specific platform and feature limitations belong in release notes.

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
| No unsolicited egress | OTelux does not independently transmit captured telemetry. Data leaves OTelux only through explicit user actions or configured clients such as MCP or LM tools, whose own data-handling policies apply. Any future diagnostics or reporting is explicit, documented, and opt-in. |

## Current Baseline

The repository currently contains:

- `apps/desktop`: Electron app hosting the receiver, engine, MCP server, IPC, settings, and React renderer.
- `apps/vscode-extension`: VS Code extension shell with embedded receiver, MCP server, webview workbench, and LM Tool registration.
- OTLP/HTTP JSON and protobuf ingest for traces, logs, and metrics.
- Durable local storage for all signals via `@otelux/engine-node` (Node `node:sqlite`), with user-configurable retention (age and size). The store versions its schema (forward-only migrations) and self-heals an unreadable or newer-version file by quarantining it and starting fresh. `@otelux/engine` still ships an in-memory store for tests and small workloads; both back ends pass a shared storage-contract suite.
- Live Traces, Logs, and Metrics rail surfaces in `@otelux/ui`.
- A one-click "Load sample data" seed in the empty Traces view populates every surface with clearly-labelled synthetic telemetry, so a first-run user can evaluate the UI before wiring an exporter.
- Direct and VS Code postMessage `DataSource` adapters.
- MCP and LM tool plumbing over the same query layer.
- The desktop app is the release product. The VS Code extension is an experimental second host until its hardening phase is complete.

Important current limits:

- OTLP/gRPC ingest is planned, not shipped (OTLP/HTTP JSON and protobuf are live).
- Dense trace modes, detail search, and clear-data controls need polish.
- Agent-run correlation and service overview tools are schema-stable but not fully implemented.

## Signals In Scope

| Signal | Status | Product surface |
|---|---|---|
| Traces | Live | Trace list, waterfall, span details, filters. |
| Structured logs | Live | Headered rows, search, details, attributes, copy actions, trace/span pivots. |
| Metrics | Live | Meter/instrument explorer, focused graph/table views, scan summaries, details, copy actions. |
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
│   @otelux/engine memory; @otelux/engine-node node:sqlite      │
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
| `@otelux/engine-node` | Durable Node storage adapter (`node:sqlite`) with retention (age/size). | Live. |
| `@otelux/receiver` | OTLP/HTTP receiver and single-instance helper. | JSON routes live for traces/logs/metrics. |
| `@otelux/ui` | React workbench and primitives. | Traces/logs/metrics live; polish ongoing around details, grouping controls, and footer controls. |
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
| Storage | `@otelux/engine` in-memory (tests/small workloads); `@otelux/engine-node` durable Node 22 `node:sqlite` with retention. |

Do not document dependencies as adopted until they are present in manifests and used by code. Storybook, Playwright visual snapshots, TanStack, Radix, visx, Zustand, SQLite-WASM, and gRPC remain future decisions unless added by implementation.

## Receiver Contract

The receiver accepts OTLP/HTTP in both JSON and protobuf encodings, selected by `Content-Type`:

| Route | Body | Result |
|---|---|---|
| `POST /v1/traces` | `ExportTraceServiceRequest` (JSON or protobuf) | success response in the request encoding. |
| `POST /v1/logs` | `ExportLogsServiceRequest` (JSON or protobuf) | success response in the request encoding. |
| `POST /v1/metrics` | `ExportMetricsServiceRequest` (JSON or protobuf) | success response in the request encoding. |
| `GET /healthz` | none | `ok`. |

Encoding is chosen by `Content-Type`: `application/json` (JSON) or `application/x-protobuf` / `application/protobuf` (protobuf, the default for most OTel SDK exporters). On success a JSON request receives `{ "partialSuccess": {} }`; a protobuf request receives an empty `application/x-protobuf` body (a valid empty `ExportServiceResponse`). A malformed body returns `400`. A `POST` with any other content type returns `415 Unsupported Media Type` before the body is read. Request bodies larger than the configured limit are rejected with `413 Payload Too Large` before decoding. Unknown routes return `404`. The default host is `127.0.0.1` so a desktop install is not exposed on the LAN unless explicitly configured by a host.

Both loopback listeners enforce a browser-origin policy:

- Any request carrying an `Origin` header is rejected with `403` unless that origin is on an explicit allowlist (empty by default). This blocks a malicious web page or DNS-rebinding attempt from reaching the listener. Non-browser senders (OTel SDKs, CLIs, MCP clients) omit `Origin` and are unaffected.
- An approved origin receives `Access-Control-Allow-Origin` echoing that origin plus `Vary: Origin`, and CORS preflight (`OPTIONS`) is answered with `204`. A different scheme, host, or port is still rejected.

Request bodies are bounded:

- Configurable request limits through `ReceiverOptions.maxBodyBytes` and `HttpRouterOptions.maxBodyBytes`, with a 10 MiB default for OTLP and a 1 MiB default for MCP. A body of exactly the limit is accepted; only strictly larger bodies are rejected. The limit is enforced both from a declared `Content-Length` and while streaming, so a chunked body that omits or understates its length still cannot exceed the cap.
- Configurable browser-origin allowlists through `ReceiverOptions.allowedOrigins` and `HttpRouterOptions.allowedOrigins` for hosts that intentionally accept browser clients.
- Desktop environment overrides `OTELUX_OTLP_MAX_BODY_BYTES` and `OTELUX_MCP_MAX_BODY_BYTES` for testing and constrained environments. Invalid overrides fail closed to the documented defaults.

Planned receiver work:

- OTLP/gRPC.
- Backpressure and dropped-record counters.

## Port Defaults

| Consumer | OTLP/HTTP | MCP HTTP | Notes |
|---|---:|---:|---|
| Desktop | `4319` | `4320` by default | Avoids colliding with a user's standard collector on `4318`; both listeners are configurable and MCP can be disabled. |
| VS Code extension | `4318` | `4319` by default | Standard OTLP endpoint for editor-local ingest. |

Ports are host settings. The receiver package also exposes single-instance claiming so hosts can handle collisions deliberately.
OTLP and MCP listeners must use different ports. The desktop exposes a copyable OTLP base URL and, while MCP is enabled, a copyable MCP endpoint; failed listener binds leave the previous healthy listener and persisted settings intact.

The desktop MCP listener requires a per-install bearer token. A random token is generated on first run and stored in `<userData>/mcp-token`; every MCP `POST` must send `Authorization: Bearer <token>` or receive `401`. The identity probe (`GET /`) stays open so a client can check liveness without the token.

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
- Copyable endpoint controls reflect the listeners that are actually running and disappear or become non-actionable when their service is disabled or unavailable.
- Theme mode is user-switchable from the left rail: Auto follows the OS color scheme, while Light and Dark force a specific token set. Text contrast must stay readable in both explicit themes.

### Logs Requirements

- Logs must have visible and semantic column headers for Level, Time, Service, Message, Trace, and Actions.
- Logs with trace/span IDs expose a shortened trace pivot in the row.
- Row actions include View details and Copy message on every row; Copy trace/span IDs and trace/span pivots appear only when the row has that correlation context.
- Empty and loading states keep the table header and column layout visible.
- The details pane shows log facts, attributes, resource, and scope, with section counts and internal search.

### Trace Requirements

- The narrow trace list can stay card-like for scannability.
- Full-width or dense trace-list mode should expose table-like headers and sort affordances.
- Sort options should include timestamp, duration, span count, error count, and name when backed by the data source.
- Waterfall rows should support selection, copy/detail actions, and later log markers for logs emitted inside spans.
- Closing span details must not lose the selected span unexpectedly.

### Metrics Requirements

- Metrics use a split explorer: meter/scope and instrument navigation on the left, focused instrument workspace on the right.
- Instruments show type, unit, description when present, and current service context when known.
- The selected instrument exposes scan summary fields for Type, Service, Latest, Unit, Updated, and Points.
- The selected instrument actions include Copy metric name, Copy metric data, and View metric details.
- Metric details show instrument facts, data points, resource attributes, and scope information.
- Graph and table modes are both first-class. Scalar graphs show visible time/value axes and aggregate same-timestamp attribute series into one plotted total; the table remains the exact raw data-point fallback when charts are not enough.
- Future exemplar markers should pivot to the originating trace.

### Cross-Signal Requirements

- Pause/resume and clear data apply across traces, logs, and metrics.
- Result footers show `Showing N ...` and live/paused state outside the scroll region.
- Active filters show a count and a clear affordance.
- Service is the user-facing label. Raw OTel resource attributes belong in details.
- OTelux keeps its own visual language. Interaction patterns can be borrowed; brand chrome should not be copied from other tools.
- AI explain buttons are not a core feature. Hosts may layer assistance on top of deterministic local data.

## Supported Release Workflows

"Feature complete" means a bounded set of supported workflows is coherent and reliable, not that every item in [plan.md](plan.md) is implemented.

A supported stable desktop release must let a user:

- Install and launch OTelux without a development toolchain, understand receiver state, and recover from port conflicts without editing files.
- Follow a first-run recipe or use synthetic demo data to see useful telemetry within five minutes.
- Receive traces, logs, and metrics through the documented OTLP encodings without restarting the app.
- Complete the trace, log, metric, and cross-signal workflows defined above without dead controls, misleading status, or unexplained console errors.
- Preserve telemetry and settings across restart, bound disk growth through retention, and recover safely from missing, old, or corrupt local state.
- Use only agent tools that are implemented, bounded, read-only, and accurately described. Incomplete tools are excluded from the supported surface or explicitly marked experimental.
- Complete core workflows with keyboard input, visible focus, readable contrast, and no pointer-only interaction.

A prerelease may narrow platforms, storage durability, ingest encodings, or supported surfaces only when the limitation is visible in the app and stated in its README and release notes. It must not present an unavailable capability as working.

## Distribution Requirements

- Official downloads are immutable, versioned artifacts with published integrity and provenance information.
- Installation never requires piping mutable network content into a privileged shell. Portable Linux artifacts run without root; system package installation uses the platform package manager.
- Install, upgrade, and uninstall instructions name their filesystem and data effects and are tested on every advertised platform.
- Update mechanisms, when added, verify publisher identity and artifact integrity before replacement.
- Release credentials stay in protected CI environments and never appear in source, fixtures, artifacts, or logs.

## Security Requirements

- Desktop OTLP and MCP listeners bind to loopback unless the user explicitly configures and acknowledges broader exposure.
- MCP access to captured telemetry requires explicit enablement or a per-install credential. Missing or invalid credentials do not reveal tool results.
- Request bodies are bounded before parsing. Oversized OTLP and MCP requests return `413`; unsupported media types return `415`.
- Requests carrying an `Origin` header are rejected with `403` by default. Hosts may configure exact allowed origins; wildcard origins are never combined with credentials, accepted responses vary on `Origin`, and rejected origins receive no telemetry or permissive CORS headers.
- Electron renderers run sandboxed with context isolation and no Node.js integration. The preload exposes only the typed OTelux bridge, never raw `ipcRenderer`.
- IPC requests are validated at runtime in the main process; TypeScript annotations are not treated as a security boundary.
- Unexpected top-level navigation and window creation are denied. Permission requests are denied unless a documented feature has an explicit allowlist.
- Only intentional HTTPS destinations may leave the app through the system browser. Telemetry-derived values are never opened as URLs automatically.
- Security-sensitive behavior is covered by integration tests and re-reviewed after Electron upgrades.

## Release Quality Policy

"Bug free" is not a measurable release claim. OTelux uses this severity gate:

| Severity | Definition | Release policy |
|---|---|---|
| P0 | Security compromise, unrecoverable data loss, installer damage, or failure to launch on a supported platform. | Blocks prerelease and stable releases. |
| P1 | A supported workflow is broken without a reasonable workaround, the app repeatedly crashes or hangs, or common telemetry is silently corrupted. | Blocks prerelease and stable releases. |
| P2 | A supported workflow is materially degraded but has a safe workaround, or accessibility or performance falls outside the documented floor. | Must be fixed or accepted with an owner, rationale, workaround, and release-note disclosure. |
| P3 | A minor visual, copy, or interaction defect that does not impede a supported workflow. | May ship when tracked for a patch or later milestone. |

Every release candidate requires zero unresolved P0 or P1 defects, explicit disposition of P2 defects, a clean install and upgrade path, and a completed release report for every supported platform and architecture. Verification details live in [test.md](test.md).

## Agent Tool Surface

Initial MCP tools, mirrored where useful by VS Code LM Tools:

| Tool | Status | Question |
|---|---|---|
| `otel_find_recent_errors` | Live | What just broke? |
| `otel_get_slowest_spans` | Live | What is slow? |
| `otel_search_logs` | Live | Why did this log fire? |
| `otel_get_trace` | Live | Show this trace. |
| `otel_get_span_details` | Live | Show this span. |
| `otel_correlate_agent_run` | Experimental stub | What was my app doing during this agent run? |
| `otel_get_service_overview` | Experimental, approximate | What services emitted telemetry? |

All tools are read-only. Only tools marked Live belong to the supported release surface. Tool handlers should stay thin wrappers over engine queries so desktop, extension, MCP, and LM tools do not fork behavior. Service overview currently derives recent service stats from trace summaries; richer cross-signal service rollups are planned.

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
- Codex duration/token metrics appear in the Metrics explorer with scan summaries, copy actions, and details.
- Trace ingest remains unaffected by logs and metrics ingest.

## Performance Budgets

Treat these as targets until benchmark coverage exists:

| Surface | Budget |
|---|---:|
| Cold start to first paint | < 3 seconds in development, tighter for packaged builds. |
| Trace list query | < 100 ms for common local workloads. |
| Log search | < 150 ms for indexed local workloads. |
| Metric chart query | < 150 ms for common local workloads. |
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

Manual desktop verification lives in [test.md](test.md). UI/runtime smoke checks should use the repo's self-verification workflow. The complete automated, packaged, accessibility, performance, coverage, and manual release gate is [Release Qualification](test.md#release-qualification).

## Open Questions

- When does the workbench need a separate Services surface versus compact service overview panels in existing views?
- How much column management is needed before durable storage makes row counts large enough to justify full data-grid behavior?
- Does a browser demo matter before desktop and VS Code are both hard enough for daily local use?
- Should MCP config writers live in the extension only, or graduate into a shared package after desktop needs them too?
