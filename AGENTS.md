# AGENTS.md — OTelux

Local-first OpenTelemetry workbench: a Linux Electron desktop app plus reusable npm packages. npm workspaces + Turborepo, TypeScript, Biome, vitest.

## Skills — reach for these first

Repo-local skills live in `.agents/skills/`. Prefer them over ad-hoc tooling:

- **self-verify** (`.agents/skills/self-verify/SKILL.md`) — verify the desktop app, whether a full `docs/test.md` regression **or a quick smoke-check of one feature you just changed** ("does the Logs tab render?"). Drives the app through **deskpal** (OCR + virtual mouse/keyboard) exactly like a real user. Use it for ANY user-visible verification.
- **design** (`.agents/skills/design/SKILL.md`) — iterate on the UI design mockup before implementing in React.

## Docs home — keep these in sync with code

Canonical project docs live in `docs/` (not the repo root). When behavior changes, update the relevant doc in the **same** change:

- `docs/spec.md` — product/architecture spec (source of truth for scope).
- `docs/plan.md` — forward-looking work plan; keep completed phase history out.
- `docs/proposal.md` — the longer-form product proposal.
- `docs/test.md` — canonical manual regression plan (mirrored by self-verify).

New plan/spec/proposal/test material belongs under `docs/`, never the root.

## Verifying your work

- **UI / user-visible behavior → use the self-verify skill (deskpal).** Never hand-roll `xdotool` / `import` / `xwininfo` for UI checks: icon-only buttons need pixel-offset guessing, and a raw click silently lands on whatever window is *stacked* on top (e.g. VS Code overlapping OTelux) while a screenshot of the target's buffer still looks correct — yielding false "the click did nothing" readings.
- **Data layer (ingest, list/search, timestamps) → use the MCP tools** (server on port 4320, e.g. `otel_search_logs`). Assert the data, don't screenshot it.
- **Invisible-to-the-eye state → CDP escape hatch** (`/tmp/otelux-cdp.mjs`): IPC result JSON, `settings.json` contents, focused element. Not for "did the user see X".

## Build / test / lint

- Build/test/typecheck go through Turborepo: `npx turbo run build|test|typecheck` (scope with `--filter=@otelux/<pkg>`).
- Lint/format with Biome, but **only check the files you edited** (`biome check --write <paths>`) — a bare `biome check --write .` reformats unrelated files via `organizeImports`.
- `exactOptionalPropertyTypes` is ON: never pass an explicit `undefined` to an optional prop; use a conditional spread `...(x !== undefined ? { x } : {})`.

## Run the desktop app

`cd apps/desktop && DISPLAY=:1 npm run dev` (X11 display `:1`). The receiver listens on OTLP/HTTP **4319** (`/v1/traces`, `/v1/logs`); the MCP server on **4320**. electron-vite HMR consumes `packages/ui/dist`, so **rebuild `@otelux/ui`** for the desktop to pick up UI changes.

## Layout

- `packages/` — `types`, `protocol`, `engine`, `engine-node`, `receiver`, `mcp-server`, `ui`, `adapter-direct`, `adapter-vscode`.
- `apps/` — `desktop` (Electron), `vscode-extension`.
- Adding a `DataSource` method means updating **all** consumers: `ipcDataSource`, `adapter-direct`, `adapter-vscode` (protocol + host + webview + test), and the `ui`/adapter test fakes.
