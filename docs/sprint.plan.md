# Sprint — SQLite Query Budgets And Plan Gates

## Goal

Enforce the durable-store statement and index invariants that remain before Desktop daemon-client conversion.

## Tasks

- [x] Add opt-in SQLite statement execution observation for tests.
- [x] Enforce read and mutation statement budgets from `storage.md`.
- [x] Enforce representative indexed query plans without pretending substring search is indexed.
- [ ] Reconcile storage, spec, plan, and test documentation with measured guarantees.
- [ ] Run full build, package, performance, and regression qualification.

## Hiccups & Notes

- Statement counts measure executed prepared statements, not constructor-time preparation. Multi-statement `exec` calls are recorded separately so transaction boundaries remain visible.
- Query-plan assertions will target stable access invariants and required index names, not SQLite's incidental plan formatting or machine-dependent latency.
- The observer wraps native database/statement objects only when requested, records execution rather than preparation, and preserves native statement configuration methods such as bigint reads.
- Budget tests cover exact/cheap/cursor trace and log pages, selected details, metric metadata/history cursor pages, all three facet signals, fixed three-statement internal metric composition, and one transaction per ingest/clear mutation.
- File-backed `EXPLAIN QUERY PLAN` tests require trace source/service/time, log time/severity/trace/source, metric source, and selected point-history indexes. Log substring search explicitly remains a scan until the planned FTS5 contract lands.
