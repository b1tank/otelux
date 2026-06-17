# OTelux

OTelux is a local-first OpenTelemetry workbench. It receives OTLP/HTTP JSON traces, logs, and metrics from local apps, renders them in a desktop workbench, and exposes read-only query tools for local coding agents.

The desktop app is the main product. The same engine, UI, receiver, adapters, and MCP tools are packaged under `@otelux/*` so they can also run inside the VS Code extension without forking the codebase.

## Docs

- [docs/spec.md](docs/spec.md) — product, architecture, current state, package boundaries, and UX requirements.
- [docs/plan.md](docs/plan.md) — work ahead only.
- [docs/proposal.md](docs/proposal.md) — project pitch and roadmap summary.
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
    engine/             # Ingest, query, layout, subscriptions, memory storage
    engine-node/        # Placeholder package for future node:sqlite storage
    receiver/           # OTLP/HTTP JSON receiver
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

Package the Linux desktop app:

```bash
npm run -w @otelux/desktop package
```

## Current Status

Pre-release. The local workbench can ingest and display traces, logs, and metrics over OTLP/HTTP JSON, including scalar metric graphs with visible axes and raw table fallback. Storage is currently in-memory; durable `node:sqlite` storage is planned. OTLP protobuf and gRPC are planned. The VS Code extension shell and MCP/LM tool plumbing exist but still need hardening and packaging work.

See [docs/plan.md](docs/plan.md) for the current work ahead.

## License

MIT.
