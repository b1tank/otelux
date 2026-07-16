---
name: open-dashboard
description: "Hand off an observability investigation to the OTelux visual desktop dashboard. Use when: the user wants a trace waterfall, logs table, metrics chart, dashboard, or a visual view of telemetry."
---

# Hand off to the OTelux visual dashboard

OTelux's desktop app is the authoritative rich UI for local traces, logs, and metrics. The plugin's MCP tools provide analysis data; they do not replace the desktop waterfall, log table, or metric explorer.

1. Use OTelux MCP tools to identify the exact visual target:
   - trace waterfall: `otel_get_trace` or `otel_get_slowest_spans`;
   - error view: `otel_find_recent_errors`;
   - logs: `otel_search_logs`;
   - service scope: `otel_get_service_overview`.
2. Give the user a short dashboard handoff containing:
   - signal tab to open (Traces, Logs, Metrics);
   - trace ID, span ID, service name, or search text;
   - expected timestamp/window;
   - what visual pattern to look for.
3. If the desktop app is not running or MCP is unavailable, tell the user to launch OTelux and enable MCP in Settings. Do not claim to have opened or controlled the UI unless the host actually provides that capability.
4. For ChatGPT surfaces that support an OTelux MCP UI component in the future, prefer the embedded component for inspection and keep the underlying tool result useful without it.
