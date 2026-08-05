# Getting Started With OTelux

Updated: 2026-08-04

OTelux publishes Linux x64 and arm64 `.deb` and AppImage prereleases through GitHub Releases. The repository is temporarily private during pre-public hardening, so downloads currently require repository access. Download `SHA256SUMS` plus one immutable package from [v0.1.11](https://github.com/b1tank/otelux/releases/tag/v0.1.11).

Install the x64 Debian/Ubuntu package:

```bash
grep '  OTelux-.*-amd64.deb$' SHA256SUMS | sha256sum -c -
sudo apt install ./OTelux-0.1.11-amd64.deb
```

Or run the rootless x64 AppImage:

```bash
grep '  OTelux-.*-x86_64.AppImage$' SHA256SUMS | sha256sum -c -
chmod +x OTelux-0.1.11-x86_64.AppImage
./OTelux-0.1.11-x86_64.AppImage
```

On arm64, use the corresponding `OTelux-0.1.11-arm64.deb` or `.AppImage` and matching checksum line. Do not install OTelux through an unofficial `curl | sudo sh` command or third-party package. Source setup remains available below for contributors.

The [Current Baseline](spec.md#current-baseline) is the source of truth for implemented capabilities and limitations. This guide describes the current pre-release desktop behavior.

## Requirements

Packaged releases require Linux x64 or arm64. Source development additionally requires Node.js 22.12 or later, npm 10.9.x, and `curl` for the ingest checks below.

Windows and macOS source development may work, but they are not supported desktop targets until their release artifacts pass [release qualification](test.md#release-qualification).

## Run From Source

From a trusted checkout:

```bash
npm ci
./otelux.sh
```

`otelux.sh` builds every workspace package before launching Electron. The runtime stores settings, token, state, and its default database under:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/otelux/
```

Set `OTELUX_DATA_DIR` to override this location for development or tests. Existing source/packaged Desktop data is copied into the canonical directory on first launch when no canonical database exists; source files are preserved. Two populated default databases are never merged or overwritten. Telemetry persists in SQLite, so received traces, logs, and metrics survive restarts. You can point the database at a custom absolute path in Settings → Storage → Database location (the current path has a copy action; a change takes effect on the next launch). Old data is pruned by the retention setting (default 72 hours or 512 MB, whichever comes first; set either to `0` to disable that bound).

After one successful build, launch the existing output without rebuilding:

```bash
./otelux.sh --no-build
```

Override the OTLP port for one run without changing saved settings:

```bash
./otelux.sh --port 4399
```

## Verify The Endpoints

By default, the desktop starts three loopback listeners:

| Service | Default endpoint | Current behavior |
|---|---|---|
| OTLP/HTTP | `http://127.0.0.1:4319` | Accepts OTLP/HTTP JSON and protobuf traces, logs, and metrics. |
| MCP HTTP | `http://127.0.0.1:4320/` | Enabled by default and exposes read-only telemetry tools with its own token. |
| Runtime API | `http://127.0.0.1:4321/` | Authenticated local JSON-RPC/SSE foundation for future Desktop, CLI, and browser clients. |

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

Settings → Connections can change OTLP/MCP ports and disable MCP. The Runtime API currently uses its discovered loopback port from `runtime.json`; it has a separate owner-only `runtime-token` and rejects browser origins until scoped browser-session bootstrap ships. Listener bind or settings-file persistence failures roll back to previous healthy listeners and do not alter saved settings.

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

Open the Traces, Logs, and Metrics rail tabs to inspect the records. **Source** groups related component services by the standard resource `service.namespace`; when that attribute is absent, OTelux uses exact `service.name`. Selecting a source reveals its component **Service** filter. Multi-process exporters can opt into clean grouping without losing service identity, for example `OTEL_RESOURCE_ATTRIBUTES=service.namespace=codex`. OTelux never infers a source from service-name prefixes. The rail's **About OTelux** action reports the exact packaged app version and its Electron, Chromium, Node.js, and platform versions for diagnostics. All repository fixtures are synthetic and safe to use in tests and issue reproductions.

To explore the UI before wiring any exporter, launch the desktop app and click **Load sample data** in the empty Traces view. It seeds the store with a small, clearly-labelled synthetic dataset (a distributed trace with an error, correlated logs, and a counter/histogram/gauge) across all three signals. The sample data persists like real telemetry and is removed by retention or by deleting the database.

Closing the OTelux window hides it to the system tray; OTLP ingest, MCP, and the Runtime API remain active. Use the tray icon to reopen the workbench or choose **Quit OTelux** to stop all listeners and close the SQLite database. The **Pause** control freezes live list refreshes only: telemetry continues to enter SQLite, and resuming catches the UI up. While live, new rows never replace the trace you are inspecting; the waterfall's **Selected trace** badge remains until you explicitly choose another row. **Clear data** permanently deletes stored traces, logs, metrics, resources, and instrumentation scopes while preserving settings and the MCP token.

For Codex CLI and other real exporters, see the recipes below.

## Configure Your Own Exporter

OTelux is a standard OTLP/HTTP receiver. Point any OpenTelemetry SDK, the OpenTelemetry Collector, or an OTLP-emitting app at `http://127.0.0.1:4319` (or your configured port). Both encodings are accepted: **protobuf** (`application/x-protobuf`, the SDK default) and **JSON** (`application/json`).

> OTelux does not support OTLP/**gRPC** yet. Exporters that default to gRPC (for example the Python and .NET OTLP exporters) must be set to **`http/protobuf`** (or `http/json`) and the HTTP endpoint below.

### Environment variables (any SDK)

Most SDKs honor the standard OTLP environment variables. Set the protocol explicitly so a gRPC default does not take over:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf   # or http/json
```

The SDK appends `/v1/traces`, `/v1/logs`, and `/v1/metrics` to the base endpoint.

### OpenTelemetry Collector

Add an `otlphttp` exporter and route each pipeline to it:

```yaml
exporters:
  otlphttp/otelux:
    endpoint: http://127.0.0.1:4319

service:
  pipelines:
    traces:
      exporters: [otlphttp/otelux]
    logs:
      exporters: [otlphttp/otelux]
    metrics:
      exporters: [otlphttp/otelux]
```

### Node.js

```bash
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-proto
```

```js
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://127.0.0.1:4319/v1/traces' }),
});
sdk.start();
```

### Python

```bash
pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

Zero-code, via `opentelemetry-instrument`:

```bash
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
  OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319 \
  opentelemetry-instrument python your_app.py
```

The bare `opentelemetry-exporter-otlp` package defaults to gRPC; install the `-http` variant above (or set the protocol) so exports reach OTelux.

### .NET

```bash
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
```

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing.AddOtlpExporter(o =>
    {
        o.Endpoint = new Uri("http://127.0.0.1:4319");
        o.Protocol = OtlpExportProtocol.HttpProtobuf; // default is gRPC
    }));
```

### Codex CLI

Codex CLI is the reference workload. Configure its `config.toml` with full per-signal endpoints:

```toml
[otel]
environment = "dev"
log_user_prompt = true

[otel.exporter.otlp-http]
endpoint = "http://localhost:4319/v1/logs"
protocol = "json"

[otel.trace_exporter.otlp-http]
endpoint = "http://localhost:4319/v1/traces"
protocol = "json"

[otel.metrics_exporter.otlp-http]
endpoint = "http://localhost:4319/v1/metrics"
protocol = "json"
```

See the [reference workload](spec.md#reference-workload-codex-cli) for details.

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
ss -ltnp | grep -e ':4319 ' -e ':4320 ' -e ':4321 '
```

Stop the conflicting process or choose different configurable ports in Settings. The Runtime API bind error is recorded in `runtime.json` and does not stop OTLP/MCP/SQLite. Do not expose any listener on a non-loopback address unless you understand the consequences in the [security model](security-model.md).

### The app starts but receives no telemetry

Verify all of the following:

- The exporter uses OTLP/HTTP (JSON or protobuf), not gRPC.
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

Telemetry persists to a local SQLite database, so a normal restart keeps your data. If data is missing, the retention setting may have pruned it: telemetry older than the age bound, or beyond the size bound (default 72 hours / 512 MB), is dropped. Adjust or disable retention in Settings → Storage → Retention (`0` = no limit). If the database file was unreadable at startup (corrupt, or written by a newer OTelux), it is renamed aside with a `.corrupt-<timestamp>` suffix and a fresh database is created — the old file is preserved next to it for manual recovery, never deleted. Schema migration across future storage versions is tracked in [plan.md](plan.md#phase-2--durable-local-storage).

Settings → Storage → Retention includes a live SQLite budget meter. Its fill tracks the database-page count used by retention pruning; the line below reports actual disk footprint for the main database plus WAL and SHM sidecars. WAL overhead can temporarily raise physical disk usage between retention passes; each pass checkpoints and truncates WAL before and after pruning so sustained ingestion does not leave that sidecar growing outside the database-page budget.

### The Linux packaging command fails or produces incomplete artifacts

The current supported prerelease packages are the checksum/provenance-verified Linux x64/arm64 `.deb` and AppImage assets from GitHub Releases. Locally generated files under `apps/desktop/release/` remain unsupported until they are published and independently verified through the release gate.

## Remove The Local Source Installation

Fully quit OTelux from the tray, then remove the optional launcher files:

```bash
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
rm -f "$DATA_HOME/applications/otelux-local.desktop"
rm -f "$DATA_HOME/icons/hicolor/512x512/apps/otelux-local.png"
```

Remove local telemetry and settings only when you intentionally want to reset them:

```bash
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/otelux"
# Optional: remove Electron-only profile/cache state from the source launcher.
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/otelux/local"
```

Finally, delete the source checkout if it is no longer needed. `npm ci` and local builds do not install a system service or background daemon.

Official package install, upgrade, verification, and uninstall instructions will replace the source-only sections when versioned artifacts are published.
