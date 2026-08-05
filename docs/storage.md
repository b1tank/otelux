# OTelux Storage And Query Design

Updated: 2026-07-31

OTelux uses SQLite as a local telemetry engine, not as a JSON file cabinet. The schema and query API are designed together so every supported UI or agent workflow has a bounded, indexed path with a known SQL statement budget.

## Invariants

1. The local runtime is the only writer and the only process that opens the active database.
2. Storage identity follows OpenTelemetry identity rules. A span is identified by `(trace_id, span_id)`, never `span_id` alone.
3. Filters are applied before count and pagination. `totalCount` describes the same predicate as `rows`.
4. List queries return summaries, not full detail graphs or metric histories.
5. Detail queries batch related records. No per-row SQL query is allowed in a list or waterfall loop.
6. Every result is bounded by row count, time window, or both.
7. Schema migrations are forward-only, transactional where SQLite permits, and covered by old-database fixtures. A failed upgrade leaves the legacy database at its canonical path for retry; it is not treated as corruption.
8. Query plans and statement counts are tested, not inferred from code review alone.

## Current Strengths

- WAL plus `synchronous=NORMAL` lets ingest and query proceed concurrently; periodic retention checkpoints and truncates WAL before and after pruning so physical sidecar growth remains bounded under sustained ingest.
- Spans, logs, metric instruments, and points are normalized enough for indexed access.
- Resources and instrumentation scopes are interned rather than repeated per record.
- A materialized `traces` table makes the trace list independent of raw-span aggregation.
- Full trace detail uses one indexed `spans WHERE trace_id = ?` query.
- Logs use indexed time, severity, trace, and ingest fields and a denormalized `search_text` column.
- Ingest batches use transactions and prepared statements.
- Age/size retention and per-instrument point caps bound growth.
- Memory and SQLite implementations share a behavioral contract suite.

## Audit Findings

| Severity | Finding | Impact | Required correction |
|---|---|---|---|
| Resolved P0 | Schema v1 used global `span_id` identity across storage and detail contracts, although OTLP span IDs are unique only within a trace. | SQLite could overwrite another trace's span and return stale rollups/details. | Fixed: schema v2 uses `PRIMARY KEY(trace_id, span_id)`, migrates v1 transactionally, repairs surviving rollups, preserves v1 for retry if migration fails, and all detail APIs require both IDs. |
| Resolved P1 | Trace service filtering occurred after SQL `LIMIT/OFFSET`; the count query omitted the service filter. | Short/empty pages and incorrect totals. | Fixed: schema v3 normalizes `trace_services(trace_id, service_name)`, migrates existing service JSON, updates membership transactionally with trace rollups, and applies one service-indexed membership subquery to count and page queries. |
| Resolved P1 | `listMetrics` selected points once per returned instrument. | $N+2$ SQL statements and multi-second responses. | Fixed: internal bounded composition uses one compound indexed tail statement; the transport/workbench list now returns metadata plus scalar latest-value summaries without point/resource/scope bags, and one selected opaque instrument ID loads a separately bounded history (120 by default, 2,000 maximum). |
| Resolved P1 | Metric list results could carry up to 10,000 points per instrument. | An 81.5 MB IPC payload retained hundreds of MB in the renderer. | Fixed: transport lists carry no point/resource/scope bags, only bounded latest-value summaries and counts; `getMetricPoints` pages one selected event-time-ordered series (120 default / 1,000 maximum) and explicitly reports chart-attribute truncation. Internal MCP/service composition no longer loads histories for service availability. |
| Resolved P2 | UI discovered service facets by fetching 500 traces, 500 logs, and 500 full metric instruments. | Redundant startup queries and payloads in hidden views. | Fixed in protocol 0.4 and generalized in 0.5: `listResourceFacets` executes grouped source/service SQL; inactive views do not fetch or subscribe. |
| P2 | Durable SQLite queries and structured-clone serialization still execute through Electron's main process. | A future accidentally unbounded query can stall ingest and renderer IPC together. | Keep every current query bounded and budget-tested; move storage/query execution behind the planned local runtime daemon/worker boundary before adding heavier analysis queries. |
| P2 | Offset pagination is used while new telemetry arrives. | Duplicate or skipped rows between pages. | Use opaque keyset cursors with stable ID tie-breakers. |
| P2 | Trace rollup is fully recomputed from all spans after every affected write. | Repeated $O(n)$ work for large traces arriving in many batches. | Keep correctness first; measure and introduce bounded dirty-trace coalescing or incremental aggregates only if budgets fail. |
| P2 | `search_text LIKE '%term%'` cannot use a normal B-tree index. | Full log scan for substring search. | Add FTS5 with explicit tokenizer/versioning, retaining deterministic fallback semantics. |
| P3 | Dynamic count/page SQL is prepared for every list call. | Avoidable parse/prepare overhead. | Cache statements by finite query shape after higher-impact fixes. |

