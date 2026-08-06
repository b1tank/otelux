# Sprint — Bounded RPC List DTOs And Mutation Revisions

## Goal

Remove the remaining payload and stale-write blockers before Desktop daemon-client conversion.

## Tasks

- [x] Add lightweight log-list DTOs and selected log-detail RPC.
- [x] Split metric instrument metadata from bounded point-history RPC.
- [x] Add method-specific response validation and direct/HTTP/IPC parity fixtures.
- [x] Add settings revision/CAS conflicts over IPC and Runtime RPC.
- [x] Run production-shaped payload, concurrency, build, package, and Deskpal gates.

## Hiccups & Notes

- Metric hardening uses event time with deterministic point-ID tie-breaking. Schema v5 adds `(instrument_id, time_unix_nano DESC, id DESC)`.
- Selected metric history is cursor-paged (120 default / 1,000 maximum); chart attributes use explicit bounded projection with per-point truncation metadata so accepted telemetry cannot silently inflate ordinary responses.
- Retention/clear races return `STALE_REFERENCE` and the UI offers a targeted instrument-list refresh.
- Service overview now consumes metadata summaries rather than the compound per-instrument point-tail query, removing the deterministic 501-instrument SQLite failure.
- One exhaustive result registry now covers every advertised Runtime RPC and Electron invoke method. HTTP and IPC decode and sanitize responses at runtime; a shared tagged-bigint fixture proves direct/HTTP/IPC shape parity, and checked method-result schemas record the wire contract.
- Settings snapshots carry a monotonic revision. Updates require the revision observed when editing began, commit revision + 1 atomically, reject stale IPC writes without rebinding listeners, and map stale Runtime RPC writes to `-32004` with current revision/settings data.
- Full lint/typecheck/test/build, unpacked Linux packaging, packaged runtime smoke, and the 10,000-trace/200,000-span production-shaped performance smoke pass. Deskpal reproduced a competing settings edit and confirmed the stale form stays open with a visible revision conflict while the newer persisted value remains intact.
