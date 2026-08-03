# OTelux — Specification

Updated: 2026-07-13

OTelux is a local-first OpenTelemetry workbench. It receives local telemetry, keeps it on the user's machine, renders it in a dense debugging UI, and exposes read-only query tools to local coding agents.

This document is the source of truth for what the product is, what is implemented now, and what behavior a supported release must provide. [plan.md](plan.md) owns future work, [test.md](test.md) owns release verification, and [proposal.md](proposal.md) owns the product rationale.

User operation lives in [getting-started.md](getting-started.md), system architecture in [arch.md](arch.md), communication contracts in [protocol.md](protocol.md), storage/query invariants in [storage.md](storage.md), data handling in [privacy.md](privacy.md), and trust boundaries in [security-model.md](security-model.md).

The **Current Baseline** and status tables are descriptive and must match the code. Sections labeled **Requirements** are normative product targets; an item there is not shipped unless the Current Baseline says it is live. Release-specific platform and feature limitations belong in release notes.

## Product Principles

| Principle | Meaning |
|---|---|
| Local-first | No cloud account, no backend dependency, no multi-tenant core. |
| Workbench, not dashboard | Dense comparison where users scan rows; spacious detail where users inspect one item. |
| One runtime, four forms | Agent plugin, direct MCP, CLI, and Desktop converge on one backend and active local database rather than starting competing receivers. |
| Package-first | Shared behavior belongs in `packages/*`; apps assemble packages. |
| Embed-friendly | UI is browser-safe, themeable through CSS variables, and usable inside webviews. |
| A11y is part of done | Keyboard access, focus states, labels, and readable high-contrast states are required. |
| Performance budgets bind | Slow query, layout, or ingest regressions are product bugs. |
| No unsolicited egress | OTelux does not independently transmit captured telemetry. Data leaves OTelux only through explicit user actions or configured clients such as MCP or LM tools, whose own data-handling policies apply. Any future diagnostics or reporting is explicit, documented, and opt-in. |

## Current Baseline

The repository currently contains:

- `apps/desktop`: Electron shell hosting IPC/windows and the React renderer; its main process currently embeds `@otelux/local-runtime`.
- `@otelux/local-runtime`: backend composition for SQLite, retention, engine queries, OTLP, authenticated MCP, settings, sample data, and lifecycle events.
- Canonical platform data-home resolution, resumable copy-only migration from legacy Electron state, and nonce-protected `runtime.lock` / `runtime.json` ownership metadata.
- OTLP/HTTP JSON and protobuf ingest for traces, logs, and metrics.
- Durable local storage for all signals via `@otelux/engine-node` (Node `node:sqlite`), with user-configurable retention (age and size). The store versions its schema with forward-only transactional migrations; a failed upgrade leaves the legacy database in place for retry, while an unreadable or newer-version file is quarantined before starting fresh. `@otelux/engine` still ships an in-memory store for tests and small workloads; both back ends pass a shared storage-contract suite.
- A live SQLite budget meter in Settings shows retention-page pressure against the configured size limit and separately reports physical DB, WAL, and SHM footprint. Retention passes checkpoint and truncate WAL before and after pruning so sustained ingest cannot leave an unbounded WAL sidecar outside the page budget.
- An About surface opened from the desktop rail reports the packaged OTelux version plus Electron, Chromium, Node.js, and platform versions for support diagnostics. The displayed app version comes from the same package-version build define used by packaging.
- Live Traces, Logs, and Metrics rail surfaces in `@otelux/ui`.
- A one-click "Load sample data" seed in the empty Traces view populates every surface with clearly-labelled synthetic telemetry, so a first-run user can evaluate the UI before wiring an exporter.
- A shared live/paused (live-tail) control and result footers across all three views, plus a confirmed "Clear data" action that deletes all stored telemetry. Live invalidations are signal-scoped and query bursts are coalesced to one active plus one trailing refresh so exporters cannot fan out concurrent renderer queries. New arrivals never steal inspection focus: the waterfall labels the explicitly selected trace until the user chooses another.
- Desktop close-to-tray lifecycle: closing the window keeps OTLP/MCP and SQLite active; tray Open restores the workbench, and tray Quit stops listeners and closes the runtime.
- Direct in-process and Electron IPC `DataSource` adapters.
- MCP tool plumbing over the same query layer.
- A shared OTelux plugin under `plugins/otelux` installs into Claude Code, Codex, and Pi with four observability skills plus a secure stdio bridge to the desktop MCP listener. Pi's thin extension registers the same bridge tools natively; it does not fork the MCP implementation. This is the current companion implementation; see [arch.md](arch.md#current-implementation) for the target shared-runtime architecture.
- The desktop app is the current release product. The agent plugin is currently its companion; direct MCP and CLI become independent forms after the runtime moves into a separately managed daemon.

Important current limits:

