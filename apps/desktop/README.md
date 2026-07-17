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

`otelux.sh` lives at the repo root. It keeps Electron profile data under `~/.config/otelux/local`, while OTelux settings, token, runtime state, and default database use the canonical platform data home (`${XDG_DATA_HOME:-$HOME/.local/share}/otelux` on Linux). Set `OTELUX_DATA_DIR` to isolate the runtime store for testing.

## Package for Linux

Linux packaging is under release hardening and is not an official installation path yet. The command currently exercises the `.deb` target. AppImage is disabled until its launcher can preserve Chromium's sandbox or fail closed. Generated files under `release/` are unsupported until the [release sprint](../../docs/release-sprint.md#milestone-3---official-linux-beta) passes.

```sh
npm run -w apps/desktop package
```