The two highest-severity correctness findings were reproduced directly during the audit:

```json
{"traceList":[{"id":"bbbb...","count":1},{"id":"aaaa...","count":1}],"traceASpans":0,"traceBSpans":1}
{"totalCount":2,"rowCount":0,"names":[]}
```

The first result captured the now-fixed schema v1 behavior after two traces were written with the same `span_id`; trace A kept a stale rollup after its row was replaced by trace B. The second captured the now-fixed pre-v3 service-filter bug where `services=["beta"]`, `limit=1` returned an empty page when a newer alpha trace occupied the SQL page.

## Schema Direction

### Trace identity and services

```sql
CREATE TABLE spans (
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  -- remaining span fields
  PRIMARY KEY (trace_id, span_id)
);
CREATE INDEX idx_spans_trace_start
  ON spans(trace_id, start_unix_nano, span_id);
CREATE INDEX idx_spans_trace_parent
  ON spans(trace_id, parent_span_id);

CREATE TABLE trace_services (
  trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  PRIMARY KEY (trace_id, service_name)
);
CREATE INDEX idx_trace_services_service_trace
  ON trace_services(service_name, trace_id);
```

The materialized `traces` row remains the list source. `services` remains as display JSON, while filtering uses the schema-v3 `trace_services` relation. Facets should reuse that normalized relation when grouped facet queries land.

### Logs

Keep promoted columns for time, severity, service, scope, trace, and span correlation. Add composite indexes matching real queries:

```sql
CREATE INDEX idx_logs_trace_time
  ON logs(trace_id, time_unix_nano DESC, id DESC);
CREATE INDEX idx_logs_service_time
  ON logs(service_name, time_unix_nano DESC, id DESC);
CREATE INDEX idx_logs_severity_time
  ON logs(severity_number DESC, time_unix_nano DESC, id DESC);
```

FTS5 should index body, event name, severity text, and flattened attribute keys/values. The tokenizer and escaping semantics are part of the query contract and need parity tests against the memory backend.

### Metrics

`metric_instruments` remains one row per identity. Schema v5 adds the event-time point index required by latest summaries and selected-history paging. Add materialized latest-point summary columns only when they are proven useful for list rendering. Point history stays in `metric_points` with an index matching selected-instrument windows:

```sql
CREATE INDEX idx_points_instrument_time
  ON metric_points(instrument_id, time_unix_nano DESC, id DESC);
```

Do not join all point rows into an instrument list page. Fetch one selected instrument's points or fetch a bounded set for explicitly requested instrument IDs in one SQL statement.

## Query Contracts And Statement Budgets

| Operation | SQL statement budget | Notes |
|---|---:|---|
| List traces | <=2 | Exact count only when requested, plus one summary page query. No span join. |
| Get trace detail | 1, or 2 with logs | One span query; optional bounded correlated-log query. Build parent/children maps once in $O(n)$. |
| Get span detail | 1 | Composite `(trace_id, span_id)` lookup with resource/scope joins. |
| List logs | <=2 | Optional count plus one page query. |
| List metric instruments | <=2 | Optional count plus metadata page; zero per-instrument point queries. |
| Get metric points | 1 | One event-time-ordered instrument/cursor query returning metadata, exact count, and one bounded page. |
| Get facets | <=3 | Grouped trace/log/metric queries inside one RPC; no raw telemetry payload. |
| Clear all data | 1 transaction | Foreign-key order or cascades; reset intern caches. |
| Ingest one export batch | 1 transaction | Prepared row statements are allowed; no connection or transaction per item. |

