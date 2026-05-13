# @otelux/ui

React components for the OTelux viewer. Consumes a `DataSource` from
`@otelux/protocol`; never imports `@otelux/engine` directly. Styling uses
CSS Modules + CSS variables so hosts (Linux desktop, VS Code webview,
browser demo) can theme via `--otelux-*` tokens or, when running under
VS Code, inherit `--vscode-*` automatically.

Phase 0 ships a placeholder component. Full components — Waterfall,
TraceList, SpanDetail, Toolbar, Settings, theme tokens, Storybook stories,
Playwright visual snapshots — land in Phase 1.
