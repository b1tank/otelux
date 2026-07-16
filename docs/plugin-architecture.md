# OTelux Plugin Architecture

Updated: 2026-07-15

OTelux plugins make local OpenTelemetry data available to coding agents without duplicating the desktop engine, query logic, or workbench UI. The first release is a local desktop companion for Claude Code and Codex. A later public ChatGPT app adds an optional embedded dashboard through Apps SDK and requires a public MCP deployment.

## Product Shape

| Surface | Data plane | Analysis | Visual UI | Distribution |
|---|---|---|---|---|
| OTelux desktop | Local receiver + SQLite engine | MCP tools | Full React workbench | Desktop package |
| Claude Code plugin | Desktop loopback MCP via bundled stdio bridge | Shared skills + MCP | Handoff to desktop | Claude marketplace |
| Codex plugin | Desktop loopback MCP via bundled stdio bridge | Shared skills + MCP | Handoff to desktop | Codex marketplace |
| ChatGPT/Codex public plugin (later) | Public HTTPS MCP service backed by opt-in relay/store | Shared skills + MCP | Apps SDK component/fullscreen dashboard | OpenAI Plugins Directory |

The local plugins are implemented under `plugins/otelux/`. They contain two thin manifests, four shared skills, one shared bridge executable, and host-specific MCP launcher files:

```text
plugins/otelux/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
├── .mcp.json                 # Claude: ${CLAUDE_PLUGIN_ROOT}
├── .mcp.codex.json           # Codex: relative path + cwd: "."
├── bin/otelux-mcp-bridge.mjs
└── skills/
    ├── investigate-incident/
    ├── analyze-trace/
    ├── service-health/
    └── open-dashboard/
```

## Local Runtime

```mermaid
flowchart LR
    Claude[Claude Code plugin] -->|stdio JSON-RPC| Bridge
    Codex[Codex plugin] -->|stdio JSON-RPC| Bridge
    Bridge[Shared desktop bridge] -->|HTTP + bearer token| MCP[OTelux desktop MCP :4320]
    MCP --> Engine[@otelux/engine]
    Engine --> SQLite[(local SQLite)]
    Desktop[OTelux workbench UI] --> Engine
```

The bridge discovers the platform OTelux user-data directory, reads `settings.json` for the MCP port, reads the owner-only `mcp-token`, and proxies one-line MCP stdio messages to the authenticated loopback HTTP listener. Overrides support nonstandard installs:

- `OTELUX_USER_DATA_DIR`
- `OTELUX_MCP_URL`
- `OTELUX_MCP_TOKEN_FILE`
- `OTELUX_MCP_TOKEN`

The token is never written into a plugin manifest, marketplace, skill, or model context. stdout is reserved for MCP protocol responses; diagnostics use stderr.

Claude Code starts the plugin-bundled MCP bridge directly. Some Claude desktop local-agent sessions currently load local plugin skills while snapshotting only app-managed and user-scoped MCP servers. `bin/install-claude-app-mcp.mjs` installs the same bridge at a stable user path and registers `otelux-local` as a user MCP fallback. New app sessions then expose the tools; existing chats must be restarted because their MCP set is immutable.

## Shared-Code Boundaries

| Concern | Owning package | Reused by |
|---|---|---|
| Canonical OTel types | `@otelux/types` | engine, receiver, UI, MCP, apps |
| Query/data-source contract | `@otelux/protocol` | desktop, VS Code, future Apps SDK adapter |
| Ingest, queries, subscriptions | `@otelux/engine` | desktop and future hosted service |
| Durable local storage | `@otelux/engine-node` | desktop |
| Read-only agent tools | `@otelux/mcp-server` | desktop HTTP, Claude, Codex, future public MCP |
| Browser-safe workbench | `@otelux/ui` | desktop, VS Code, future ChatGPT component |
| Analysis workflows | `plugins/otelux/skills` | Claude and Codex unchanged; ChatGPT skill bundle |
| Local connection | plugin bridge | Claude and Codex |

Thin ecosystem manifests are allowed to differ. Runtime/query logic and skill instructions must not fork by ecosystem.

## User Workflows

### Incident investigation

The shared skill finds recent errors, drills into trace/span details, searches correlated logs, checks latency, and returns an evidence-backed root-cause summary plus trace IDs to inspect in the desktop waterfall.