A SQL statement per row inside one local prepared transaction is not a network N+1 problem, but preparing a new command per row or querying child collections per parent is. We track both statement count and elapsed time.

## Pagination

Target list APIs use keyset cursors:

- Traces: `(sort_value, trace_id)`.
- Logs: `(time_unix_nano, id)` or `(severity_number, time_unix_nano, id)`.
- Metric instruments: `(scope_name, name, id)`.
- Metric points: `(time_unix_nano, id)`.

The cursor is an opaque, versioned, base64url-encoded JSON payload signed or MACed with a runtime-local key to prevent arbitrary query injection. Sort direction and normalized filter hash are embedded; changing filters invalidates the cursor.

`totalCount` is optional because exact counts can dominate large filtered queries. The UI requests it for the first page or facets, not on every live refresh.

## Trace Tree Construction

A trace detail request returns all spans in one bounded query. The engine then builds:

- `spanById: Map<SpanId, Span>`;
- `childrenByParentId: Map<SpanId, Span[]>`;
- roots/orphans list;
- optional `logsBySpanId` from one bounded log query.

This is $O(n + l)$ for $n$ spans and $l$ logs. Never call `filter(allSpans)` once per span; that reproduces the Aspire waterfall's $O(n^2)$ child lookup.

## Comparison With Aspire's Experimental Branch

The referenced Aspire work is not on current `main`. It is the unmerged branch `origin/copilot/externalize-telemetry-with-sqlite`, based on a November 2025 commit and authored by `copilot-swe-agent[bot]`.

Its experiment is useful as a warning, not a target:

- Whole logs/traces/spans are serialized into JSON `Data` columns, so most filters cannot use SQL indexes.
- `GetTracesAsync` applies pagination but ignores the requested resource, text, and telemetry filters.
- Trace list rows deserialize complete trace JSON including spans.
- Trace insert executes one trace command plus one newly prepared command per span.
- `SpanId` is incorrectly globally unique there as well.
- Timestamps are ISO text and duration is mixed into ticks.
- Metrics are absent from `ITelemetryStorage`.
- Trace detail still reads the old in-memory repository, so persistence is not a complete source of truth after restart.
- The branch's shipping in-memory waterfall calls a full-span child scan for each span, producing $O(n^2)$ work, and trace logs are fetched without an explicit limit.

OTelux already has a stronger normalized baseline, materialized trace summaries, retention, migrations, signal-scoped/coalesced UI invalidation, grouped resource facets, and bounded metric histories. The remaining main-process isolation, cursor pagination, FTS, and query-budget harness work must land before claiming a hardened daemon API.

## Measured renderer incident (2026-07-31)

The production 124 MB dogfood database exposed an architectural payload failure rather than a React rendering algorithm problem:

| Probe | Before | After bounded/faceted architecture |
|---|---:|---:|
| Renderer heap after GC on Traces startup | ~667 MB | ~6.4 MB |
| Hidden metrics probe | 81.5 MB, ~4.9 s over IPC | not issued |
| Hidden logs probe | 5.9 MB, ~2.4 s over IPC | bounded summary DTOs; full attributes load only for one selected log |
| Trace list IPC while main was saturated | ~2.3 s | ~8 ms |
| Service facet payload | sampled raw records | 165–173 bytes grouped in SQL |
| Metric instrument list | all histories | ~60 KB with one latest point each |
| Selected-trace row interaction | effectively starved | ~26 ms pointer-to-selection |

Schema v4 promotes application source into indexed `source_name` columns and `trace_sources(trace_id, source_name)`. Source is the standard resource `service.namespace` when present and exact `service.name` otherwise. Existing records therefore migrate deterministically without vendor mappings; records that never carried a namespace remain separate services/sources.

