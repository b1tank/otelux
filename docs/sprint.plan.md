# Sprint — Trace interaction performance rewrite

## Goal

Make scrolling and rapid trace switching feel immediate under realistic and adversarial telemetry. Preserve React and Electron, but replace the waterfall rendering model, root-coupled selection state, uncancellable detail fetching, and main-thread storage execution that currently make common interactions slow.

## Audit baseline

Synthetic storage fixture: 10,000 traces / 200,000 spans / ~100 MB SQLite.

| Probe | Result |
|---|---:|
| List 200 traces p50 / p95 | 1.34 / 2.78 ms |
| Search list p50 / p95 | 9.17 / 10.45 ms |
| Fetch one 20-span trace p50 / p95 | 0.30 / 0.63 ms |
| Source facets p50 / p95 | 1.13 / 1.25 ms |
| Mount 200 trace rows | 568 ms in jsdom |
| Dispatch 50 rapid selections | 2,357 ms |
| Detail requests from 50 selections | 50 |
| React commits / render time | 108 / 2,965 ms |
| 100-deep waterfall | 5,879 DOM nodes / 482 ms |
| 500-deep waterfall | 129,279 DOM nodes / 6,156 ms |
| 1,000-deep waterfall | renderer test exhausted 4 GB heap |
| 5,000-deep layout | recursive traversal stack overflow |

SQLite query latency is not the primary trace-click bottleneck. The dominant defects are O(depth²) indent-guide DOM, unvirtualized lists, root-level selection state, one uncancellable detail query per click, stale waterfall retention during loading, and full trace payloads crossing IPC. Synchronous SQLite in Electron main remains a separate responsiveness and reliability risk under concurrent ingest/pruning.

## Prioritized tasks

- [ ] **P0 — Make performance regressions executable.** Add committed synthetic fixtures and benchmark/integration tests for 10k trace lists, 10k-wide and 5k-deep traces, 50 rapid selections, React commit/row counts, IPC payload bytes, and renderer heap.
- [ ] **P0 — Rewrite waterfall layout and indent rendering.** Replace recursive DFS with an iterative traversal and replace per-ancestor guide elements with constant-DOM CSS/pseudo-element rendering.
- [ ] **P0 — Virtualize waterfall rows.** Use `@tanstack/react-virtual`, fixed row geometry, bounded overscan, stable span-id keys, keyboard parity, and scroll-to-selection. Mount fewer than 100 rows regardless of trace size.
- [ ] **P0 — Virtualize and isolate trace rows.** Virtualize above roughly 50 rows, memoize row boundaries, stabilize callbacks, and ensure selection rerenders only the previous/new selected rows.
- [ ] **P0 — Introduce a latest-only selection controller.** Highlight selection synchronously, clear stale waterfall content, coalesce same-frame clicks, use explicit request IDs/cancellation, and keep a byte/entry-bounded recent-trace LRU cache.
- [ ] **P1 — Split waterfall summaries from span details.** Send only fields required to render the waterfall; fetch full attributes/events/links through `(traceId, spanId)` when the detail drawer opens.
- [ ] **P1 — Isolate SQLite/runtime work from Electron main.** Move storage, ingest, retention, and queries to a worker/utility process with typed async RPC, bounded queues, shutdown/crash handling, and priority for direct user queries.
- [ ] **P1 — Add keyset pagination and backpressure.** Replace offset pagination for live trace/log lists, make exact counts optional, and expose overload/dropped-record counters.
- [ ] **P1 — Packaged interaction qualification.** Drive the production build against a synthetic large database and enforce frame, request-count, DOM, heap, and stale-selection budgets.

## React implementation guardrails

- Effects synchronize external systems only; no prop-to-state copies, derived-row effects, or state-update chains.
- Localize state by surface. Trace selection, list data, waterfall data, and drawer state must not share one root rerender boundary.
- Use `useSyncExternalStore` or a small selector-based store for focused subscriptions; components subscribe only to fields they render.
- Selection styling and keyboard focus are urgent. Fetching, live-tail refresh, facets, and exact counts are non-urgent and may use transitions.
- Never retain the previous trace as if it were the newly selected trace. Show a reserved-height skeleton until the selected trace resolves.
- One latest-only controller owns desired ID, active request ID, cache, and queue. `AbortSignal` is represented across Electron IPC by explicit request IDs/cancel messages.
- Use `useCallback` only when identity affects a memoized child/subscription; use `memo` at row/ruler boundaries; avoid blanket `useMemo`.
- Pass stable primitive row props rather than newly allocated wrapper objects. Use trace/span IDs as keys, never array indexes.
- Key trace-specific waterfall state by `traceId`; preserve scroll only through an explicit bounded cache.
- Mounted DOM is proportional to viewport, never dataset size. Hidden rows are not rendered.
- Avoid render → measure every row → set state loops. Prefer fixed row heights and virtualizer-managed observers.
- Live invalidations update their query cache and must not rerender the selected waterfall unless that selected trace changed.
- Every cache has explicit entry and byte caps with LRU eviction.
- Profile production builds; jsdom/dev timings diagnose structure but are not release latency claims.

## Exit budgets

- 10,000-span waterfall: no stack overflow/OOM; fewer than 100 mounted rows and 2,000 DOM nodes; first viewport under 100 ms on reference hardware.
- 200-row result: fewer than 50 mounted trace rows; selected-row feedback under 16 ms p95.
- 50 rapid selections: at most two detail requests; no stale waterfall shown as current; bounded heap and cache.
- A selection change rerenders at most the previous/new trace rows plus the selected-trace surface, not every row or app chrome.
- No synchronous SQLite operation runs on Electron main; ingest and retention cannot block window input.
- Packaged app remains responsive while continuous OTLP ingest runs at the benchmark rate.

## Hiccups & Notes

- The production database was intentionally cleared before this audit, so the measurements use deterministic synthetic fixtures rather than historical user data.
- Deskpal app launch remains unavailable because the current server lacks `--allow-exec`; packaged pointer/scroll qualification must run after that backend restarts. Structural React, DOM, storage, and stack-depth probes ran locally.

## Final outcome

Sprint in progress.
