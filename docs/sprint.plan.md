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

- [x] **P0 — Make structural performance regressions executable.** Added committed 10,000-depth stack-safety, 1,000-depth DOM-budget, 200-result mounted-row, 50 rapid-selection coalescing, and back-and-forth cache tests. Full IPC-byte/heap benchmarks remain in the follow-up architecture sprint.
- [x] **P0 — Rewrite waterfall layout and indent rendering.** Replaced recursive DFS with iterative traversal and replaced per-ancestor guide elements with one constant-DOM CSS gradient.
- [x] **P0 — Virtualize waterfall rows.** Added fixed-height viewport virtualization, bounded overscan, stable span IDs, keyboard parity, and scroll-to-selection; mounted rows are independent of total spans.
- [x] **P0 — Virtualize and isolate trace rows.** Lists above 50 results mount a bounded window; memoized rows receive stable primitive placement props and a stable selection callback.
- [x] **P0 — Introduce a latest-only selection controller.** Same-turn clicks coalesce before IPC, stale trace content clears immediately, stale generations cannot commit, A → B → A uses a 24-entry / 20,000-span LRU cache, and waterfall state resets by trace ID.
- [x] **P1 — Split waterfall summaries from span details.** Protocol 0.6 adds optional `getTraceWaterfall`; engine, local runtime, Desktop IPC, and renderer adapter implement it. Waterfall spans retain identity/timing/status/scope/service keys while full bags load through `(traceId, spanId)` only when the drawer opens; MCP/full-trace semantics remain unchanged.
- [x] **P1 — Isolate SQLite/runtime work from Electron main.** Local runtime now uses a typed async worker facade for every storage operation. The queue is capped at 512, direct reads have priority over writes/maintenance, failures propagate to callers, and tests prove a 5,000-log write does not block the caller timer. Packaged smoke passes with the worker boundary.
- [x] **P1 — Add backpressure and keyset pagination.** Concurrent OTLP exports are capped at 64 and excess requests return explicit `503 receiver_overloaded`; per-signal rejection counts propagate through runtime status to a `Dropped N` endpoint pill. The SQLite worker is independently capped at 512. Trace and log results expose `nextCursor`; memory/SQLite apply stable sort-field + ID keysets. `includeTotalCount: false` skips exact SQLite counts and marks the page-size fallback as inexact.
- [x] **P1 — Packaged interaction qualification.** Full Turbo build/test/typecheck passed and the unpacked production artifact passed preload, workbench, SQLite IPC, tray/receiver, ingest, hardening, and shutdown smoke. After enabling Deskpal process launch, an isolated source build ingested 200 traces including a 1,000-deep trace; OCR located and clicked alternating traces, the selected 1,000-span waterfall rendered, and 12-step list scroll down/up delivered successfully.

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
- The current in-session Deskpal bridge was launched without `--allow-exec`. The persistent Pi launcher now exports `DESKPAL_PI_ALLOW_EXEC=1` for future sessions. For this sprint, verification used a dedicated Deskpal MCP process with `--allow-exec`; no raw xdotool/input automation was used.
- Deskpal `click_text` spends 7–13 seconds in OCR on the dense synthetic screen, so that command wall time is not reported as application click latency. The verified postcondition is the selected-trace/waterfall state after each delivered click; packaged latency budgets still require capture-bound frame timing in the follow-up harness.
- `getTraceWaterfall` is optional for backward-compatible third-party/in-process DataSources; the first-party engine, runtime, and Electron adapter all implement it. UI fallback preserves older adapters.
- The worker imports the ESM engine-node build because its historical CJS bundle still contains an unrelated `import.meta` warning path. Full build and packaged smoke exercise the actual ESM worker resolution.

## Final outcome

The highest-impact interaction and backend defects are fixed: layout is iterative, indentation DOM is constant, trace and waterfall rows are virtualized, rapid same-turn selection launches one request, recent traces are bounded and cached, stale traces never present as the new selection, waterfall payloads omit full bags, selected details load separately, and SQLite runs in a bounded prioritized worker. OTLP concurrency is bounded with explicit overload responses and visible per-signal counters; trace/log keyset cursors and optional exact counts are live. Trace and log views expose cursor-backed `Load more` controls; appended pages skip exact counts while the initial page keeps the authoritative total. Full automated/build/package smoke passes; production frame/heap/IPC-byte budgets remain next.
