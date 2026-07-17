---
name: investigate-incident
description: "Investigate recent application errors, failures, regressions, or incidents using local OTelux traces and logs. Use when: something broke, requests are failing, an error appeared, or the user wants an evidence-backed incident summary."
---

# Investigate an incident with OTelux

Use the OTelux MCP tools to investigate the user's local OpenTelemetry data. The tools may be namespaced by the host, but their semantic names begin with `otel_`.

1. Establish scope. Infer a service and time window from the request; ask one concise question only if neither can be inferred. Default to the last 15 minutes.
2. Call `otel_find_recent_errors` with the service/window. If no errors are found, say so and broaden the window once when reasonable.
3. For the most relevant error traces, call `otel_get_trace`. Compare failing and healthy siblings, identify the first error span, and note critical-path latency.
4. Call `otel_get_span_details` with both the trace ID and span ID for the error span and any suspicious parent/child spans. Inspect status, attributes, events, links, resource, and timing.
5. Call `otel_search_logs` using concrete error text, operation names, trace IDs, or relevant attributes. Prefer trace-correlated logs; label time-only correlation as circumstantial.
6. When latency might be causal, call `otel_get_slowest_spans` for the affected service.
7. Return:
   - concise impact and time window;
   - evidence table (trace/span/log identifiers, service, timestamp, duration/status);
   - most likely cause, clearly separated from confirmed facts;
   - alternative hypotheses and missing telemetry;
   - next action(s) in priority order.
8. End with a visual handoff: tell the user which trace ID(s) and service(s) to inspect in the OTelux desktop waterfall/logs UI.

If OTelux MCP is unavailable, explain that the desktop app must be running with MCP enabled. In Claude desktop, when the app is already running but tools are absent, direct the user to `node ./plugins/otelux/bin/install-claude-app-mcp.mjs` and a fully new Claude App session. Do not invent telemetry. All OTelux tools are read-only.
