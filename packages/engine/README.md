# @otelux/engine

Pure-TypeScript engine: ingest, query, layout, live subscription. Knows
nothing about React or DOM; runs in browser, Node, and Web Workers.
Storage is pluggable so the same engine drives both `@otelux/engine-node`
(`node:sqlite` — Milestone 2) and a future `@otelux/engine-wasm`
(SQLite-WASM + OPFS).

Milestone 1 ships:

- `createEngine({ storage })` — ingest + query + subscribe over the
  `DataSource` contract from `@otelux/protocol`.
- `createMemoryStorage()` — the default in-memory `Storage` backend used
  while the persistent SQLite store is being built out.
- `computeWaterfallLayout()` — the waterfall layout algorithm ported
  from the retired C++ core, with row depth, time ruler bounds, and
  per-service colors.
- `traceFromSpans()` — assembles a `Trace` view (root, services, totals)
  from a flat span list.
