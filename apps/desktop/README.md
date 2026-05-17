# @otelux/desktop

The OTelux desktop app. Electron shell hosting `@otelux/receiver` and
`@otelux/engine` in the main process, and `@otelux/ui` in the renderer.

## Develop

```sh
npm run -w apps/desktop dev
```

Opens an Electron window pointing at the Vite dev server with hot reload.

## Build

```sh
npm run -w apps/desktop build
```

Produces `out/main/*.js`, `out/preload/*.js`, and `out/renderer/*` ready to
be packaged.

## Run the locally built app

```sh
./otelux.sh                  # build + launch (daily driver)
./otelux.sh --no-build       # launch what's already in out/
./otelux.sh --port 4399      # override the OTLP port for this run
./otelux.sh --install-desktop # add a ~/.local entry so the app can be pinned
```

`otelux.sh` lives at the repo root. Unlike the VS Code launch.json
("OTelux: Main + Renderer"), it does **not** attach a debugger and uses a
dedicated user-data dir (`~/.config/otelux/local`) so settings persist
across runs and don't collide with the debug session.

## Package for Linux

```sh
npm run -w apps/desktop package
```

Produces an `.AppImage` and `.deb` under `apps/desktop/release/`.
