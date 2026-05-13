# @otelux/engine

Pure-TypeScript engine: ingest, query, layout, live subscription. Knows
nothing about React or DOM; runs in browser, Node, and Web Workers. Storage
is pluggable so the same engine drives both `@otelux/engine-node`
(`node:sqlite`) and `@otelux/engine-wasm` (SQLite-WASM + OPFS).

Phase 0 ships only the factory and Storage interface. Real ingest, queries,
and the waterfall layout (ported from the retired C++ core) land in Phase 1.
