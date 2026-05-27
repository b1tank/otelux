# @otelux/vscode-extension

VS Code extension that opens OTelux inside the IDE.

## What ships

- `OTelux: Open Telemetry Explorer` command — opens the workbench in a webview, themed via `--vscode-*` tokens.
- Embedded OTLP/HTTP receiver on `127.0.0.1:4318`, co-existing with the desktop app via the single-instance lockfile in `@otelux/receiver`.
- Embedded MCP HTTP server on `127.0.0.1:4319` so Codex CLI / Claude Code / Cursor can query OTelux.
- `vscode.lm` tool registrations so GitHub Copilot can call the same tools without leaving VS Code.

## Layout

- `src/host/` — Node.js extension host code (bundled by esbuild, `vscode` external).
- `src/webview/` — React app for the webview panel (bundled by Vite).

## Build

```bash
npm run -w @otelux/vscode-extension build
```

Produces `out/host/extension.cjs` and `out/webview/index.html` + assets.

## Status

Phase 0 scaffold. Wires modules together; needs end-to-end smoke testing,
real disk writes for agent enablement, and packaging via `vsce`.
