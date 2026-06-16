# @otelux/ui

React components for the OTelux viewer. Consumes a `DataSource` from `@otelux/protocol`. Styling uses CSS variables (`packages/ui/src/tokens.css`) so hosts such as the desktop app and VS Code webview can theme via `--otelux-*` tokens or, when running under VS Code, inherit `--vscode-*` automatically.

## What ships today

The composed entry point is `OTeluxWorkbench` — the single component hosts mount. It owns the layout (left rail + topbar + filter bars + workbench panes + detail drawer/value viewer) and is driven by the `DataSource` it receives.

Building blocks exported from the package:

- **Layout** — `AppShell`, `Rail`, `Topbar`, `FilterBar`, `Workbench`, `Splitter`.
- **Domain** — `TraceList`, `Waterfall`, `SpanDetail`, `LogsView`, `MetricsView`, plus waterfall geometry helpers.
- **Primitives** — `Drawer`, `Dropdown`, `Accordion`, `ToggleChip`, `SearchField`, `IconButton`, `CopyButton`, `ValueViewer`, `OTeluxLogo`, and the lucide-style `icons.tsx` set.
- **Helpers** — `formatDuration`, `formatTimeAgo`, `formatWallClock`, `serviceIndex`, `serviceColorVar`, `colorForService`, the `SERVICE_PALETTE` 8-color set, and the `useDataSourceQuery` hook.

Tests live next to their components (`*.test.tsx`) and run under Vitest. Storybook stories and Playwright visual snapshots are planned but are not yet wired up.

## Design source of truth

The visual contract for every component is the single-file mockup at [`design/redesign-mockup.html`](../../design/redesign-mockup.html); [`design/README.md`](../../design/README.md) explains the philosophy, invariants, and component-map between the mockup classes and these React components.
