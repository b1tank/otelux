"""
load_gen.py — Generate realistic traffic across all services.

Runs a comprehensive set of scenarios to exercise every trace feature:
- Distributed context propagation across 3 services
- All span kinds: SERVER, CLIENT, INTERNAL, PRODUCER
- Error paths with exception events
- Cache hits and misses
- Slow requests with span events
- 404 lookups
- Validation failures
- High-volume batch
"""
import sys
import os
import time
import random
import requests
import concurrent.futures

sys.path.insert(0, os.path.dirname(__file__))

GATEWAY = "http://localhost:5000"


def scenario_list_users():
    """GET /users — happy path, 5-6 spans across gateway + user-service."""
    print("  [1] GET /users .................. ", end="", flush=True)
    r = requests.get(f"{GATEWAY}/users", timeout=10)
    print(f"{r.status_code} ({len(r.json())} users)")
    return r.status_code == 200


def scenario_get_user_cache_miss():
    """GET /users/1 — cache miss, 5 spans (gateway→user-svc→cache→DB→cache write)."""
    print("  [2] GET /users/1 (cache miss) ... ", end="", flush=True)
    r = requests.get(f"{GATEWAY}/users/1", timeout=10)
    print(f"{r.status_code} ({r.json().get('name', '?')})")
    return r.status_code == 200


def scenario_get_user_cache_hit():
    """GET /users/1 again — cache hit, 3 spans (gateway→user-svc→cache hit)."""
    print("  [3] GET /users/1 (cache hit) .... ", end="", flush=True)
    r = requests.get(f"{GATEWAY}/users/1", timeout=10)
    print(f"{r.status_code} (cached)")
    return r.status_code == 200


def scenario_user_not_found():
    """GET /users/999 — 404 error, error propagation across services."""
    print("  [4] GET /users/999 (404) ........ ", end="", flush=True)
    r = requests.get(f"{GATEWAY}/users/999", timeout=10)
    print(f"{r.status_code}")
    return r.status_code == 404


def scenario_create_order():
    """POST /orders — happy path, 8+ spans across 3 services."""
    print("  [5] POST /orders (happy) ........ ", end="", flush=True)
    r = requests.post(f"{GATEWAY}/orders", json={
        "user_id": 2,
        "items": [
            {"name": "Widget A", "price": 29.99, "qty": 2},
            {"name": "Widget B", "price": 49.99, "qty": 1},
        ]
    }, timeout=10)
    data = r.json()
    print(f"{r.status_code} (order={data.get('id', '?')}, total=${data.get('total', 0):.2f})")
    return r.status_code == 201


def scenario_create_order_invalid_user():
    """POST /orders with non-existent user — error spans + exception events."""
    print("  [6] POST /orders (bad user) ..... ", end="", flush=True)
    r = requests.post(f"{GATEWAY}/orders", json={
        "user_id": 9999,
        "items": [{"name": "X", "price": 10, "qty": 1}],
    }, timeout=10)
    print(f"{r.status_code}")
    return r.status_code == 400


def scenario_create_order_no_body():
    """POST /orders with no body — validation error at gateway level."""
    print("  [7] POST /orders (no body) ...... ", end="", flush=True)
    r = requests.post(f"{GATEWAY}/orders", json={}, timeout=10)
    print(f"{r.status_code}")
    return r.status_code == 400


def scenario_high_value_order():
    """POST /orders with high-value items — triggers span event."""
    print("  [8] POST /orders (high value) ... ", end="", flush=True)
    r = requests.post(f"{GATEWAY}/orders", json={
        "user_id": 1,
        "items": [{"name": "Enterprise License", "price": 15000, "qty": 1}],
    }, timeout=10)
    print(f"{r.status_code} (total=${r.json().get('total', 0):.2f})")
    return r.status_code == 201


def scenario_slow_request():
    """GET /slow — slow request with span events at each phase."""
    print("  [9] GET /slow ................... ", end="", flush=True)
    r = requests.get(f"{GATEWAY}/slow", timeout=30)
    print(f"{r.status_code} ({r.json().get('items', 0)} items)")
    return r.status_code == 200


def scenario_health_check():
    """GET /health — minimal internal span."""
    print(" [10] GET /health ................. ", end="", flush=True)
    r = requests.get(f"{GATEWAY}/health", timeout=5)
    print(f"{r.status_code}")
    return r.status_code == 200


def scenario_concurrent_orders():
    """5 concurrent orders — tests parallel span trees."""
    print(" [11] 5× concurrent POST /orders .. ", end="", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = []
        for i in range(5):
            futures.append(pool.submit(
                requests.post, f"{GATEWAY}/orders",
                json={
                    "user_id": random.choice([1, 2, 3, 4, 5]),
                    "items": [{"name": f"Item-{i}", "price": random.uniform(5, 200), "qty": 1}],
                },
                timeout=10
            ))
        results = [f.result().status_code for f in concurrent.futures.as_completed(futures)]
    ok = sum(1 for s in results if s == 201)
    print(f"{ok}/5 created")
    return ok == 5


def scenario_multiple_user_lookups():
    """Look up all 5 users — mix of cache hits and misses."""
    print(" [12] GET /users/1..5 (mixed cache)  ", end="", flush=True)
    codes = []
    for uid in range(1, 6):
        r = requests.get(f"{GATEWAY}/users/{uid}", timeout=10)
        codes.append(r.status_code)
    ok = sum(1 for c in codes if c == 200)
    print(f"{ok}/5 found")
    return ok == 5


def main():
    print("=" * 60)
    print("OTelux Load Generator — Real Distributed Traces")
    print("=" * 60)
    print(f"Target: {GATEWAY}")
    print()

    # Quick health check
    try:
        requests.get(f"{GATEWAY}/health", timeout=3)
    except requests.RequestException:
        print("ERROR: api-gateway not reachable at", GATEWAY)
        print("Start services first: python3 run_all.py")
        sys.exit(1)

    scenarios = [
        scenario_health_check,
        scenario_list_users,
        scenario_get_user_cache_miss,
        scenario_get_user_cache_hit,
        scenario_user_not_found,
        scenario_create_order,
        scenario_create_order_invalid_user,
        scenario_create_order_no_body,
        scenario_high_value_order,
        scenario_slow_request,
        scenario_concurrent_orders,
        scenario_multiple_user_lookups,
    ]

    passed = 0
    failed = 0
    for fn in scenarios:
        try:
            if fn():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"  EXCEPTION: {e}")
            failed += 1
        time.sleep(0.2)  # brief pause between scenarios

    print()
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    print("=" * 60)

    # Wait for OTEL batch export to flush
    print("Waiting 3s for OTLP batch export flush...")
    time.sleep(3)
    print("Done. Check OTelux for traces.")

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