- OTLP/gRPC ingest is planned, not shipped (OTLP/HTTP JSON and protobuf are live).
- Dense trace modes need polish; span and log detail drawers provide internal key/value search. Trace interaction uses iterative layout, constant-DOM indentation, virtualized trace/waterfall rows, stable memoized row props, latest-only same-turn selection, stale-result rejection, and a bounded recent-trace cache. Protocol 0.6 sends lightweight waterfall spans and loads full selected-span details separately. SQLite ingest/query/retention runs in a bounded worker queue with direct-read priority rather than Electron main. Trace/log keyset cursors, optional exact counts, and visible per-signal overload counters are live. Trace/log views page incrementally through cursor-backed `Load more` controls. The packaged performance gate builds 10,000 traces / 200,000 spans plus 5,000-deep and 10,000-wide traces, runs interaction during continuous ingest, forces renderer GC, and enforces mounted-row/DOM, paging, frame-gap, and heap budgets in release CI.
- Agent-run correlation and service overview tools are schema-stable but not fully implemented.
- The storage audit's span-identity P0 is fixed in schema v2; trace-service count/page correctness is fixed in schema v3; schema v4 indexes the standard `service.namespace` source dimension; and metric histories are bounded and fetched in one compound indexed statement. Protocol 0.5 grouped source/service facets replace hidden raw-record probes. Main-process query isolation, keyset pagination, and the full query-budget harness remain pre-daemon hardening work. See [storage.md](storage.md#audit-findings).
- `@otelux/protocol` is currently an in-memory TypeScript contract, not a validated JSON wire contract. Runtime RPC/SSE DTOs and schema snapshots are required before Desktop becomes a daemon client. See [protocol.md](protocol.md#current-gaps).

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
Agent plugin    Direct MCP    CLI    Desktop
      \             |         |        /
       +------------+---------+-------+
			  |
		  shared local runtime
			  |
	+-----------------+-----------------+
	|                 |                 |
  OTLP receiver       MCP tools       workbench UI/API
			  |
		  engine + protocol
			  |
		     node:sqlite
```

The load-bearing boundary is `DataSource` from `@otelux/protocol`. The UI asks for telemetry through this interface. Hosts decide whether the request is served directly, over Electron IPC, or over local HTTP/events. The browser is a delivery mode opened by the plugin or CLI, not a separate product form.

The runtime is the only process that opens the active database and binds the receiver. The engine is the source of truth for ingest, query, layout, and subscriptions. The receiver writes into it; the shared workbench and agent tools read from it. See [arch.md](arch.md) for lifecycle and migration details.

The daemon transport and storage implementations must conform to [protocol.md](protocol.md) and [storage.md](storage.md); package types alone are not evidence that a JSON or SQL boundary is compatible or efficient.

## Packages

| Package | Purpose | Current state |
|---|---|---|
| `@otelux/types` | Shared trace, log, metric, resource, scope, and attribute types. | Live. |
| `@otelux/protocol` | `DataSource` interface and query/result contracts. | Live for traces/logs/metrics and grouped resource source/service facets (v0.5). |
| `@otelux/engine` | Pure TypeScript ingest, query, layout, subscriptions, memory storage. | Live. |
| `@otelux/engine-node` | Durable Node storage adapter (`node:sqlite`) with retention (age/size). | Live. |
| `@otelux/local-runtime` | Backend composition and control API for storage, engine, OTLP, MCP, settings, and lifecycle. | Live; currently embedded by Desktop. |
| `@otelux/receiver` | OTLP/HTTP receiver and single-instance helper. | JSON routes live for traces/logs/metrics. |
| `@otelux/ui` | React workbench and primitives. | Traces/logs/metrics live; polish ongoing around details, grouping controls, and footer controls. |
| `@otelux/adapter-direct` | In-process `DataSource` wrapper. | Live. |
| `@otelux/mcp-server` | Read-only MCP JSON-RPC dispatcher. | Live with some stubbed tools. |

Apps are not published packages:

| App | Purpose | Current state |
|---|---|---|
| `apps/desktop` | Main Electron workbench. | Runnable Linux-focused pre-release. |

Plugin distributions are thin hosts over the same packages:

| Plugin | Purpose | Current state |
|---|---|---|
| Claude Code | Shared skills + local desktop MCP bridge. | Built, validated, locally installed. |
| Codex | Shared skills + local desktop MCP bridge. | Built, locally installed; marketplace entry live in-repo. |
| Pi | Shared skills + native adapter over the local desktop MCP bridge. | Built and locally installable as a Pi package. |

Future packages or apps should be added to this spec only when they support one of the four product forms and enter active implementation.

## Technology

| Layer | Choice |
|---|---|
| Language | TypeScript strict mode. |
| Package manager | npm workspaces. |
| Monorepo orchestration | Turborepo. |
| Lint/format | Biome. |
| Tests | Vitest. |
| Desktop | Electron, electron-vite, electron-builder. |
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

| Runtime | OTLP/HTTP | MCP HTTP | Notes |
|---|---:|---:|---|
| Shared local runtime | `4319` | `4320` by default | Avoids colliding with a user's standard collector on `4318`; both listeners are configurable and MCP can be disabled. The runtime is currently embedded in the Desktop process. |

Ports are runtime settings. The runtime claims owner-only `runtime.lock` before opening SQLite or binding either listener and publishes effective statuses in `runtime.json`, preventing concurrent local entry points from becoming competing backend owners.
OTLP and MCP listeners must use different ports. The desktop exposes a copyable OTLP base URL and, while MCP is enabled, a copyable MCP endpoint; failed listener binds leave the previous healthy listener and persisted settings intact.

The runtime MCP listener requires a per-install bearer token. A random token is generated on first run and stored as `mcp-token` in the canonical OTelux data directory; every MCP `POST` must send `Authorization: Bearer <token>` or receive `401`. The identity probe (`GET /`) stays open so a client can check liveness without the token.

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
- Toolbars are operational controls, not decoration. Search, source/service filters, severity/status filters, pause/resume, and clear should be direct and visible.
- Summary/detail is reusable. Selecting a trace, span, log, or metric preserves list context and opens a predictable details area.
- Details panes are searchable. Span and log drawers filter sections and key/value rows through one case-insensitive internal search without changing the selected record.
- Property sections expose counts before expansion.
- Rows expose actions consistently: details, copy, value viewer, and pivots.
- Long values use the full value viewer wherever messages, attributes, JSON, XML, Markdown, or multiline text exceed the pane.
- Footer and empty states communicate result scope, live/paused state, and the expected table shape.
- Endpoint state is explicit: listening port, health, paused/live state, and local trust posture are visible to the user.
- Copyable endpoint controls reflect the listeners that are actually running and disappear or become non-actionable when their service is disabled or unavailable.
- Theme mode is user-switchable from the left rail: Auto follows the OS color scheme, while Light and Dark force a specific token set. Text contrast must stay readable in both explicit themes.
- The rail exposes About, GitHub, and Settings as distinct support/navigation actions. About is keyboard-dismissible, restores focus to its opener, and shows build/runtime diagnostics without reading telemetry or settings.

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
- Settings groups endpoint controls under Connections and retention/database controls under Storage, while preserving one atomic Save action. Exactly one category is visible, and validation reveals and focuses the category that owns the invalid value.
- Source is the primary cross-signal application filter. It is exactly resource `service.namespace` when non-empty, otherwise exact `service.name`; OTelux never infers vendors or products from service-name prefixes. Selecting a source reveals its exact component services as a secondary filter. Raw OTel resource attributes belong in details. Metric instrument identity is source + service + meter + name + type, and the explorer groups accordingly so legitimate cross-service or cross-namespace names never collide.
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
- Keep receiving while the desktop window is hidden in the system tray, and stop every listener/database handle after explicit full quit.
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

Initial MCP tools shared by the agent plugin, direct MCP, CLI, and Desktop:

| Tool | Status | Question |
|---|---|---|
| `otel_find_recent_errors` | Live | What just broke? |
| `otel_get_slowest_spans` | Live | What is slow? |
| `otel_search_logs` | Live | Why did this log fire? |
| `otel_get_trace` | Live | Show this trace. |
| `otel_get_span_details` | Live | Show one span by trace ID and span ID. |
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

The query budgets are targets until the permanent harness lands; structural interaction budgets are release gates immediately:

| Surface | Budget |
|---|---:|
| Cold start to first paint | < 3 seconds in development, tighter for packaged builds. |
| Trace list query | < 100 ms for common local workloads. |
| Log search | < 150 ms for indexed local workloads. |
| Metric chart query | < 150 ms for common local workloads. |
| Inactive-view query traffic | Zero raw list/detail queries or subscriptions. |
| Renderer retained heap | < 100 MB after GC on the representative dogfood database; bounded across repeated trace switching. |
| Bounded list payload | < 2 MiB per active list query; facets < 16 KiB. |
| 10,000-span waterfall | No stack overflow/OOM; < 100 mounted rows, < 2,000 DOM nodes, first viewport < 100 ms on reference hardware. |
| 200-result trace list | < 50 mounted rows; selected-row feedback < 16 ms p95. |
| 50 rapid selections | At most two detail requests; no stale waterfall commit; bounded LRU/cache bytes. |
| React invalidation | Selection rerenders only previous/new rows and selected-trace surfaces; unchanged app chrome/list rows do not commit. |
| Electron main thread | No synchronous SQLite ingest, query, retention, or vacuum work. |
| UI interaction | No intentional blocking over one frame; packaged scroll/selection remains responsive during continuous benchmark ingest. |

Implementation follows these React contracts: effects only synchronize external systems; derived rows and filtering are selector/render work; state subscriptions are local and selector-based; urgent selection feedback is separate from non-urgent fetch/live-tail updates; virtualized rows use stable trace/span IDs; trace-specific state is explicitly keyed; and every cache/queue has a hard bound.

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
- Should telemetry configuration mutations live in the CLI so plugin skills only propose, confirm, and invoke them?
