# Privacy And Local Data

Updated: 2026-07-15

OTelux is local-first. The application does not require an account or cloud service and does not independently upload captured telemetry.

This document explains current data handling. The normative product rule is the specification's [No unsolicited egress](spec.md#product-principles) principle.

## Data OTelux Receives

OpenTelemetry payloads may contain sensitive application and developer data, including:

- Prompts, model input, and model output.
- SQL statements, URLs, headers, and request or response bodies.
- File paths, source locations, host names, user or session identifiers, and environment details.
- Service topology, errors, stack traces, performance measurements, and business attributes.
- Trace and span identifiers that correlate activity across systems.

Treat an OTelux process and its local data with the same care as application logs and debugger output.

## Current Storage

The desktop stores traces, logs, and metrics in a local SQLite database (`otelux.db`) so they survive restarts. Open **Settings → Database location** to see and copy the exact active path or configure a custom absolute path.

Retention bounds disk growth. The defaults remove telemetry after 72 hours or when the database exceeds 512 MB, whichever happens first. Either bound can be changed or disabled in Settings. Clear data deletes every stored trace, log, metric, resource, and instrumentation scope after an explicit confirmation.

The runtime stores telemetry, port/MCP settings, and its token under the canonical platform data home. On Linux this is:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/otelux/
```

macOS uses `~/Library/Application Support/OTelux`; Windows uses `%LOCALAPPDATA%\OTelux`. `OTELUX_DATA_DIR` provides an explicit test/development override. The Settings UI is the source of truth for the active database path.

`settings.json` does not contain captured telemetry or credentials. The MCP token is stored separately as `mcp-token` with owner-only permissions. While running, `runtime.json` and `runtime.lock` contain process, version, endpoint, and path metadata but never the token value.

## Network Behavior

The desktop currently binds OTLP and MCP HTTP listeners to `127.0.0.1`. Loopback prevents direct access from other machines, but it is not user isolation: other processes or users on the same host may be able to connect. Disable MCP on shared or multi-user hosts when agent access is not needed.

OTelux itself does not add analytics, crash reporting, or telemetry export. Explicit user actions can still cause data to leave the application:

- An enabled MCP or LM client can read selected telemetry and may send it to its own model or service. That client's privacy policy and configuration apply.
- Copy, download, or future export actions place data under the user's control.
- The GitHub link opens the project repository in the system browser.

The current MCP HTTP listener is enabled by default but requires a per-install bearer token: a random secret generated on first run and stored in the canonical data directory. Requests without a valid `Authorization: Bearer <token>` header are rejected before any tool runs. Configure your MCP client with that token, or disable MCP in Settings when agent access is not needed, especially on shared hosts. See the [security requirements](spec.md#security-requirements).

## Agent Plugins

The OTelux Claude Code and Codex plugins connect to the authenticated loopback MCP listener through a bundled local bridge. The bridge reads `runtime.json` and the token file from the canonical data directory; it does not copy the token into plugin manifests, model prompts, or marketplace metadata.

All bundled MCP tools are read-only. Tool results can contain telemetry attributes, log bodies, prompts, SQL, identifiers, and other sensitive content. When Claude or Codex uses a tool result, that selected data may be sent to the AI provider under that provider's account, retention, and privacy settings. Installing the plugin does not itself upload telemetry; data leaves the local store only when the user/model invokes a tool or the user explicitly exports/copies it.

The local plugin, direct-MCP, CLI, and Desktop forms do not require a hosted OTelux service or account.

## Repository Fixtures

Fixtures committed under `fixtures/` are synthetic. They use deterministic test hosts, identifiers, providers, models, timestamps, traces, and spans while preserving relevant OTLP behavior.

Do not contribute captured production or personal telemetry. New fixtures must be synthetic or comprehensively sanitized and should carry an explicit synthetic marker where the wire format permits it.

## Issues And Support

Never attach raw production telemetry, credentials, database files, or unredacted logs to a public issue. Telemetry can reveal prompts, SQL, URLs, headers, identifiers, source paths, and customer data.

Use a minimal synthetic reproduction. Follow [SUPPORT.md](../SUPPORT.md) for ordinary issues and [SECURITY.md](../SECURITY.md) for suspected vulnerabilities.

## Removing Local Data

Use **Clear** in the workbench to delete telemetry while preserving settings and the MCP token.

For a complete source-launcher reset, close OTelux and remove its canonical data directory:

```bash
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/otelux"
# Optional Electron profile/cache state used by the local source launcher:
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/otelux/local"
```

Inspect **Settings → Database location** before deleting files. Removing `otelux.db`, `settings.json`, and `mcp-token` resets telemetry, settings, and plugin authentication respectively. Stop OTelux before deleting the database or its `-wal`/`-shm` sidecars. Legacy Electron files are copied, not deleted, during migration.
