# Sprint — Live telemetry performance and selection UX

## Goal

Keep the workbench responsive under continuous high-content OTLP traffic, make filtered trace results correct, prevent Pi telemetry from recursively capturing OTelux query output, and make live-list versus pinned-selection behavior explicit.

## Prioritized tasks

- [x] **P1 — Coalesce and scope live query invalidations.** Trace/log/metric queries now ignore unrelated signals and collapse any in-flight notification burst to one trailing refresh; pause/resume, unrelated-event, and burst behavior are covered.
- [x] **P1 — Normalize trace-service filtering in durable storage.** Schema v3 migrates and transactionally maintains indexed `trace_services`; count and page queries share the pre-pagination predicate, with adversarial memory/SQLite contract coverage.
- [x] **P1 — Break Pi OTel self-observation feedback loops.** `pi-otel` now recursively redacts OTelux/`otel_*` results from messages, provider payloads, tool spans, and agent summaries by default while preserving metadata/arguments; an explicit env override restores content.
- [x] **P2 — Clarify live list versus pinned trace selection.** The mockup and workbench waterfall show a fixed-size **Selected trace** badge explaining that live arrivals update the list without stealing focus; selection and keyboard contracts remain unchanged.
- [x] **Verification and release hygiene.** Edited files were formatted; UI, engine-node, and `pi-otel` suites passed; full Turbo test/typecheck/build completed 30/30 tasks; the source desktop opened the production database, migrated it to schema v3, served OTLP/MCP, and returned the reported trace through MCP. Deskpal visual automation remained blocked as noted below.

## Hiccups & Notes

- Deskpal app launch is unavailable in the current server because it was started without `--allow-exec`; both visible and isolated launch attempts failed closed. Verification therefore uses source tests/build plus a user-visible smoke after the installed app is relaunched.
- The reported screenshot also contained an expected failed diagnostic tool span (`/proc/<pid>` disappeared); it was not an OTelux ingest failure.
- Production-data smoke: schema `user_version=3`, 354 normalized trace/service memberships, seven `pi` traces returned by the indexed service predicate, and `EXPLAIN QUERY PLAN` uses `idx_trace_services_service`.
- Full build result: 30/30 Turbo tasks successful. `pi-otel`: 3 files / 6 tests passed and the feedback-loop fix was pushed as `5ea1bda`.

## Final outcome

All sprint tasks are complete. OTelux now bounds live-query concurrency, scopes invalidations by signal, returns correct filtered counts/pages through schema v3, and visibly distinguishes a pinned inspected trace from the live list. Pi telemetry no longer recursively embeds OTelux query results by default.
