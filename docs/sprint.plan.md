# Sprint — Live telemetry performance and selection UX

## Goal

Keep the workbench responsive under continuous high-content OTLP traffic, make filtered trace results correct, prevent Pi telemetry from recursively capturing OTelux query output, and make live-list versus pinned-selection behavior explicit.

## Prioritized tasks

- [x] **P1 — Coalesce and scope live query invalidations.** Trace/log/metric queries now ignore unrelated signals and collapse any in-flight notification burst to one trailing refresh; pause/resume, unrelated-event, and burst behavior are covered.
- [ ] **P1 — Normalize trace-service filtering in durable storage.** Add a forward SQLite migration and indexed `trace_services` relation; apply service predicates before count, sort, limit, and offset; preserve memory/SQLite contract parity.
- [ ] **P1 — Break Pi OTel self-observation feedback loops.** Redact observability-tool results from captured messages/provider payloads by default while preserving spans, metrics, arguments, and an explicit override.
- [ ] **P2 — Clarify live list versus pinned trace selection.** Update the mockup and workbench to label the inspected trace as selected/pinned so new live arrivals do not look like a stale detail bug; retain keyboard and no-layout-shift invariants.
- [ ] **Verification and release hygiene.** Run edited-file formatting, scoped tests, full typecheck/build, live desktop smoke verification, update affected docs, and push each repository.

## Hiccups & Notes

- Deskpal app launch is unavailable in the current server because it was started without `--allow-exec`; use the project self-verification path if an existing OTelux window is available, otherwise record the blocker and rely on isolated/source test coverage plus a user-visible smoke after relaunch.
- The reported screenshot also contained an expected failed diagnostic tool span (`/proc/<pid>` disappeared); it was not an OTelux ingest failure.
