# Privacy And Local Data

Updated: 2026-07-14

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

The desktop currently stores telemetry only in process memory. Closing the app discards traces, logs, and metrics.

The local source launcher stores port and MCP settings in:

```text
${XDG_CONFIG_HOME:-$HOME/.config}/otelux/local/settings.json
```

That settings file does not contain captured telemetry or credentials. Packaged releases will document their exact platform-specific data paths before publication. Durable telemetry storage is not considered shipped until its location, retention, migration, clear-data, and uninstall behavior pass release qualification.

## Network Behavior

The desktop currently binds OTLP and MCP HTTP listeners to `127.0.0.1`. Loopback prevents direct access from other machines, but it is not user isolation: other processes or users on the same host may be able to connect. Disable MCP on shared or multi-user hosts when agent access is not needed.

OTelux itself does not add analytics, crash reporting, or telemetry export. Explicit user actions can still cause data to leave the application:

- An enabled MCP or LM client can read selected telemetry and may send it to its own model or service. That client's privacy policy and configuration apply.
- Copy, download, or future export actions place data under the user's control.
- The GitHub link opens the project repository in the system browser.

The current MCP HTTP listener is enabled by default and unauthenticated. Disable MCP in Settings when agent access is not needed, especially on shared hosts. Explicit enablement or a per-install credential is required before a supported stable release, as described in the [security requirements](spec.md#security-requirements).

## Repository Fixtures

Fixtures committed under `fixtures/` are synthetic. They use deterministic test hosts, identifiers, providers, models, timestamps, traces, and spans while preserving relevant OTLP behavior.

Do not contribute captured production or personal telemetry. New fixtures must be synthetic or comprehensively sanitized and should carry an explicit synthetic marker where the wire format permits it.

## Issues And Support

Never attach raw production telemetry, credentials, database files, or unredacted logs to a public issue. Telemetry can reveal prompts, SQL, URLs, headers, identifiers, source paths, and customer data.

Use a minimal synthetic reproduction. Follow [SUPPORT.md](../SUPPORT.md) for ordinary issues and [SECURITY.md](../SECURITY.md) for suspected vulnerabilities.

## Removing Local Data

For the current source launcher, close OTelux and remove its settings directory only when you intend to reset all local settings:

```bash
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/otelux/local"
```

Telemetry is already discarded when the current memory-only app exits. Future durable releases must provide a visible clear-data operation and document package-specific data removal in [getting-started.md](getting-started.md) before they are supported.
