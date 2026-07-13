# OTelux — Project Proposal

Updated: 2026-07-13

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
- Inspect metrics through a meter/instrument explorer, compare scan summaries, switch the focused instrument between an axis-labeled graph and a raw table, copy metric data, and open details.
- Let an agent ask read-only questions over the same local store.

## Living Documents

This proposal intentionally does not track implementation status or repeat the roadmap. The [Current Baseline](spec.md#current-baseline) is the source of truth for what exists and what remains limited; [plan.md](plan.md) owns future work. Keeping those facts out of the pitch lets this document remain stable unless the audience, product bet, or scope changes.

## Architecture

```text
Local apps / agents / SDKs
        |
        | supported OTLP inputs
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
