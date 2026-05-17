# OTelux

A local-first OpenTelemetry workbench. **Milestone 1: ship a Linux desktop
app you can install and use** — it listens on `http://localhost:4319` for
OTLP/HTTP traces and shows them in a fast workbench with a compact trace
list, a per-service-colored waterfall, and a span detail drawer. Internally,
the same React components, engine, and protocol are packaged as
`@otelux/*` workspaces so they can later embed in VS Code webviews and a
pure-browser demo without forking the codebase.

The plan is intentionally slow: one signal at a time, end to end, until it
beats every general-purpose OTel viewer for local development.

- [docs/spec.md](docs/spec.md) — what OTelux is.
- [docs/plan.md](docs/plan.md) — how it ships.
- [docs/test.md](docs/test.md) — the manual end-to-end test plan for the desktop app.
- [design/README.md](design/README.md) — UI redesign philosophy and the
  [`design/redesign-mockup.html`](design/redesign-mockup.html) reference.

## Repository layout

```text
otelux/
  apps/
    desktop/                 # Electron + Vite. The headline product.
  packages/
    types/                   # OpenTelemetry TS types
    protocol/                # DataSource interface
    engine/                  # Pure-TS query/layout/ingest
    engine-node/             # node:sqlite storage adapter
    receiver/                # OTLP/HTTP + gRPC server
    adapter-direct/          # In-process DataSource
    ui/                      # React components
  fixtures/                  # OTLP JSON fixtures for tests + stories
  docs/                      # spec.md, plan.md
```

## Develop

Requires Node 22+ (the SQLite module is built in).

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

To launch the desktop app in dev (hot-reloaded renderer):

```sh
npm run -w @otelux/desktop dev
```

To produce a Linux AppImage and `.deb` under `apps/desktop/release/`:

```sh
npm run -w @otelux/desktop package
```

## Status

Pre-release. Milestone 1 (Linux desktop trace workbench) is in progress —
the Electron shell, OTLP/HTTP JSON receiver, in-memory engine, and the
`@otelux/ui` workbench (trace list, waterfall, span drawer, settings) are
shipping end-to-end against local OTel SDKs. Persistent `node:sqlite`
storage, OTLP gRPC + protobuf, and packaging polish are still to come.
See [docs/plan.md](docs/plan.md).

## License

MIT.