# @otelux/mcp-server

Read-only [Model Context Protocol](https://modelcontextprotocol.io/) server exposing OTelux query tools. It is currently hosted by `apps/desktop`; the shared-runtime architecture makes it available to the agent plugin, direct MCP, CLI, and Desktop through one local backend. HTTP access requires an owner-only bearer token.

## Tools

Frozen in [`docs/spec.md` § 12.3](../../docs/spec.md). All read-only:

- `otel_find_recent_errors` — spans with `status=ERROR` in the last N minutes, optionally scoped to a service.
- `otel_get_slowest_spans` — top-N spans by duration, optionally scoped to a service.
- `otel_search_logs` — free-text + severity log search over log body, event name, severity text, and attributes.
- `otel_correlate_agent_run` — finds logs carrying an exact standard run/conversation/session identifier and follows propagated trace context to bounded trace summaries; no service-name inference.
- `otel_get_trace` — full span tree for a `traceId`.
- `otel_get_span_details` — single-span detail by `traceId` + `spanId` (attributes, events, context, resource).
- `otel_get_service_overview` — cross-signal service health: traces/spans/errors and rate, p50/p95 duration, log severity bands, and metric instrument availability.

## Transports

Hand-written JSON-RPC dispatcher (no SDK dependency). Two transports ship today:

- HTTP — returns a Hono router via `httpRouter(server)`. Mount under `@otelux/receiver`'s Hono app, or stand alone.
- stdio — `runStdioTransport(server, { input, output })` wires `process.stdin/stdout` into the dispatcher for spawn-on-demand clients (Codex CLI, Claude Code, Cursor).

Supported MCP protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05` (negotiated during `initialize`).
