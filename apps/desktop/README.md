# @otelux/desktop

The OTelux desktop app. Its Electron main process embeds `@otelux/local-runtime`, while the renderer hosts `@otelux/ui`. Desktop owns only Electron IPC, windows, and native shell integration; backend composition lives in the runtime package.

## Develop

```sh
npm run -w apps/desktop dev
```

Opens an Electron window pointing at the Vite dev server with hot reload.

## Build

```sh
npm run -w apps/desktop build
```

Produces `out/main/*.js`, `out/preload/*.js`, and `out/renderer/*` ready to be packaged.

## Run the locally built app

```sh
./otelux.sh                  # build + launch (daily driver)
./otelux.sh --no-build       # launch what's already in out/
./otelux.sh --port 4399      # override the OTLP port for this run
./otelux.sh --install-desktop # add a ~/.local entry so the app can be pinned
./otelux.sh --install-desktop-only # install the entry without launching
```

`otelux.sh` lives at the repo root. Unlike the VS Code launch.json ("OTelux: Main + Renderer"), it does **not** attach a debugger and uses a dedicated user-data dir (`~/.config/otelux/local`) so settings persist across runs and don't collide with the debug session.

## Package for Linux

Linux packaging is under release hardening and is not an official installation path yet. The command currently exercises the `.deb` target. AppImage is disabled until its launcher can preserve Chromium's sandbox or fail closed. Generated files under `release/` are unsupported until the [release sprint](../../docs/release-sprint.md#milestone-3---official-linux-beta) passes.

```sh
npm run -w apps/desktop package
```
