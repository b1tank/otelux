# OTelux

A local-first OpenTelemetry workbench. **Milestone 1: ship a Linux desktop
app you can install and use** — it listens on `http://localhost:4318` for
OTLP traces and shows them in a fast workbench with a virtualized trace
list, a per-service-colored waterfall, and a span detail panel. Internally,
the same React components, engine, and protocol are packaged as
`@otelux/*` workspaces so they can later embed in VS Code webviews and a
pure-browser demo without forking the codebase.

The plan is intentionally slow: one signal at a time, end to end, until it
beats every general-purpose OTel viewer for local development.

- [docs/spec.md](docs/spec.md) — what OTelux is.
- [docs/plan.md](docs/plan.md) — how it ships.
- [sprint.plan.md](sprint.plan.md) — current sprint.

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

Pre-release. Phase 0 ships the monorepo skeleton; Milestone 1 ships the
Linux desktop trace workbench. See [docs/plan.md](docs/plan.md).

## License

MIT.