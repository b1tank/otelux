# @otelux/mcp-server

Read-only [Model Context Protocol](https://modelcontextprotocol.io/)
server exposing OTelux query tools. Consumed by both `apps/desktop`
(off by default, toggle in Settings) and `apps/vscode-extension`
(always-on, mounted alongside the OTLP receiver).

## Tools

Frozen in [`docs/spec.md` § 12.3](../../docs/spec.md). All read-only:

- `otel_find_recent_errors` — spans with `status=ERROR` in the last N
  minutes, optionally scoped to a service.
- `otel_get_slowest_spans` — top-N spans by duration, optionally scoped
  to a service.
- `otel_search_logs` — free-text + severity log search. **Stub in M1**
  (logs land in Phase 2).
- `otel_correlate_agent_run` — joins user-app spans with the spans of a
  specific Copilot / Codex / Claude agent run. **Stub in M1** (engine
  detection lands in Phase 1 Track B).
- `otel_get_trace` — full span tree for a `traceId`.
- `otel_get_span_details` — single-span detail (attributes, events,
  context, resource).
- `otel_get_service_overview` — services that have emitted telemetry,
  plus span/error counts.

## Transports

Hand-written JSON-RPC dispatcher (no SDK dependency). Two transports
ship today:

- HTTP — returns a Hono router via `httpRouter(server)`. Mount under
  `@otelux/receiver`'s Hono app, or stand alone.
- stdio — `runStdioTransport(server, { input, output })` wires
  `process.stdin/stdout` into the dispatcher for spawn-on-demand
  clients (Codex CLI, Claude Code, Cursor).

Supported MCP protocol versions: `2025-06-18`, `2025-03-26`,
`2024-11-05` (negotiated during `initialize`).