The renderer DOM was not the primary memory owner in that incident: about 4,200 trace-view elements remained after the fix while heap fell by two orders of magnitude. The root cause was eagerly retaining full hidden-view query results and repeatedly serializing them through the main process. Log pages now carry bounded summaries (including a message capped at 4,096 characters) and load one full record by opaque ID when selected; metrics refresh no faster than every two seconds and load only the selected series history.

## Measured trace interaction audit (2026-08-02)

A separate fresh-eye audit isolated common trace scrolling/selection latency after the payload incident was fixed. On a deterministic 10,000-trace / 200,000-span / ~100 MB SQLite fixture, list-200 p95 was 2.78 ms, text-search p95 10.45 ms, a 20-span detail fetch p95 0.63 ms, and source facets p95 1.25 ms. Storage SQL is therefore not the primary normal-click latency, although synchronous execution in Electron main remains unsafe under concurrent ingest and pruning.

The renderer path is structurally expensive:

- Mounting 200 trace cards took 568 ms in the jsdom structural probe.
- Fifty rapid selections took 2,357 ms to dispatch, launched fifty `getTrace` calls, and caused 108 React commits / 2,965 ms aggregate render time; the largest commit was 381 ms.
- Waterfall rows render one DOM guide for every ancestor. A 100-deep chain created 5,879 nodes / 482 ms; 500 deep created 129,279 nodes / 6,156 ms; 1,000 deep exhausted the 4 GB test heap.
- Recursive DFS layout overflows the JavaScript stack at 5,000-deep traces.

The fix is not a framework migration. React/Electron remain appropriate. The interaction sprint delivered iterative O(n) layout, constant-DOM indent rendering, fixed-height row virtualization, stable memoized trace-row props, same-turn latest-only selection, stale-generation rejection, and a bounded recent-trace LRU. Protocol 0.6 adds a lightweight waterfall query while selected full span bags load separately. SQLite operations now execute in one worker with a 512-request hard bound and direct reads prioritized over ingest/maintenance. Permanent tests cover 10,000-depth stack safety, 1,000-depth DOM bounds, 200-result mounted-row bounds, 50-selection coalescing, A → B → A cache reuse, worker event-loop isolation, and receiver overload rejection. Effects stay reserved for external synchronization rather than derived state or fetch-trigger chains.

## Verification

Add a query-budget test harness around `DatabaseSync` that records prepared/executed SQL and captures `EXPLAIN QUERY PLAN` output for supported query shapes.

Required fixtures:

- 10,000 traces with mixed services and errors;
- one 10,000-span trace arriving across many batches;
- 1,000,000 logs with trace/service/severity skew and searchable attributes;
- 500 instruments with 10,000 points each;
- duplicate `span_id` values in different traces;
- continuous ingest while paginating.

Required assertions:

- statement budgets above are not exceeded;
- required indexes appear in query plans and accidental full scans fail tests;
- service-filtered count/page results are exact;
- cursor pages have no duplicates or omissions under deterministic concurrent inserts;
- trace tree construction is iterative and linear for a 5,000-deep trace;
- a 10,000-span waterfall mounts fewer than 100 rows / 2,000 DOM nodes and does not overflow stack or heap;
- a 200-result trace list mounts fewer than 50 rows and selection rerenders only previous/new rows;
- 50 rapid selections launch at most two detail requests, never commit stale results, and respect cache byte/entry caps;
- payload byte limits are respected, including waterfall summary versus selected-span detail and log-summary page versus selected-log detail payloads;
- no SQLite operation executes synchronously in Electron main;
- the packaged benchmark builds 10,000 traces / 200,000 spans plus deep/wide adversarial traces, exercises rapid selection and cursor paging during continuous ingest, and enforces post-GC heap/frame/DOM budgets;
- memory and SQLite backends remain behaviorally equivalent.

Performance thresholds should be measured on representative Linux, macOS, and Windows hardware and recorded as release budgets only after the query shapes are corrected. Query-count and bounded-payload invariants can be enforced immediately.
