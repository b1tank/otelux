# OTelux — Project Proposal

Updated: 2026-06-16

## Summary

OTelux is a local-first OpenTelemetry workbench for developers and coding agents. It receives telemetry from local applications, stores and queries it locally, shows it in a focused desktop workbench, and exposes the same data to VS Code and MCP-compatible agents.

The bet is simple: developers already have useful telemetry nearby, but local inspection is fragmented. OTelux makes traces, logs, and metrics immediately visible without requiring a cloud backend, a hosted account, or a production observability stack.

## Why Now

OpenTelemetry has become the common data shape for applications, developer tools, and agent runtimes. Local SDKs can emit traces, logs, and metrics today, but after configuration there is still a gap: where does a developer inspect that data while iterating locally, and how can an agent ground its debugging in the same facts the human sees?

OTelux fills that gap as a local tool first. The desktop app is the primary experience. The reusable package architecture lets the same workbench appear in VS Code and lets MCP/LM tools query the same engine data.

## Product Shape

OTelux has four product surfaces:

| Surface | Role |
|---|---|
| Desktop app | Main local workbench for traces, logs, metrics, settings, and ingest status. |
| VS Code extension | Editor-hosted workbench that reuses the same UI, receiver, engine, and MCP tools. |
| MCP server | Read-only tool surface for local coding agents such as Codex CLI, Claude Code, and Cursor. |
| VS Code LM Tools | Thin wrappers over the same MCP/engine queries for Copilot inside VS Code. |

The core user workflows are:

- Point a local OTel exporter at OTelux and see data arrive live.
- Triage recent errors from traces and logs.
- Inspect a trace waterfall and span details.
- Search structured logs, including agent/user-prompt content carried in log attributes.
- Inspect metrics by meter and instrument, compare scan summaries, switch between graph and table, copy metric data, and open details.
- Let an agent ask read-only questions over the same local store.

## Already Done

The current repository already has a working foundation:

- npm workspace monorepo with TypeScript, Turborepo, Biome, and Vitest.
- `apps/desktop` Electron shell with receiver, engine, IPC, settings, and renderer workbench.
- `apps/vscode-extension` shell with webview, embedded receiver, MCP server, and VS Code Language Model Tool registration.
- `@otelux/receiver` with OTLP/HTTP JSON routes for `/v1/traces`, `/v1/logs`, `/v1/metrics`, and `/healthz`.
- `@otelux/engine` with in-memory ingest/query/subscription support for traces, logs, and metrics.
- `@otelux/ui` with live Traces, Logs, and Metrics rail surfaces, including Logs row actions/pivots and Metrics summaries/actions/details.
- `@otelux/mcp-server` with read-only JSON-RPC tools for error triage, slow spans, trace drill-down, span details, and log search.
- `@otelux/adapter-direct` and `@otelux/adapter-vscode` for embedding the same UI over different host boundaries.

## Important Gaps

The product is not release-ready yet. The most important gaps are:

- Storage is still memory-backed; `@otelux/engine-node` is a placeholder for a future `node:sqlite` implementation.
- The receiver accepts OTLP/HTTP JSON only; protobuf and gRPC are planned.
- Detail panes need internal search, consistent section actions, and selection behavior across spans, logs, and metrics.
- Metrics still need grouping controls beyond meter-first layout and deeper histogram readability polish.
- Agent-run correlation has a stable schema but is not backed by engine intelligence yet; service overview exists as a trace-summary approximation and needs richer cross-signal rollups.
- Desktop and VS Code extension packaging need hardening before handoff to broader users.

## Roadmap

The next work is intentionally scoped. The plan in [plan.md](plan.md) is the source of truth, summarized here:

1. Polish the three-pillar workbench: details search, metric grouping controls, histogram readability, pause/resume, clear, and result footers.
2. Add durable local storage with `node:sqlite`, schema versioning, WAL mode, retention, and migration tests.
3. Harden the VS Code extension as a real second consumer of the shared packages.
4. Back agent-run correlation with real engine queries and upgrade service overview with cross-signal rollups.
5. Add OTLP protobuf/gRPC and receiver pressure visibility.
6. Finish installation and platform packaging.

## Architecture

```text
Local apps / agents / SDKs
        |
        | OTLP/HTTP JSON today; protobuf/gRPC planned
        v
@otelux/receiver
        |
        v
@otelux/engine + storage
        |
        +--> @otelux/ui through DataSource adapters
        |       - desktop renderer
        |       - VS Code webview
        |
        +--> @otelux/mcp-server
        |       - HTTP and stdio MCP clients
        |
        +--> VS Code LM Tools
                - Copilot tool calls
```

The `DataSource` interface is the main boundary. UI code asks for traces, logs, metrics, and details through that interface; apps decide whether those queries cross Electron IPC, VS Code postMessage, or a direct in-process engine.

## Scope

In scope:

- Local ingest, local storage, local query, local UI.
- Traces, structured logs, metrics, and later profiles.
- Desktop first, VS Code second, package reuse throughout.
- Read-only agent tools over local telemetry.

Out of scope for the core product:

- Cloud sync or hosted backend.
- Multi-tenant auth.
- Non-OTel telemetry formats.
- A built-in AI assistant that mutates data or sends telemetry elsewhere.

## Success Criteria

OTelux succeeds when a developer can run an app locally, point its OTel exporter at OTelux, and answer these questions quickly:

- What just broke?
- What was slow?
- What logs explain it?
- Which service emitted the suspicious telemetry?
- What was my agent or tool doing at the same time?

The same answers should be available to humans in the workbench and to agents through read-only local tools.
