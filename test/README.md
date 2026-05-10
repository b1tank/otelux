# OTelux Test Architecture

Three test layers run on every iteration. All three must pass before any commit.

```
ninja -C build && ninja -C build test      # L1 + L2 (< 1 second)
python3 test/services/load_gen.py          # L3 E2E  (needs live OTelux + services)
```

---

## Layer 1 — Unit Tests (`test/unit/`)

Fast, in-memory, no I/O, no GPU, no network. Each file has its own `main()`.

| Suite | Functions | What it covers |
|---|---|---|
| `test_time_fmt` | 3 | Duration formatting: ns → "1.23ms", "64.8us", "2.50s" |
| `test_color` | 2 | Span-kind → color mapping |
| `test_arena` | 3 | Arena allocator: alloc, reset, overflow |
| `test_store` | 5 | SQLite CRUD: insert, query, list, filter, count |
| `test_store_edge` | 8 | Edge cases: self-parent, service name upsert ordering, zero-duration, duplicate replace, error propagation, MIN start_time, span_count |
| `test_otlp_json` | 4 | JSON parser: valid trace, error trace, malformed, empty |
| `test_otlp_proto` | 6 | Protobuf parser: single span, parent-child, distributed, error, empty, truncated |

**Test data**: Inline struct literals and `PbWriter` (protobuf wire-format builder).
Fixed timestamps (`T_BASE = 1700000000000000000`) for deterministic assertions.

---

## Layer 2 — Integration Tests (`test/integration/`)

Multi-component pipeline: ingest → SQLite → query. Still no GPU.

| Suite | Functions | What it covers |
|---|---|---|
| `test_ingest_store` | 2 | JSON fixture → SQLite round-trip, pagination |
| `test_distributed_trace` | 4 | 3-service/8-span fixture: full parent-child chain, durations, service filter |

**Test data**: JSON fixtures in `test/fixtures/`:

```
sample_trace.json          — 3 spans, 1 service (api-gateway)
sample_trace_error.json    — 2 spans with status=ERROR + exception event
distributed_trace.json     — 8 spans across 3 services (gateway → order → user)
empty_trace.json           — valid OTLP envelope, zero spans
malformed.json             — broken JSON (parser robustness)
```

---

## Layer 3 — End-to-End (`test/services/`)

Real OpenTelemetry SDK traffic against a live OTelux instance.
This is the most important layer — it validates the full stack.

### Architecture

```
                        ┌─────────────────────────────────┐
                        │         load_gen.py              │
                        │  (12 scenarios, HTTP requests)   │
                        └────────┬────────────────────────┘
                                 │ HTTP
                                 ▼
┌────────────────────────────────────────────────────────────┐
│                     api-gateway :5000                      │
│  Flask + OpenTelemetry SDK (TracerProvider, OTLP exporter) │
│  Spans: SERVER, CLIENT, INTERNAL                           │
│  W3C Trace Context propagation (traceparent header)        │
└────────┬───────────────────────────────────┬───────────────┘
         │ HTTP + traceparent                │ HTTP + traceparent
         ▼                                   ▼
┌─────────────────────────┐    ┌──────────────────────────────┐
│   user-service :5001    │    │    order-service :5002        │
│  SQLite user DB         │    │  SQLite order DB              │
│  Cache layer (dict)     │    │  Cross-service call → user    │
│  Spans: SERVER, CLIENT, │    │  Spans: SERVER, CLIENT,       │
│         INTERNAL        │    │         INTERNAL, PRODUCER    │
└─────────────────────────┘    └───────────┬──────────────────┘
                                           │ HTTP + traceparent
                                           ▼
                               ┌──────────────────────────────┐
                               │   user-service :5001         │
                               │  (validates user for order)  │
                               └──────────────────────────────┘

         All 3 services export OTLP/HTTP protobuf ──────────────►  OTelux :24318
         (opentelemetry-sdk → otlp-proto-http)                     /v1/traces
```

