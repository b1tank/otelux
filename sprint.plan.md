# Sprint Plan — Docs reorg + Metrics feature (Phase 3)

YOLO sprint. Atomic commit after each task. Source of truth for scope:
`docs/spec.md` §13 (Codex three-pillar ingest) and `docs/plan.md` Phase 3.

## Prioritized tasks

1. **Docs reorg** — move `proposal.md` → `docs/proposal.md`; merge the root
   `test.md` (accidentally created earlier) into the canonical
   `docs/test.md` and delete the root copy; teach `AGENTS.md` that
   plan/spec/proposal/test live under `docs/`; repoint the self-verify skill
   at `docs/test.md`.
2. **Docs ↔ code truth-up** — mark Logs (Phase 2) shipped in `docs/plan.md`;
   flip the "Metrics (coming soon)" framing as Metrics lands; keep
   `docs/test.md` Logs/Metrics sections matching the running app.
3. **Metrics backend (backend-first):**
   - `@otelux/types`: `Metric` (`Sum`/`Gauge`/`Histogram`), `NumberDataPoint`,
     `HistogramDataPoint`, `AggregationTemporality`.
   - `@otelux/protocol`: `ListMetricsQuery`/`ListMetricsResult`, `listMetrics`
     on `DataSource`, `ChangeEvent` += `metricsChanged`.
   - `@otelux/engine` + storage: `ingestMetrics`, `listMetrics`,
     `writeMetrics`, `metricsChanged` notify.
   - `@otelux/receiver`: `decodeExportMetricsServiceRequest`, `POST
     /v1/metrics`, exports; `fixtures/sample_codex_metrics.json` +
     `otlpMetrics.test.ts`.
4. **Adapter + desktop wiring** — `apps/desktop` `ipc.ts` /
   `ipcDataSource.ts` / `main` dispatch; `adapter-vscode`
   protocol/host/webview; subscribe filters include `metricsChanged`.
5. **Metrics UI** — `MetricsView` (meter→instrument tree, per-instrument
   chart with graph/table toggle, histogram view), dependency-free inline
   SVG charts (no CSP-hostile deps), Aspire `Metrics` page as reference.
   Enable the rail "Metrics" pillar + `activeView` + FilterBar; `MetricsView.test.tsx`.
6. **Verify** — `turbo run typecheck build test`; fix gaps.
7. **E2E** — drive a live `codex exec` turn with `[otel.metrics_exporter]`
   pointed at `:4319/v1/metrics`; assert `codex.api_request` /
   `codex.turn.e2e_duration_ms` land via `listMetrics` and render.
8. **Push.**

## Hiccups & Notes

_(appended as the sprint runs)_

## Status

- [ ] 1 Docs reorg
- [ ] 2 Docs truth-up
- [ ] 3 Metrics backend
- [ ] 4 Adapter + desktop wiring
- [ ] 5 Metrics UI
- [ ] 6 Build/verify
- [ ] 7 E2E with live codex
- [ ] 8 Push
