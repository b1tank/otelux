<p align="center">
  <img src="apps/desktop/build/icon.svg" width="128" alt="OTelux logo" />
</p>

<h1 align="center">OTelux</h1>

<p align="center">
  <strong>A local-first OpenTelemetry workbench for developers and coding agents.</strong>
  <br />
  Receive, explore, and investigate traces, logs, and metrics without sending telemetry to a hosted backend.
</p>

<p align="center">
  <a href="#install-the-linux-prerelease">Install</a> ·
  <a href="#what-you-can-do">Features</a> ·
  <a href="docs/getting-started.md">Quick start</a> ·
  <a href="#docs">Docs</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/b1tank/otelux/releases"><img alt="Latest prerelease" src="https://img.shields.io/github/v/release/b1tank/otelux?include_prereleases&sort=semver&display_name=tag&style=flat-square&label=release" /></a>
  <a href="https://github.com/b1tank/otelux/releases"><img alt="Release downloads" src="https://img.shields.io/github/downloads/b1tank/otelux/total?style=flat-square&label=downloads" /></a>
  <a href="https://github.com/b1tank/otelux/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/b1tank/otelux/ci.yml?branch=main&style=flat-square&label=build%20%26%20test" /></a>
  <a href="https://github.com/b1tank/otelux/actions/workflows/codeql.yml"><img alt="CodeQL" src="https://img.shields.io/github/actions/workflow/status/b1tank/otelux/codeql.yml?branch=main&style=flat-square&label=CodeQL" /></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/b1tank/otelux?style=flat-square" /></a>
</p>

<p align="center">
  <img src="docs/assets/otelux-demo-v2.gif" alt="OTelux cycling through a distributed trace waterfall, span details, structured logs, and metric series" />
</p>

## What you can do

- **Inspect complete requests:** navigate virtualized trace waterfalls and searchable span details, including attributes, resources, events, and links.
- **Correlate every signal locally:** search structured logs, explore metric series, and group telemetry by standard OpenTelemetry Source and Service identity.
- **Give coding agents bounded evidence:** query read-only traces, logs, service health, and agent-run correlation through the built-in MCP server.
- **Keep ownership of telemetry:** data stays in a retention-bounded local SQLite database; OTLP, MCP, and authenticated Runtime API listeners bind to loopback.

## Install the Linux prerelease

> The repository is temporarily private during pre-public hardening, so GitHub release downloads currently require repository access.