### Services

| Service | Port | Role | DB | Span Kinds |
|---|---|---|---|---|
| **api-gateway** | 5000 | HTTP router, entry point | — | SERVER, CLIENT, INTERNAL |
| **user-service** | 5001 | User CRUD + cache | `/tmp/otelux_test_users.db` | SERVER, CLIENT (db), INTERNAL (cache) |
| **order-service** | 5002 | Order CRUD + validation | `/tmp/otelux_test_orders.db` | SERVER, CLIENT (db, user-svc), INTERNAL, PRODUCER |

### Load Generator Scenarios (12)

| # | Scenario | What it exercises |
|---|---|---|
| 1 | `GET /health` | Single-span minimal trace |
| 2 | `GET /users` | Multi-span, list operation |
| 3 | `GET /users/1` (cache miss) | Cross-service, DB query, cache write |
| 4 | `GET /users/1` (cache hit) | Cache hit path, INTERNAL span |
| 5 | `GET /users/999` (404) | Error handling, 404 status |
| 6 | `POST /orders` (happy) | 3-service distributed trace with DB writes |
| 7 | `POST /orders` (bad user) | Validation error, cross-service 400 |
| 8 | `POST /orders` (no body) | Request validation, 400 |
| 9 | `POST /orders` (high value) | Span events for threshold breach |
| 10 | `GET /slow` | Phased span events, ~150ms latency |
| 11 | 5× concurrent `POST /orders` | Concurrency, parallel traces |
| 12 | `GET /users/1..5` (mixed cache) | Sequential lookups, mixed hit/miss |

### Running E2E

```bash
# Terminal 1: Start OTelux
rm -f /tmp/otelux.db
GDK_BACKEND=x11 ./build/otelux --port 24318

# Terminal 2: Start test services
cd test/services && python3 run_all.py

# Terminal 3: Run load generator
cd test/services && python3 load_gen.py
# Expected: "12 passed, 0 failed, 12 total"

# Optional: Visual verification with deskpal MCP
# Screenshot OTelux window → verify trace list, waterfall, service names
```

### Trace Context Propagation

All cross-service calls carry W3C `traceparent` headers:

```
api-gateway → order-service:  traceparent: 00-{trace_id}-{span_id}-01
order-service → user-service:  traceparent: 00-{trace_id}-{span_id}-01
```

Each service extracts the context, creates child spans under the propagated parent,
and exports to OTelux via OTLP/HTTP protobuf. The result is a single distributed
trace with spans from all 3 services sharing one `trace_id`.

### What E2E Validates

- **OTLP protobuf ingest**: Real SDK sends binary protobuf, not JSON
- **Content-Type routing**: `application/x-protobuf` → proto parser
- **Distributed tracing**: Single trace_id across 3 services
- **Parent-child relationships**: Correct span nesting in waterfall
- **Service name resolution**: Root span's service shown on trace list
- **All span kinds**: SERVER, CLIENT, INTERNAL, PRODUCER
- **Error paths**: 404, 400, validation failures
- **Span events**: Exception events, threshold events
- **Concurrent traces**: No data corruption under parallelism
- **Duration accuracy**: Real-world timing, not synthetic

---

## Adding Tests

When adding a new feature, add tests at all three layers:

| Layer | What to add | Pattern |
|---|---|---|
| **L1 Unit** | New `test_*.c` in `test/unit/`, register in `test/meson.build` | Use inline data builders, `ASSERT_*` macros from `testlib.h` |
| **L2 Integration** | New `test_*.c` in `test/integration/`, add JSON fixture if needed | Wire ingest → store → query, verify round-trip |
| **L3 E2E** | New scenario in `load_gen.py`, new route in service if needed | Real HTTP call → real OTEL export → verify in OTelux |

All three layers must pass before committing:

```bash
ninja -C build && ninja -C build test   # L1 + L2: 0 failures
# + manual or scripted E2E run          # L3: 12/12 passed
```
