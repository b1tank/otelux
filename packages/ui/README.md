# @otelux/ui

React components for the OTelux viewer. Consumes a `DataSource` from
`@otelux/protocol`; never imports `@otelux/engine` directly. Styling uses
CSS variables (`packages/ui/src/tokens.css`) so hosts (Linux desktop,
VS Code webview, browser demo) can theme via `--otelux-*` tokens or, when
running under VS Code, inherit `--vscode-*` automatically.

## What ships in Milestone 1

The composed entry point is `OTeluxWorkbench` — the single component
hosts (Electron renderer, future VS Code webview, future browser demo)
mount. It owns the redesigned layout (left rail + topbar + filter bar +
resizable two-pane workbench + span drawer) and is driven entirely by
the `DataSource` it receives.

Building blocks exported from the package:

- **Layout** — `AppShell`, `Rail`, `Topbar`, `FilterBar`, `Workbench`,
  `Splitter`.
- **Domain** — `TraceList`, `Waterfall`, `SpanDetail` plus the pure
  `computeWaterfallLayout` geometry helpers.
- **Primitives** — `Drawer`, `Dropdown`, `Accordion`, `ToggleChip`,
  `SearchField`, `IconButton`, `CopyButton`, `ValueViewer`,
  `OTeluxLogo`, and the lucide-style `icons.tsx` set.
- **Helpers** — `formatDuration`, `formatTimeAgo`, `formatWallClock`,
  `serviceIndex`, `serviceColorVar`, `colorForService`, the
  `SERVICE_PALETTE` 8-color set, and the `useDataSourceQuery` hook.

Tests live next to their components (`*.test.tsx`) and run under Vitest.
Storybook stories and Playwright visual snapshots are planned in
[docs/plan.md](../../docs/plan.md) but are not yet wired up.

## Design source of truth

The visual contract for every component is the single-file mockup at
[`design/redesign-mockup.html`](../../design/redesign-mockup.html);
[`design/README.md`](../../design/README.md) explains the philosophy,
invariants, and component-map between the mockup classes and these
React components.
