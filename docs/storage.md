# OTelux Storage And Query Design

Updated: 2026-07-16

OTelux uses SQLite as a local telemetry engine, not as a JSON file cabinet. The schema and query API are designed together so every supported UI or agent workflow has a bounded, indexed path with a known SQL statement budget.

## Invariants

1. The local runtime is the only writer and the only process that opens the active database.
2. Storage identity follows OpenTelemetry identity rules. A span is identified by `(trace_id, span_id)`, never `span_id` alone.
3. Filters are applied before count and pagination. `totalCount` describes the same predicate as `rows`.
4. List queries return summaries, not full detail graphs or metric histories.
5. Detail queries batch related records. No per-row SQL query is allowed in a list or waterfall loop.
6. Every result is bounded by row count, time window, or both.
7. Schema migrations are forward-only, transactional where SQLite permits, and covered by old-database fixtures.
8. Query plans and statement counts are tested, not inferred from code review alone.

## Current Strengths

- WAL plus `synchronous=NORMAL` lets ingest and query proceed concurrently.
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
| P0 | `spans.span_id` is the primary key, `Storage.getSpan` accepts only `spanId`, and `DataSource.getSpanDetails` carries only `spanId`. OTLP span IDs are unique only within a trace. | Both memory and SQLite contracts are wrong; SQLite can overwrite another trace's span and return stale rollups/details. | Change the shared contract first, then schema v2 uses `PRIMARY KEY(trace_id, span_id)` and every span lookup requires both IDs. |
| P1 | Trace service filtering occurs after SQL `LIMIT/OFFSET`; the count query omits the service filter. | Short/empty pages and incorrect totals. | Normalize `trace_services(trace_id, service_name)` and apply an indexed `EXISTS` predicate to both count and page queries. |
| P1 | `listMetrics` selects points once per returned instrument. | $N+2$ SQL statements, up to 500 eager histories in the current UI. | Split instrument metadata from point history; batch or query points only for the selected instrument/window. |
| P1 | Metric list results can carry up to 10,000 points per instrument. | Very large IPC/HTTP payloads, decoding cost, and renderer memory pressure. | `listMetricInstruments` returns metadata/latest summary only; `getMetricPoints` is windowed and paged. |
| P2 | UI discovers service/meter facets by fetching 500 traces, 500 logs, and 500 full metric instruments. | Redundant queries and payloads on startup/change. | Add grouped facet queries and one `telemetry/getFacets` RPC. |
| P2 | Offset pagination is used while new telemetry arrives. | Duplicate or skipped rows between pages. | Use opaque keyset cursors with stable ID tie-breakers. |
| P2 | Trace rollup is fully recomputed from all spans after every affected write. | Repeated $O(n)$ work for large traces arriving in many batches. | Keep correctness first; measure and introduce bounded dirty-trace coalescing or incremental aggregates only if budgets fail. |
| P2 | `search_text LIKE '%term%'` cannot use a normal B-tree index. | Full log scan for substring search. | Add FTS5 with explicit tokenizer/versioning, retaining deterministic fallback semantics. |
| P3 | Dynamic count/page SQL is prepared for every list call. | Avoidable parse/prepare overhead. | Cache statements by finite query shape after higher-impact fixes. |

The two highest-severity correctness findings were reproduced directly against the current built SQLite package:

```json
{"traceList":[{"id":"bbbb...","count":1},{"id":"aaaa...","count":1}],"traceASpans":0,"traceBSpans":1}
{"totalCount":2,"rowCount":0,"names":[]}
```

The first result follows two traces written with the same `span_id`; trace A keeps a stale rollup after its row is replaced by trace B. The second follows `services=["beta"]`, `limit=1` when a newer alpha trace occupies the SQL page before the post-query service filter runs.

## Target Schema Direction

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

The materialized `traces` row remains the list source. `services` may remain as display JSON temporarily, but filtering and facets use `trace_services`.

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

`metric_instruments` remains one row per identity. Add latest-point summary columns only when they are proven useful for list rendering. Point history stays in `metric_points` with an index matching selected-instrument windows:

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
| Get metric points | 1 | One instrument/time-window/cursor query. |
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

OTelux already has a stronger normalized baseline, materialized trace summaries, retention, migrations, and three-signal parity. The audit findings above must still be fixed before claiming an efficient daemon API.

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
- trace tree construction is linear;
- payload byte limits are respected;
- memory and SQLite backends remain behaviorally equivalent.

Performance thresholds should be measured on representative Linux, macOS, and Windows hardware and recorded as release budgets only after the query shapes are corrected. Query-count and bounded-payload invariants can be enforced immediately.