### Trace analysis

The shared skill reconstructs the span tree and critical path, identifies errors and latency concentration, checks detailed attributes/events/links, and hands exact trace/span IDs to the visual workbench.

### Service health

The shared skill summarizes service activity/error traces/span volume and slow traces. It explicitly describes current service rollups as local, trace-derived evidence rather than production SLOs.

### Dashboard handoff

Local plugins identify the tab/filter/trace target and direct the user to the desktop UI. A future ChatGPT app renders an embedded Apps SDK component instead.

## Embedded ChatGPT Dashboard

An Apps SDK dashboard should reuse `@otelux/ui`, not create a separate observability UI. The additional host adapter is:

```text
@otelux/adapter-chatgpt
  implements DataSource
  maps MCP app tools <-> @otelux/protocol queries/results
```

The current analytical MCP tools are model-oriented and insufficient for the complete React workbench. The app service needs paginated, structured UI tools (or equivalent MCP resources):

- `otel_query_traces` → `ListTracesQuery` / `ListTracesResult`
- `otel_query_logs` → `ListLogsQuery` / `ListLogsResult`
- `otel_query_metrics` → `ListMetricsQuery` / `ListMetricsResult`
- existing `otel_get_trace` and `otel_get_span_details`

Each app tool needs an output schema, stable structured content, and annotations. UI-only tools can use Apps SDK visibility metadata while still returning useful model-readable summaries. The React component can render compact inline results and open the full workbench in a fullscreen view.

Artifacts are complementary, not the dashboard transport: skills may produce a Markdown incident brief or JSON evidence bundle for the artifacts viewer, while live inspection remains an MCP UI component or the desktop app.

## Public Deployment Constraint

A public ChatGPT plugin submission must provide a public production HTTPS MCP URL. ChatGPT cannot reach a user's loopback desktop server. Public app support therefore requires an explicitly opt-in remote data path:

1. **Hosted OTelux service**: SDK/Collector exports to a tenant-isolated remote OTelux engine/store.
2. **Desktop relay**: desktop establishes an outbound authenticated connection to a hosted MCP relay; the relay never initiates access to localhost.

Either option changes the local-only data boundary and must remain opt-in, documented, encrypted, tenant-isolated, retention-bounded, and covered by public privacy/terms/support pages. The desktop/local plugin continues to work without accounts or egress.

## Safety and Review Metadata

All current OTelux MCP tools are read-only, idempotent for a fixed store, closed-world, and non-destructive. `tools/list` advertises:

```json
{
  "readOnlyHint": true,
  "openWorldHint": false,
  "destructiveHint": false,
  "idempotentHint": true
}
```

Before OpenAI public submission, every tool also needs a reviewed output schema and data-minimization pass. The submission additionally requires:

- verified developer/business identity and Apps Management write access;
- public website, support, privacy, and terms URLs;
- production HTTPS MCP URL and domain verification;
- exact CSP domains for Apps SDK UI;
- five positive and three negative reviewer test cases;
- production assets/screenshots and starter prompts;
- country/region availability and release notes.

Claude community submission uses `claude plugin validate` and the Anthropic Console/community-marketplace review flow. The git-hosted marketplace remains directly installable before community acceptance.

## Delivery Plan

### Delivered: local companion plugin v0.1

- Shared Claude/Codex plugin package and skills.
- Secure local stdio-to-desktop MCP bridge.
- Claude and Codex marketplaces in this repository.
- Native validation and installation in both clients.
- Live Claude and Codex MCP workflow smoke tests.

### Next: app-ready MCP contract

- Add output schemas to all current tools.
- Add paginated UI query tools/resources.
- Add `@otelux/adapter-chatgpt` against mocked Apps SDK host APIs.
- Add compact trace/error/service components using `@otelux/ui` primitives.

### Then: developer-mode ChatGPT app

- Deploy a temporary HTTPS MCP service with synthetic-only data.
- Create the `plugin_asdk_app...` developer app and `.app.json` wiring.
- Verify component, modal, and fullscreen dashboard modes.

### Public beta

- Choose hosted store vs. desktop relay architecture.
- Complete auth, tenant isolation, retention, privacy/legal/support, CSP, and reviewer fixtures.
- Submit app-plus-skills plugin to OpenAI and plugin to Anthropic community review.
