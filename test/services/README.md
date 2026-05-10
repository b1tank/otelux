# Test Services — Real Distributed Tracing

Three Python microservices that emit **real OpenTelemetry traces** to OTelux
via OTLP/HTTP. They form a realistic request graph with distributed context
propagation.

## Architecture

```
                    ┌─────────────┐
  load_gen.py ────▶ │ api-gateway │ :5000
                    │  (Flask)    │
                    └──┬──────┬───┘
                       │      │
              ┌────────┘      └────────┐
              ▼                        ▼
     ┌────────────────┐     ┌──────────────────┐
     │  user-service  │     │  order-service   │
     │    :5001       │     │    :5002         │
     └───────┬────────┘     └──────┬───────────┘
             │                     │
             ▼                     ▼
        [SQLite DB]           [SQLite DB]
```

## Quick Start

```bash
# Terminal 1: Start OTelux
./build/otelux --port 24318

# Terminal 2: Start all services
cd test/services
python3 run_all.py

# Terminal 3: Generate traffic
cd test/services
python3 load_gen.py
```

## What Gets Traced

| Scenario | Spans | Services | Features |
|----------|-------|----------|----------|
| GET /users | 5-6 | gateway → user-svc → DB | Distributed context, DB spans |
| GET /users/:id | 4-5 | gateway → user-svc → DB + cache | Cache hit/miss, 404 errors |
| POST /orders | 6-8 | gateway → order-svc → user-svc → DB | Cross-service calls, validation |
| POST /orders (fail) | 4-5 | gateway → order-svc | Error propagation, exception events |
| GET /health | 1 | gateway | Simple internal span |
| Slow request | 5-6 | gateway → user-svc → DB (slow) | Latency simulation |
| Batch orders | 8-12 | gateway → order-svc ×N | Concurrent child spans |

## Trace Features Exercised

- W3C Trace Context propagation (traceparent header)
- All span kinds: SERVER, CLIENT, INTERNAL, PRODUCER
- Error spans with status code ERROR + exception events
- Span events (logs within spans)
- Span links (batch → individual items)
- Nested spans (3-4 levels deep)
- Multiple services per trace
- DB instrumentation (db.system, db.statement)
- HTTP instrumentation (http.method, http.url, http.status_code)
- Custom attributes (user.id, order.total, cache.hit)
- Resource attributes (service.name, service.version, deployment.environment)
