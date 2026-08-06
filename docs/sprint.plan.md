# Sprint — SQLite Query Budgets And Plan Gates

## Goal

Enforce the durable-store statement and index invariants that remain before Desktop daemon-client conversion.

## Tasks

- [ ] Add opt-in SQLite statement execution observation for tests.
- [ ] Enforce read and mutation statement budgets from `storage.md`.
- [ ] Enforce representative indexed query plans without pretending substring search is indexed.
- [ ] Reconcile storage, spec, plan, and test documentation with measured guarantees.
- [ ] Run full build, package, performance, and regression qualification.

## Hiccups & Notes

- Statement counts measure executed prepared statements, not constructor-time preparation. Multi-statement `exec` calls are recorded separately so transaction boundaries remain visible.
- Query-plan assertions will target stable access invariants and required index names, not SQLite's incidental plan formatting or machine-dependent latency.