Download `SHA256SUMS` and one package from the [v0.1.11 GitHub Release](https://github.com/b1tank/otelux/releases/tag/v0.1.11).

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

For Linux arm64, use `OTelux-0.1.11-arm64.deb` or `OTelux-0.1.11-arm64.AppImage` and the matching checksum line.

| Platform | Package | Status |
| --- | --- | --- |
| Linux x64 | `.deb`, AppImage | Qualified prerelease |
| Linux arm64 | `.deb`, AppImage | Qualified prerelease |
| macOS arm64/x64 | — | Signing and notarization planned |
| Windows x64/arm64 | — | Signed installer planned |

Source setup is documented in [Getting Started](docs/getting-started.md). OTelux does not recommend piping mutable network scripts into a privileged shell.

## Product Ecosystem

The target product is one per-user OTelux runtime presented through four install and interaction forms: agent plugin, direct MCP integration, CLI, and Desktop. They share one receiver, engine, active SQLite database, query contract, and browser-safe UI. Installing another form later connects it to the same local data instead of creating another backend.

The browser workbench is not a separate product. The plugin and CLI open the shared workbench from the local runtime in a browser; Desktop embeds the same `@otelux/ui` application in its native shell.

| Form | End-user experience | Availability |
|---|---|---|
| Agent plugin | Install in Claude or Codex to get OTelux skills, MCP tools, telemetry setup workflows, and a dashboard command. | Desktop-companion `0.1.5` exists; self-contained runtime is planned. |
| Direct MCP | Register OTelux as an MCP server without plugin skills or Electron. | Planned standalone packaging; current bridge connects to Desktop. |
| CLI | Run OTelux headlessly, inspect health and endpoints, manage settings, and open the browser workbench. | Planned. |
| Desktop app | Use the native traces, logs, and metrics workbench with receiver and retention settings. | Pre-release app starts or reconnects to one on-demand packaged daemon; exiting Desktop leaves ingest running. |

```mermaid
flowchart LR
  Sources[Applications and agent telemetry] -->|OTLP/HTTP| Runtime[One local OTelux runtime]
  Plugin[Agent plugin] --> Runtime
  MCP[Direct MCP] --> Runtime
  CLI[CLI] --> Runtime
  Desktop[Desktop] --> Runtime
  Runtime --> Engine[Shared receiver, engine, MCP, and UI API]
  Runtime --> Workbench[Shared workbench UI]
  Plugin -.->|open in browser| Workbench
  CLI -.->|open in browser| Workbench
  Desktop -.->|embed| Workbench
  Engine --> DB[(One active SQLite database)]
```

The runtime is the only process that opens SQLite, applies migrations and retention, and binds OTLP/MCP/Runtime API listeners. See [docs/arch.md](docs/arch.md) for lifecycle, migration, package boundaries, end-user scenarios, and the distinction between the current and target implementations.

## Docs

- [docs/spec.md](docs/spec.md) — product, architecture, current state, package boundaries, and UX requirements.
- [docs/plan.md](docs/plan.md) — work ahead only.
- [docs/release-sprint.md](docs/release-sprint.md) — finite public-release execution plan, launch gates, and evidence.
- [docs/getting-started.md](docs/getting-started.md) — current source setup, first telemetry, troubleshooting, and removal.
- [docs/privacy.md](docs/privacy.md) — local data handling and safe telemetry sharing.
- [docs/security-model.md](docs/security-model.md) — trust boundaries, current safeguards, and release blockers.
- [docs/arch.md](docs/arch.md) — the four product forms, shared local runtime, UI delivery, data ownership, and end-user scenarios.
- [docs/agent-onboarding.md](docs/agent-onboarding.md) — CLI contract, safe multi-agent integration engine, Settings → Agents, onboarding, packaging, milestones, and acceptance matrix.
- [docs/protocol.md](docs/protocol.md) — channel matrix, transport choices, Runtime RPC/SSE wire rules, versioning, and schema requirements.
- [docs/storage.md](docs/storage.md) — SQLite identity, indexing, pagination, query budgets, audit findings, and performance verification.
- [docs/proposal.md](docs/proposal.md) — project rationale, audience, and product direction.
- [docs/test.md](docs/test.md) — manual desktop verification plan.
- [design/README.md](design/README.md) — UI mockup philosophy and design notes.

## Community

- [CONTRIBUTING.md](CONTRIBUTING.md) — development workflow and pull request expectations.
- [SUPPORT.md](SUPPORT.md) — support scope and telemetry privacy guidance.
- [SECURITY.md](SECURITY.md) — vulnerability reporting policy and current launch gate.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community standards and confidential reporting.

Never post credentials or raw production telemetry in a public issue. Use synthetic fixtures or redact prompts, SQL, URLs, headers, identifiers, paths, and customer data.

## Repository Layout

```text
otelux/
  apps/
    desktop/            # Electron desktop workbench
  packages/
    types/              # Shared telemetry types
    protocol/           # DataSource interface and query/result shapes
    engine/             # Ingest, query, layout, subscriptions, storage boundary
    engine-node/        # Node local-storage adapter
    local-runtime/      # Storage, engine, OTLP, MCP, settings, lifecycle
    receiver/           # OTLP receiver
    mcp-server/         # Read-only MCP JSON-RPC tools
    adapter-direct/     # In-process DataSource adapter
    adapter-http/       # Browser-safe authenticated JSON-RPC/SSE adapter
    ui/                 # React workbench and primitives
  plugins/
    otelux/             # Shared Claude/Codex skills + MCP launcher/bridge
  fixtures/             # OTLP JSON fixtures for traces, logs, and metrics
  docs/                 # Canonical project docs
  design/               # Single-file UI mockup and notes
```

## Develop

Requires Node 22.12+ and npm 10.9.x.

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
```

Launch the desktop app in development:

```bash
npm run -w @otelux/desktop dev
```

Build the desktop app:

```bash
npm run -w @otelux/desktop build
```

Test the current `0.1.5` local agent plugin after starting the desktop app:

```bash
# Codex
codex plugin marketplace add .
codex plugin add otelux@otelux-plugins

# Claude Code
claude plugin marketplace add /absolute/path/to/otelux
claude plugin install otelux@otelux-plugins
```

Both hosts currently load the same four skills and connect to the desktop's authenticated, read-only MCP listener. The target plugin starts or discovers the shared local runtime and no longer requires Desktop. See [plugins/otelux/README.md](plugins/otelux/README.md) for current usage and [docs/arch.md](docs/arch.md#current-implementation) for the migration plan.

Exercise the current Linux packaging target while release work is in progress:

```bash
npm run -w @otelux/desktop package
```

## Current Status

Pre-release and temporarily private during pre-public hardening. Linux x64 and arm64 Desktop packages are published as `v0.1.11` for repository collaborators, including the authenticated Runtime JSON-RPC/SSE host, browser-safe HTTP adapter, bounded log/metric list-detail contracts, direct/HTTP parity suite, and foreground `oteluxd` foundation. `@otelux/local-runtime` owns storage, engine, OTLP, MCP, Runtime API, settings, lifecycle, canonical data-home migration, and nonce-protected runtime state. Desktop now starts or reconnects to it as an HTTP/SSE client, while the `0.1.5` plugin remains a Desktop launcher companion. Explicit daemon lifecycle controls, CLI, direct MCP package, and runtime-served workbench remain planned. Start with [docs/getting-started.md](docs/getting-started.md). See the specification's [Current Baseline](docs/spec.md#current-baseline) for implemented capabilities, [docs/arch.md](docs/arch.md#current-implementation) for the architecture transition, [docs/plan.md](docs/plan.md) for future work, and [docs/release-sprint.md](docs/release-sprint.md) for temporary `v0.1.0` launch execution.

## License

[MIT](LICENSE).
