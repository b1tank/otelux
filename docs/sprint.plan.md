# Sprint — SQLite Query Budgets And Plan Gates

## Goal

Enforce the durable-store statement and index invariants that remain before Desktop daemon-client conversion.

## Tasks

- [x] Add opt-in SQLite statement execution observation for tests.
- [x] Enforce read and mutation statement budgets from `storage.md`.
- [x] Enforce representative indexed query plans without pretending substring search is indexed.
- [x] Reconcile storage, spec, plan, and test documentation with measured guarantees.
- [x] Run full build, package, performance, and regression qualification.

## Hiccups & Notes

- Statement counts measure executed prepared statements, not constructor-time preparation. Multi-statement `exec` calls are recorded separately so transaction boundaries remain visible.
- Query-plan assertions will target stable access invariants and required index names, not SQLite's incidental plan formatting or machine-dependent latency.
- The observer wraps native database/statement objects only when requested, records execution rather than preparation, and preserves native statement configuration methods such as bigint reads.
- Budget tests cover exact/cheap/cursor trace and log pages, selected details, metric metadata/history cursor pages, all three facet signals, fixed three-statement internal metric composition, and one transaction per ingest/clear mutation.
- File-backed `EXPLAIN QUERY PLAN` tests require trace source/service/time, log time/severity/trace/source, metric source, and selected point-history indexes. Log substring search explicitly remains a scan until the planned FTS5 contract lands.
- Canonical storage/spec/test material now distinguishes enforced count/index/payload invariants from machine-dependent latency targets; the forward plan no longer lists the delivered harness as pending.
- Full lint, 20-package typecheck/test task graphs, all 11 builds, unpacked Linux packaging, packaged runtime smoke, and the 10,000-trace/200,000-span performance smoke pass. The performance run held 24 mounted trace rows, 639 total list DOM nodes, 428 waterfall nodes, 16.8 ms p95/max frames, and 5.8 MB heap.
