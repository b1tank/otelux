# Phase 0 Sprint Plan — Foundation for desktop + VS Code extension

Goal: make the repo match the updated `spec.md` and `plan.md` so an
intern can clone tomorrow and start landing real Phase 1 features
without first having to scaffold the missing packages and apps.

Scope: skeletons only. Every package compiles, types check, and tests
pass with `npm run typecheck && npm run test && npm run build`. No
behavior changes outside of the explicit MCP-server-toggle UX in the
desktop app (which is part of this sprint).

## Tasks (in dependency order)

1. **Scaffold `packages/adapter-vscode/`** — empty package with
   `serveDataSource(webview, dataSource)` host-side stub and
   `createPostMessageDataSource(vscodeApi)` webview-side stub. Both
   speak a tagged-union JSON-RPC over `postMessage`. No `vscode`
   import — webview-portable.

2. **Scaffold `packages/mcp-server/`** — JSON-RPC dispatcher with HTTP
   (Hono router) and stdio transports. The 6 read-only tools from
   spec § 12.3 implemented as thin wrappers over `@otelux/engine`.
   Agent-run correlation tool returns an empty result until the engine
   detection lands in Phase 1 — but the shape is locked.

3. **`packages/receiver/src/singleInstance.ts`** — `claimSingleInstance`
   helper per spec § 7.1. Lockfile + healthz ping, three cases:
   no-existing → owner; existing-alive → client; existing-stale → owner
   after lockfile takeover.

4. **`packages/ui/src/tokens.css`** — add `--vscode-*` mapping block so
   the same workbench inherits VS Code theme transparently when mounted
   in a webview. Desktop is unaffected (the `--vscode-*` vars resolve to
   nothing and the `--otelux-*` fallback wins).

5. **Scaffold `apps/vscode-extension/`** — minimal manifest +
   `esbuild.host.mjs` for the host entry + `vite.webview.config.ts` for
   the webview entry. `npm run -w apps/vscode-extension package`
   produces a `.vsix` that activates and opens an empty webview.

6. **Desktop MCP server UX** — add an `mcp.enabled` setting (default
   on), expose its lifecycle through IPC, render a status row + toggle
   in the Settings modal, and surface a small "MCP" pill in the
   endpoint bar when it is on.

7. **Build check** — `npm install && npm run typecheck && npm run build
   && npm run test`.

8. **Push** — push all commits to `origin/main`.

## Hiccups & Notes

(Populated during execution.)

## Status

- [x] 1 — adapter-vscode
- [x] 2 — mcp-server
- [x] 3 — receiver claimSingleInstance
- [x] 4 — UI vscode token mapping
- [x] 5 — apps/vscode-extension scaffold
- [x] 6 — desktop MCP server UX
- [x] 7 — build check
- [x] 8 — push
