# Getting Started With OTelux

Updated: 2026-07-14

OTelux has not published a supported binary release yet. The only current installation path is a local source checkout. Do not install OTelux through an unofficial `curl | sudo sh` command or third-party package.

The [Current Baseline](spec.md#current-baseline) is the source of truth for implemented capabilities and limitations. This guide describes the current pre-release desktop behavior.

## Requirements

- Linux
- Node.js 22.12 or later
- npm 10.9.x
- `curl` for the ingest checks below

Windows and macOS source development may work, but they are not supported desktop targets until their release artifacts pass [release qualification](test.md#release-qualification).

## Run From Source

From a trusted checkout:

```bash
npm ci
./otelux.sh
```

`otelux.sh` builds every workspace package before launching Electron. The local launcher stores settings under:

```text
${XDG_CONFIG_HOME:-$HOME/.config}/otelux/local/settings.json
```

It persists telemetry to a local SQLite database in the user-data directory, so received traces, logs, and metrics survive restarts. Old data is pruned by the retention setting (default 72 hours or 512 MB, whichever comes first; set either to `0` to disable that bound).

After one successful build, launch the existing output without rebuilding:

```bash
./otelux.sh --no-build
```

Override the OTLP port for one run without changing saved settings:

```bash
./otelux.sh --port 4399
```

## Verify The Endpoints

By default, the desktop starts two loopback listeners:

| Service | Default endpoint | Current behavior |
|---|---|---|
| OTLP/HTTP | `http://127.0.0.1:4319` | Accepts JSON traces, logs, and metrics. |
| MCP HTTP | `http://127.0.0.1:4320/` | Enabled by default and exposes read-only telemetry tools. |

Check the OTLP receiver:

```bash
curl --fail http://127.0.0.1:4319/healthz
```

Expected output:

```text
ok
```

Check the MCP server identity:

```bash
curl --fail http://127.0.0.1:4320/
```

The Settings dialog can change both ports and disable MCP. OTLP and MCP must use different ports. A listener bind failure rolls back to the previous healthy listener and does not alter saved settings. A later settings-file write failure is a known pre-release atomicity gap.

## Send Synthetic Telemetry

With OTelux running, open another terminal in the repository root.

Send a trace:

```bash
./scripts/send-traces.sh
```

Send synthetic Codex-shaped logs:

```bash
curl --fail-with-body \
  -H 'Content-Type: application/json' \
  --data-binary @fixtures/sample_codex_logs.json \
  http://127.0.0.1:4319/v1/logs
```

Send synthetic Codex-shaped metrics:

```bash
curl --fail-with-body \
  -H 'Content-Type: application/json' \
  --data-binary @fixtures/sample_codex_metrics.json \
  http://127.0.0.1:4319/v1/metrics
```

Open the Traces, Logs, and Metrics rail tabs to inspect the records. All repository fixtures are synthetic and safe to use in tests and issue reproductions.

For Codex CLI exporter configuration, see the specification's [reference workload](spec.md#reference-workload-codex-cli). The current receiver requires `protocol = "json"` and full `/v1/traces`, `/v1/logs`, and `/v1/metrics` endpoint paths.

## Add A Local Desktop Entry

After building successfully:

```bash
./otelux.sh --install-desktop-only
```

This installs the launcher without building or starting OTelux. Use `./otelux.sh --install-desktop` when you want to install and launch in one command. The generated entry uses the checkout's absolute path. Moving or deleting the checkout therefore breaks that entry.

Installed files:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/applications/otelux-local.desktop
${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps/otelux-local.png
```

This is a development convenience, not an official system package.

## Troubleshooting

### A listener cannot start

Find the process using either default port:

```bash
ss -ltnp | grep -e ':4319 ' -e ':4320 '
```

Stop the conflicting process or choose different ports in Settings. Do not expose either listener on a non-loopback address unless you understand the consequences in the [security model](security-model.md).

### The app starts but receives no telemetry

Verify all of the following:

- The exporter uses OTLP/HTTP JSON, not protobuf or gRPC.
- The signal uses its full endpoint path.
- The host and port match the green OTLP endpoint shown in OTelux.
- `curl http://127.0.0.1:4319/healthz` succeeds.
- The exporter is not sending to the standard collector port `4318` by mistake.

### Changes to shared UI code do not appear

Run the root build rather than only the desktop build:

```bash
npm run build
./otelux.sh --no-build
```

The root build refreshes upstream workspace outputs before bundling the desktop renderer.

### Telemetry disappeared after restart

Telemetry persists to a local SQLite database, so a normal restart keeps your data. If data is missing, the retention setting may have pruned it: telemetry older than the age bound, or beyond the size bound (default 72 hours / 512 MB), is dropped. Adjust or disable retention in Settings → Data retention (`0` = no limit). Schema migration across future storage versions is tracked in [plan.md](plan.md#phase-2--durable-local-storage).

### The Linux packaging command fails or produces incomplete artifacts

Packaging is under active release hardening. The current target is `.deb`; AppImage is disabled because its generated launcher can silently disable Chromium's sandbox on unsupported hosts. Locally generated files under `apps/desktop/release/` are not supported releases. Follow [release-sprint.md](release-sprint.md#milestone-3---official-linux-beta) for the packaging gate rather than distributing those files.

## Remove The Local Source Installation

Close OTelux, then remove the optional launcher files:

```bash
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
rm -f "$DATA_HOME/applications/otelux-local.desktop"
rm -f "$DATA_HOME/icons/hicolor/512x512/apps/otelux-local.png"
```

Remove local settings only when you intentionally want to reset them:

```bash
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/otelux/local"
```

Finally, delete the source checkout if it is no longer needed. `npm ci` and local builds do not install a system service or background daemon.

Official package install, upgrade, verification, and uninstall instructions will replace the source-only sections when versioned artifacts are published.
