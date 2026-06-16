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

- Docs reorg: `docs/` already held the canonical plan/spec/test; the root
  `test.md` was a stale duplicate (§13 Logs) — merged into `docs/test.md`
  (added §14 Logs ingest, §15 Metrics ingest) and `git rm`'d. `docs/test.md`
  was de-staled (Logs no longer "coming soon").
- Backend landed first and green on the first run: receiver 26 tests, engine
  6 tests. `metricIdentity` keys on `service\0scope.name\0name\0type`, so
  repeated delta exports of the same instrument merge + tail to
  `MAX_POINTS_PER_INSTRUMENT`.
- Adding `listMetrics` to `DataSource` fanned out to every consumer:
  `ipcDataSource`, `main` dispatch, `shared/ipc`, `adapter-vscode`
  (protocol/host/webview), plus the test fakes in adapter-vscode,
  `LogsView.test`, and `TraceList.test`. `adapter-direct` + `engine-node`
  needed no change (pass-through).
- Charts are dependency-free inline SVG (line chart for Sum/Gauge, bucket
  bars for Histogram) — no charting lib, consistent with the
  no-CSP-hostile-deps rule. Per-card Graph/Table toggle.
- E2E: live `codex exec` turn emitted real metrics → `/v1/metrics` (200);
  MetricsView rendered 31 `codex` instruments (counters as line charts,
  `*_ms` as histogram bars, DELTA badges, units). Verified via deskpal.
- **Gap found + fixed during E2E:** two `codex.api_request` Counter cards
  looked identical because they came from different services (`codex` vs
  `codex_exec`). Added an emitting-service label (colored dot + name) to each
  instrument card to disambiguate. Confirmed live.
- **Known deskpal gap:** the small Graph/Table toggle buttons are below
  OCR-click reliability (documented small-target gap); toggle behavior is
  covered by `MetricsView.test.tsx` instead.
- **Follow-up (not in this sprint):** the MCP server (`:4320`) exposes only
  logs/traces tools — no metrics query tool yet. Worth an `otel_list_metrics`
  tool later for agent-side assertions.

## Status

- [x] 1 Docs reorg
- [x] 2 Docs truth-up
- [x] 3 Metrics backend
- [x] 4 Adapter + desktop wiring
- [x] 5 Metrics UI
- [x] 6 Build/verify
- [x] 7 E2E with live codex
- [x] 8 Push
