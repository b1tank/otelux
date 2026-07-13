# OTelux

OTelux is a local-first OpenTelemetry workbench. It receives traces, logs, and metrics from local apps, renders them in a desktop workbench, and exposes read-only query tools for local coding agents.

The desktop app is the main product. The same engine, UI, receiver, adapters, and MCP tools are organized as private `@otelux/*` workspace packages so they can also run inside the experimental VS Code extension without forking the codebase. They are not currently published to npm.

## Docs

- [docs/spec.md](docs/spec.md) — product, architecture, current state, package boundaries, and UX requirements.
- [docs/plan.md](docs/plan.md) — work ahead only.
- [docs/release-sprint.md](docs/release-sprint.md) — finite public-release execution plan, launch gates, and evidence.
- [docs/proposal.md](docs/proposal.md) — project rationale, audience, and product direction.
- [docs/test.md](docs/test.md) — manual desktop verification plan.
- [design/README.md](design/README.md) — UI mockup philosophy and design notes.

## Repository Layout

```text
otelux/
  apps/
    desktop/            # Electron desktop workbench
    vscode-extension/   # VS Code webview + receiver + MCP/LM tools
  packages/
    types/              # Shared telemetry types
    protocol/           # DataSource interface and query/result shapes
    engine/             # Ingest, query, layout, subscriptions, storage boundary
    engine-node/        # Node local-storage adapter
    receiver/           # OTLP receiver
    mcp-server/         # Read-only MCP JSON-RPC tools
    adapter-direct/     # In-process DataSource adapter
    adapter-vscode/     # VS Code postMessage DataSource adapter
    ui/                 # React workbench and primitives
  fixtures/             # OTLP JSON fixtures for traces, logs, and metrics
  docs/                 # Canonical project docs
  design/               # Single-file UI mockup and notes
```

## Develop

Requires Node 22+ and npm 10.9.x.

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

Exercise the current Linux packaging target while release work is in progress:

```bash
npm run -w @otelux/desktop package
```

## Current Status

Pre-release. See the specification's [Current Baseline](docs/spec.md#current-baseline) for implemented capabilities and current limits, [docs/plan.md](docs/plan.md) for future product work, and [docs/release-sprint.md](docs/release-sprint.md) for temporary `v0.1.0` launch execution.

## License

MIT.
