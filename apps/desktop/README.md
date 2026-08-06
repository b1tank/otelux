# @otelux/desktop

The OTelux desktop app. Its Electron main process discovers or starts the packaged on-demand `@otelux/local-runtime` daemon and proxies the renderer's validated IPC over Runtime HTTP/SSE; the renderer hosts `@otelux/ui`. Desktop owns Electron IPC, windows, and native shell integration, while the daemon owns backend composition and SQLite.

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

Linux `.deb` and rootless AppImage packaging is live for x64/arm64 prereleases. The latest published release is `v0.1.11`; `main` contains an unpublished `0.1.12` candidate. Local package, install, daemon, CLI, and artifact smokes are release evidence only for the exact artifact tested; generated files under `release/` are not official downloads.

```sh
npm run -w apps/desktop package
```
