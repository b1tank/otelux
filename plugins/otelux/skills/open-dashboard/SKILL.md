---
name: open-dashboard
description: "Hand off an observability investigation to the OTelux visual desktop dashboard. Use when: the user wants a trace waterfall, logs table, metrics chart, dashboard, or a visual view of telemetry."
---

# Open the OTelux visual dashboard

OTelux's desktop app is the authoritative interactive UI for local traces, logs, and metrics.

1. Call `otel_open_dashboard` to launch or focus the OTelux desktop workbench. This is the primary action; do not stop at a text handoff when the tool is available.
2. When the user supplied an investigation target, use OTelux MCP tools to identify it:
   - trace waterfall: `otel_get_trace` or `otel_get_slowest_spans`;
   - error view: `otel_find_recent_errors`;
   - logs: `otel_search_logs`;
   - service scope: `otel_get_service_overview`.
3. Tell the user what is now open and provide the exact visual target:
   - signal tab to open (Traces, Logs, Metrics);
   - trace ID, span ID, service name, or search text;
   - expected timestamp/window;
   - what visual pattern to look for.
4. If MCP is unavailable, first tell the user to launch OTelux and enable MCP in Settings. If they are in the Claude desktop app and OTelux is already running, tell them to run `node ./plugins/otelux/bin/install-claude-app-mcp.mjs` from the OTelux checkout, then fully start a new Claude App session; existing chats keep their original MCP snapshot.
5. Claude Code/Codex local plugins cannot embed a custom dashboard inside their chat surface. `otel_open_dashboard` opens the external OTelux desktop app. A future hosted ChatGPT Apps SDK plugin can embed the same `@otelux/ui` workbench.
