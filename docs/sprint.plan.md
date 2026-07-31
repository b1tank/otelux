# Sprint — Live telemetry performance and selection UX

## Goal

Keep the workbench responsive under continuous high-content OTLP traffic, make filtered trace results correct, prevent Pi telemetry from recursively capturing OTelux query output, and make live-list versus pinned-selection behavior explicit.

## Prioritized tasks

- [x] **P1 — Coalesce and scope live query invalidations.** Trace/log/metric queries now ignore unrelated signals and collapse any in-flight notification burst to one trailing refresh; pause/resume, unrelated-event, and burst behavior are covered.
- [x] **P1 — Normalize trace-service filtering in durable storage.** Schema v3 migrates and transactionally maintains indexed `trace_services`; count and page queries share the pre-pagination predicate, with adversarial memory/SQLite contract coverage.
- [x] **P1 — Break Pi OTel self-observation feedback loops.** `pi-otel` now recursively redacts OTelux/`otel_*` results from messages, provider payloads, tool spans, and agent summaries by default while preserving metadata/arguments; an explicit env override restores content.
- [x] **P2 — Clarify live list versus pinned trace selection.** The mockup and workbench waterfall show a fixed-size **Selected trace** badge explaining that live arrivals update the list without stealing focus; selection and keyboard contracts remain unchanged.
- [ ] **Verification and release hygiene.** Run edited-file formatting, scoped tests, full typecheck/build, live desktop smoke verification, update affected docs, and push each repository.

## Hiccups & Notes

- Deskpal app launch is unavailable in the current server because it was started without `--allow-exec`; both visible and isolated launch attempts failed closed. Verification therefore uses source tests/build plus a user-visible smoke after the installed app is relaunched.
- The reported screenshot also contained an expected failed diagnostic tool span (`/proc/<pid>` disappeared); it was not an OTelux ingest failure.
