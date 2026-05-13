# Sprint — Phase 0: Pivot landing

Goal: clean tree, scaffolded npm monorepo, CI green, empty Electron shell that
boots, README reflecting the M1 framing. Exit criterion (from
[docs/plan.md](docs/plan.md) § Phase 0):

> `npm install && npm run build && npm test` passes on a clean Ubuntu
> checkout. `npm run -w apps/desktop dev` opens an empty Electron window.

## Tasks

1. **Land docs reorg** — commit the new `docs/spec.md` + `docs/plan.md`
   and the deletions of root `plan.md`, `spec.md`, `sprint.plan.md`.
2. **Retire C++ core** — delete `src/`, `meson.build`, `vendor/`, `build/`,
   `res/`, `shaders/`, `test/`. Update `.gitignore` and `.vscode/`.
3. **Scaffold monorepo root** — root `package.json` (workspaces, scripts),
   `turbo.json`, `tsconfig.base.json`, `biome.json`, `.changeset/config.json`,
   `.npmrc`, updated `.gitignore`.
4. **Scaffold workspace packages** — empty stubs for `@otelux/types`,
   `@otelux/protocol`, `@otelux/engine`, `@otelux/engine-node`,
   `@otelux/receiver`, `@otelux/adapter-direct`, `@otelux/ui`.
5. **Scaffold apps/desktop** — Electron main + preload + Vite renderer,
   opens an empty window with title "OTelux".
6. **CI** — GitHub Actions workflow running `turbo run lint typecheck test build`
   on Ubuntu × Node 22.
7. **Rewrite README** — one-paragraph M1 framing, dev commands.
8. **Verify** — `npm install && npm run build && npm test`.

## Hiccups & Notes

- `fnm` auto-switched to Node 24 briefly after writing `.nvmrc`; subsequent
  shells respected the pin (Node 22.22.1). No action needed.
- `git add -A` did not pick up the newly created `.github/` directory in
  one batch; explicit `git add .github/` resolved it. Likely a working-tree
  index quirk. Watch for this on future runs.
- First `biome check` reported 14 errors (12 auto-fixable import-order
  drifts, 2 `useLiteralKeys` complaints in `apps/desktop/src/main/index.ts`).
  Auto-fix + one manual edit cleaned it up.
- Renderer build log shows the output path as `../../out/renderer/...`
  because Vite logs relative to `renderer.root` (`src/renderer`). The
  files actually land in `apps/desktop/out/renderer/` as intended — main
  process's `loadFile(join(__dirname, '../renderer/index.html'))` will
  resolve correctly.
- Did not run the dev app (`npm run -w @otelux/desktop dev`) — that
  launches a window and requires an interactive display. Build + bundled
  static output verify the same code paths short of an X session.

## Status

| # | Task | Status |
|---|---|---|
| 1 | Land docs reorg | ✅ |
| 2 | Retire C++ core | ✅ |
| 3 | Scaffold monorepo root | ✅ |
| 4 | Scaffold workspace packages | ✅ |
| 5 | Scaffold apps/desktop | ✅ |
| 6 | CI | ✅ |
| 7 | Rewrite README | ✅ |
| 8 | Verify (`npm install && build && test`) | ✅ |

Phase 0 exit criteria met. Ready for Milestone 1 work.
