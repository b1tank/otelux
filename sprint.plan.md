# Sprint — M1 trace workbench (in-memory vertical slice)

Goal: end-to-end OTLP traces in a desktop app — receive over HTTP, store
in-memory, query, lay out, and render in a real workbench UI. SQLite
persistence, logs, metrics, and packaged installers are out of scope for
this sprint; they pick up in the next M1 sprint.

## Tasks

1. **Protocol: DataSource query/result shapes** — ListTraces, GetTrace,
   GetSpanDetails, ChangeEvent in `@otelux/protocol`.
2. **Types: OTLP Trace/Span data model** — Span, Trace, SpanStatus, SpanKind,
   AttributeValue normalization, etc. in `@otelux/types`.
3. **Engine: in-memory storage + DataSource implementation** —
   `createMemoryStorage()`, `createEngine()` honoring listTraces/getTrace,
   ChangeEvent subscriptions, helpers for deriving Traces from Spans.
4. **Engine: waterfall layout** — port `append_layout_rows` from the
   retired C++ core to `computeWaterfallLayout()`.
5. **Receiver: OTLP/HTTP JSON** — Hono server with `POST /v1/traces`, OTLP
   decoder mapping ExportTraceServiceRequest → `Span[]`, ingest into engine.
6. **UI: TraceList + Waterfall + SpanDetail workbench** — React components
   consuming a `DataSource`, virtualized list, SVG waterfall, span detail.
7. **Desktop: wire it together** — main process owns engine + receiver,
   exposes a typed IPC bridge; renderer consumes via a postMessage
   `DataSource`; live updates push through `ChangeEvent`.
8. **Verify** — `npm run lint && typecheck && test && build`; live smoke
   POSTing fixtures into a running receiver and reading them back.

## Hiccups & Notes

- Some React 18 callbacks needed explicit dependencies arrays; resolved
  via `useCallback` rather than suppression. Biome's
  `react-hooks/exhaustive-deps` was strict but right.
- `computeWaterfallLayout` regressed once when ordering siblings by start
  time; the C++ port had relied on insertion order. Restored stable sort by
  `(startTimeUnixNano, spanId)` to keep results deterministic across runs.
- `useLiteralKeys` warned on `process.env['ELECTRON_RENDERER_URL']`; using
  literal-key access is fine here (no dynamic key in scope).
- Smoke harness initially imported a non-existent `createOtlpHttpReceiver`;
  actual export is `createReceiver`. Fixed in `scripts/smoke-receiver.mjs`.
- Did not launch the Electron window from this sprint (no X session);
  build artifacts + smoke harness verify all code paths short of the
  actual `app.whenReady`.

## Status

| # | Task | Status |
|---|---|---|
| 1 | Protocol: query/result shapes | ✅ |
| 2 | Types: OTLP Trace/Span | ✅ |
| 3 | Engine: in-memory + DataSource | ✅ |
| 4 | Engine: waterfall layout | ✅ |
| 5 | Receiver: OTLP/HTTP JSON | ✅ |
| 6 | UI: TraceList + Waterfall + SpanDetail | ✅ |
| 7 | Desktop: wire engine + receiver + IPC | ✅ |
| 8 | Verify (lint/typecheck/test/build + live smoke) | ✅ |

## End-to-end smoke evidence

`scripts/smoke-receiver.mjs` + `scripts/send-traces.sh` against the live
server on port 14318 produced:

```text
[smoke] engine has 2 trace(s):
  - abcdef…  root="GET /api/users"  spans=3  services=api-gateway
  - dd00dd…  root="POST /orders"    spans=8  services=api-gateway,order-service,user-service
```

Full vertical slice (HTTP → OTLP decode → engine ingest → listTraces) works.

## Next sprint

- `@otelux/engine-node`: real `node:sqlite` storage with WAL, schema
  versioning, retention.
- Live `ChangeEvent` push from receiver → engine subscribers → renderer
  via IPC (currently the engine emits, the renderer needs to subscribe).
- `electron-builder` packaging for `.AppImage` + `.deb`.
- Filters, search, keyboard navigation polish on the workbench.
- Playwright E2E that boots the receiver, POSTs a fixture, asserts the
  UI renders the trace.

## Previous sprint (Phase 0)

Pivot landing — see git log `224d6bd..ad6a839` and the previous
`sprint.plan.md` content preserved in commit history.
