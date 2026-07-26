# OTelux plugin

Shared plugin for Claude Code, Codex, and Pi.

## What it includes

- Four shared skills: incident investigation, trace analysis, service health, and a real dashboard launch/focus action.
- A bundled MCP stdio bridge that discovers and authenticates to the running OTelux desktop MCP listener. Claude resolves the bridge via `${CLAUDE_PLUGIN_ROOT}`; Codex starts it relative to the installed plugin root (`cwd: "."`). Both invoke the same bridge.
- Dual manifests: `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`.
- A thin Pi extension that registers the same MCP tools natively while keeping the MCP server as the single implementation.

## Prerequisites

1. Install and start the OTelux desktop app.
2. Keep MCP enabled in OTelux Settings (default port `4320`).
3. Node.js 22 or newer must be on `PATH` for the bridge process.

The bridge reads `runtime.json` and the owner-only `mcp-token` from the canonical OTelux data directory. Override discovery with `OTELUX_DATA_DIR`, `OTELUX_MCP_URL`, `OTELUX_MCP_TOKEN_FILE`, or `OTELUX_MCP_TOKEN`; `OTELUX_USER_DATA_DIR` remains a compatibility alias.

## Local Claude test

```bash
claude --plugin-dir ./plugins/otelux
```

Then use `/otelux:investigate-incident`, `/otelux:analyze-trace`, `/otelux:service-health`, or `/otelux:open-dashboard`. Check `/mcp` for the bundled `otelux` server.

### Claude desktop app

Some Claude desktop local-agent sessions load plugin skills but do not start plugin-bundled local MCP servers. If a skill says no `otel_*` tools are available even though OTelux is running, install the same bridge at Claude user scope:

```bash
node ./plugins/otelux/bin/install-claude-app-mcp.mjs
```

This copies the bridge to a stable per-user location and registers it as `otelux`, matching Codex. Fully start a **new Claude App session** afterward; an existing chat keeps the MCP snapshot it started with. Approve the OTelux tools when Claude prompts. Re-run the installer after a plugin update to refresh the stable bridge copy.

Verify from a terminal:

```bash
claude mcp get otelux
```

## Pi

Install this directory as a local Pi package:

```bash
pi install /absolute/path/to/otelux/plugins/otelux
```

The extension starts the existing MCP bridge, registers its `otel_*` tools with Pi, and closes the bridge with the Pi session. Use `/otelux-status` to verify the connection. Start the OTelux desktop app and keep MCP enabled before starting Pi.

## Local Codex marketplace

```bash
codex plugin marketplace add .
codex plugin add otelux@otelux-plugins
```

Restart the Codex client or session after installation.

## Data handling

The plugin connects only to the authenticated loopback MCP listener owned by the local OTelux desktop app. Its MCP tools are read-only. Telemetry remains on the user's machine unless the user or model explicitly includes tool results in an AI conversation, whose provider policies then apply.

For the current bridge, target shared runtime, CLI/direct-MCP forms, and shared workbench delivery, see [`docs/arch.md`](../../docs/arch.md).
