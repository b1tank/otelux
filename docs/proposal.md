# OTelux — Project Proposal

Updated: 2026-07-13

## Summary

OTelux is a local-first OpenTelemetry workbench for developers and coding agents. It receives telemetry from local applications and agent harnesses, stores and queries it locally, presents one shared visual workbench, and exposes the same data through CLI and MCP-compatible tools.

The bet is simple: developers already have useful telemetry nearby, but local inspection is fragmented. OTelux makes traces, logs, and metrics immediately visible without requiring a cloud backend, a hosted account, or a production observability stack.

## Why Now

OpenTelemetry has become the common data shape for applications, developer tools, and agent runtimes. Local SDKs can emit traces, logs, and metrics today, but after configuration there is still a gap: where does a developer inspect that data while iterating locally, and how can an agent ground its debugging in the same facts the human sees?

OTelux fills that gap as a local tool first. A single per-user runtime owns ingest and storage while the agent plugin, direct MCP, CLI, and Desktop provide interaction forms suited to different workflows. Reusable packages prevent those forms from forking the workbench or query behavior.

## Product Shape

OTelux has these local product forms:

| Surface | Role |
|---|---|
| Agent plugin | Claude/Codex/Pi skills, MCP tools, telemetry setup workflows, and browser-workbench launch over the local runtime. Pi uses a thin native adapter over the same MCP bridge. |
| Direct MCP | Read-only OTelux tools for users who want agent access without packaged skills or Electron. |
| CLI | Headless runtime, lifecycle, status, configuration, diagnostics, and browser launch. |
| Desktop app | Native traces, logs, metrics, settings, and ingest-status workbench over the shared runtime. |

The visual workbench has two delivery modes, not two products: the plugin and CLI can open the runtime-served UI in a browser, while Desktop embeds the same `@otelux/ui` application.

The core user workflows are:

- Point a local OTel exporter at OTelux and see data arrive live.
- Triage recent errors from traces and logs.
- Inspect a trace waterfall and search span details by property name or value.
- Search structured logs, including agent/user-prompt content carried in log attributes, and narrow an open log drawer to matching details.
- Inspect metrics through a meter/instrument explorer, compare scan summaries, switch the focused instrument between an axis-labeled graph and a raw table, copy metric data, and open details.
- Let an agent ask read-only questions over the same local store.

## Living Documents

This proposal intentionally does not track implementation status or repeat the roadmap. The [Current Baseline](spec.md#current-baseline) is the source of truth for what exists and what remains limited; [plan.md](plan.md) owns future work. Keeping those facts out of the pitch lets this document remain stable unless the audience, product bet, or scope changes.

## Architecture

```text
Applications / agent telemetry --OTLP/HTTP--> one local OTelux runtime
                                                      |
                                                      +--> one SQLite database
                                                      +--> MCP tools
                                                      +--> shared workbench UI/API
                                                               |
                                      plugin / direct MCP / CLI / Desktop
```

The runtime is the only local process that opens the active SQLite database and binds the receiver. The `DataSource` interface is the main UI boundary: UI code asks for traces, logs, metrics, details, and change events through that interface, while host adapters decide whether those queries cross local HTTP/events, Electron IPC, or a direct in-process engine. See [arch.md](arch.md) for lifecycle, migration, packaging, security boundaries, and current implementation status.

## Scope

In scope:

- Local ingest, local storage, local query, local UI.
- Traces, structured logs, metrics, and later profiles.
- Shared runtime first, then multiple install and interaction forms with package reuse throughout.
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
- Which application source and component service emitted the suspicious telemetry?
- What was my agent or tool doing at the same time?

The same answers should be available to humans in the workbench and to agents through read-only local tools.
