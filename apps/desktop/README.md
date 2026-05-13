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

## Package for Linux

```sh
npm run -w apps/desktop package
```

Produces an `.AppImage` and `.deb` under `apps/desktop/release/`.
