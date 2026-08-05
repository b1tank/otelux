# Sprint — Bounded RPC List DTOs And Mutation Revisions

## Goal

Remove the remaining payload and stale-write blockers before Desktop daemon-client conversion.

## Tasks

- [x] Add lightweight log-list DTOs and selected log-detail RPC.
- [x] Split metric instrument metadata from bounded point-history RPC.
- [ ] Add method-specific response validation and direct/HTTP/IPC parity fixtures.
- [ ] Add settings revision/CAS conflicts over IPC and Runtime RPC.
- [ ] Run production-shaped payload, concurrency, build, package, and Deskpal gates.

## Hiccups & Notes

- Metric hardening uses event time with deterministic point-ID tie-breaking. Schema v5 adds `(instrument_id, time_unix_nano DESC, id DESC)`.
- Selected metric history is cursor-paged (120 default / 1,000 maximum); chart attributes use explicit bounded projection with per-point truncation metadata so accepted telemetry cannot silently inflate ordinary responses.
- Retention/clear races return `STALE_REFERENCE` and the UI offers a targeted instrument-list refresh.
- Service overview now consumes metadata summaries rather than the compound per-instrument point-tail query, removing the deterministic 501-instrument SQLite failure.
