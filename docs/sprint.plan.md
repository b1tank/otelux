# Sprint — Query budgets and service intelligence

## Goal

Build on the verified 0.1.9 interaction rewrite by preventing SQL regressions and making OTelux answer richer service-health questions across traces, logs, and metrics.

## Prioritized tasks

- [ ] **P1 — SQL statement and plan budgets.** Add a testable query-observer seam around durable storage; enforce statement counts and required indexes for common trace, log, metric, facet, waterfall, and detail query shapes.
- [ ] **P1 — Production-shaped query fixture.** Generate deterministic mixed-source/service telemetry large enough to catch accidental scans and N+1 behavior without making routine CI slow.
- [x] **P1 — Cross-signal service rollups.** Engine now reports span/trace/error counts, error rate, p50/p95 duration, log severity bands, and metric instrument availability through bounded cursor/list queries.
- [x] **P1 — Upgrade `otel_get_service_overview`.** MCP now returns richer cross-signal rollups while preserving the original name/traces/errorTraces/spans fields.
- [x] **P2 — Agent-run correlation foundation.** `otel_correlate_agent_run` is functional: exact searchable conversation/session IDs find matching logs and propagated trace IDs without service-name inference. Bounded time-window fallback remains future work for uncorrelated telemetry.
- [ ] **Verification and docs.** Run focused and full Turbo checks, package smoke/performance smoke, update protocol/spec/storage/test/plan docs, and publish atomic commits.

## Hiccups & Notes

- The completed trace-interaction sprint is preserved in git history and release `v0.1.9`; this file now tracks only forward work.

## Final outcome

Service overview and agent-run correlation are functional and vendor-neutral. SQL statement/plan instrumentation and dedicated aggregate SQL remain the next hardening layer; the current implementation uses bounded cursor pages and the existing indexed storage contracts.
