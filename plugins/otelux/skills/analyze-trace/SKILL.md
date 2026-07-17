---
name: analyze-trace
description: "Analyze an OpenTelemetry trace or slow request from OTelux, including critical path, errors, span attributes, and correlated logs. Use when: given a trace ID, investigating a slow trace, or explaining a distributed request waterfall."
---

# Analyze a trace with OTelux

1. If the user supplied a trace ID, call `otel_get_trace`. Otherwise call `otel_get_slowest_spans` (optionally scoped to the requested service) and choose the most relevant candidate.
2. Reconstruct the parent/child tree and critical path. Report total duration, service transitions, longest spans, concurrency, and gaps where work is not represented by spans.
3. Call `otel_get_span_details` with both the trace ID and span ID for:
   - every error span;
   - the slowest span(s) on the critical path;
   - spans whose names/status disagree with their attributes.
4. Call `otel_search_logs` using the trace ID and concrete operation/error terms when logs may explain the span behavior.
5. Distinguish confirmed facts from hypotheses. Do not infer causality solely from temporal overlap.
6. Return a compact trace narrative, critical-path table, errors/warnings, and prioritized instrumentation or code follow-ups.
7. Include the trace ID and span IDs in the answer so the user can inspect the same waterfall and details in the OTelux desktop UI.

If OTelux MCP is unavailable, tell the user to start OTelux and enable MCP. In Claude desktop, when OTelux is already running but tools are absent, direct the user to `node ./plugins/otelux/bin/install-claude-app-mcp.mjs` and a fully new Claude App session. Never fabricate spans or attributes.
