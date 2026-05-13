# OTelux — Milestone Specification

Version: 2.0 | Updated: 2026-05-12

## Milestone Overview

| # | Milestone | Priority | Goal |
|---|---|---|---|
| M1 | Native Trace Core | Critical | Build the shared C++ engine for trace ingest, storage, query, and waterfall layout. |
| M2 | Linux Trace Workbench | Critical | Ship the first native Linux trace UI on top of the shared core. |
| M3 | Structured Logs | Medium | Receive, store, query, and inspect OTLP log records with trace correlation. |
| M4 | Metrics | Medium | Receive, store, aggregate, and chart OTLP metrics. |
| M5 | Profiles | Medium | Add profile ingestion and native flame graph exploration. |
| M6 | Production Hardening | Low | Retention, packaging, accessibility, import/export, and performance validation. |

## M1 — Native Trace Core

**Goal:** provide a reusable, platform-neutral engine that native shells can embed
to receive trace data, store it locally, query it efficiently, and render trace
waterfalls using deterministic layout data.

### M1.1 — C++ Core Library

| Requirement | Detail |
|---|---|
| Language | C++23. |
| Build | Meson builds `otelux_core` and a small smoke executable. |
| Public boundary | C ABI with opaque engine and result handles. |
| Ownership | Every returned object has an explicit destroy function. |
| Errors | ABI calls return integer status codes or nullable result handles. |
| Tests | Core tests link against the library without launching a UI. |

### M1.2 — Trace Storage

| Requirement | Detail |
|---|---|
| Database | SQLite, selected by database path at engine creation. |
| Trace table | Trace ID, name, root service, start time, duration, span count, error flag. |
| Span table | Span ID, trace ID, parent span ID, service, name, kind, status, start time, duration. |
| Attributes | Store span/resource/event attributes as queryable text columns first, with room for normalized indexes later. |
| Indexes | Trace time, span trace ID, service, status, and name search indexes. |
| Retention-ready | Schema boundaries must allow age/count purging later. |

### M1.3 — Trace Ingest

| Requirement | Detail |
|---|---|
| Fixture ingest | Accept trace fixture JSON through the core API for tests and smoke runs. |
| OTLP direction | Keep parser boundaries compatible with OTLP traces. |
| Idempotency | Re-ingesting the same trace updates trace summary data without duplicating spans. |
| Error propagation | Any span with error status marks the trace as errored. |
| Validation | Malformed payloads return an error and leave the store unchanged. |

### M1.4 — Trace Query

| Requirement | Detail |
|---|---|
| Filters | Service, status, and substring name search. |
| Sorting | Start time descending by default; duration and name available for UI shells. |
| Pagination | Offset and limit for virtualized trace lists. |
| Counts | Return total matching count separately from visible rows. |
| Detail lookup | Fetch spans for a trace in deterministic order. |

### M1.5 — Waterfall Layout

| Requirement | Detail |
|---|---|
| Tree building | Compute parent/child depth from span IDs and parent span IDs. |
| Row order | Parent before descendants; stable fallback ordering by start time and name. |
| Geometry | Return row index, depth, relative start, relative width, duration, service, kind, and status. |
| Collapse model | Layout API accepts collapsed span IDs and omits hidden descendants. |
| UI independence | No platform drawing objects appear in layout results. |

### M1.6 — Smoke CLI

| Requirement | Detail |
|---|---|
| Command | `otelux-smoke <db-path> <trace-fixture.json>`. |
| Behavior | Creates an engine, ingests the fixture, queries traces, and prints a compact summary. |
| Purpose | Gives CI and local development a non-UI verification path. |

### M1 Acceptance Tests

| Test | What It Protects |
|---|---|
| `test_engine_lifecycle` | Engine create/destroy and database setup. |
| `test_trace_ingest_fixture` | JSON fixture ingest populates trace and span data. |
| `test_trace_query_filters` | Service, status, search, sort, and pagination behavior. |
| `test_trace_reingest_idempotent` | Re-ingesting a trace does not duplicate spans. |
| `test_waterfall_layout` | Span tree depth and bar geometry are deterministic. |
| `test_waterfall_collapse` | Collapsed spans hide descendants. |
| `test_smoke_cli` | CLI can ingest and summarize a fixture. |

## M2 — Linux Trace Workbench

**Goal:** ship the first native shell for trace exploration.

| Area | Target |
|---|---|
| Shell | Linux desktop shell using the selected native UI toolkit. |
| Trace list | Timestamp, name, services, span count, duration, and status. |
| Filters | Service selector, search field, span kind, status, pause/resume, refresh, clear. |
| Waterfall | Native custom timeline with depth indentation, ruler, spans, events, error marks, and selection. |
| Details | Native inspector for span properties, context, resource attributes, events, and links. |
| Navigation | Back/forward semantics, keyboard selection, enter/escape, home/end, page up/down. |
| Live refresh | New traces appear while the receiver is running, with pause support. |

## M3 — Structured Logs

**Goal:** receive, store, and inspect logs with trace correlation.

| Area | Target |
|---|---|
| Ingest | OTLP log records through the core. |
| Storage | Timestamp, severity, body, scope, service, trace ID, span ID, and attributes. |
| Query | Severity, service, time range, search, and trace ID filters. |
| UI | Native log table, severity styling, expandable details, and trace navigation. |

## M4 — Metrics

**Goal:** receive, store, and chart metric data.

| Area | Target |
|---|---|
| Ingest | Gauge, sum, and histogram points. |
| Storage | Metric identity, type, timestamp, value/buckets, attributes, and exemplar trace IDs. |
| Query | Time range, service, instrument, and attribute filters. |
| Layout | Platform-neutral chart series, axes, labels, and exemplar markers. |
| UI | Meter browser, charts, table view, and exemplar-to-trace navigation. |

## M5 — Profiles

**Goal:** add profile exploration as a first-class signal.

| Area | Target |
|---|---|
| Ingest | Profile payloads and metadata. |
| Storage | Samples, stack frames, labels, timestamps, and correlation IDs. |
| Layout | Flame graph and table layout data. |
| UI | Native flame graph, search, stack table, and trace/profile correlation. |

## M6 — Production Hardening

| Area | Target |
|---|---|
| Retention | Age and count based cleanup. |
| Packaging | Platform-specific installers and update story. |
| Accessibility | Keyboard reachability, labels, focus order, and screen reader support in each shell. |
| Import/export | Save and load local telemetry sessions. |
| Performance | Validate query, layout, scrolling, and memory budgets with large fixtures. |
| Reliability | Crash-safe database writes and clear recovery UX. |

## Verification Loop

Every core change goes through:

```sh
meson setup build --wipe
ninja -C build
ninja -C build test
```

Every platform-shell change adds its shell-specific build and UI verification on
top of the core loop.

## Current Definition of Done

M1 is done when the repository builds a C++ core library, exposes a stable C ABI,
ingests a trace fixture, stores/query traces in SQLite, computes waterfall layout,
and verifies those behaviors with automated tests and the smoke executable.
