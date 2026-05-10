"""
order-service — Order creation with user validation and DB writes.

Routes:
  POST /orders     → create order (calls user-service to validate user)
  GET  /orders     → list recent orders
"""
import time
import sqlite3
import json
import uuid
import requests
from flask import Flask, request, jsonify
from opentelemetry import trace, context
from opentelemetry.trace import StatusCode, SpanKind, Link
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from otel_config import setup_tracing

app = Flask(__name__)
tracer = setup_tracing("order-service", "3.0.1")
propagator = TraceContextTextMapPropagator()

DB_PATH = "/tmp/otelux_test_orders.db"


def _init_db():
    """Initialize SQLite DB for orders."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, user_id TEXT, items TEXT, total REAL,
        status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.commit()
    conn.close()


def _extract_context():
    from flask import request as flask_request
    ctx = propagator.extract(flask_request.headers)
    return ctx


def _propagated_headers():
    headers = {}
    propagator.inject(headers)
    return headers


@app.route("/orders", methods=["POST"])
def create_order():
    ctx = _extract_context()
    token = context.attach(ctx)
    try:
        with tracer.start_as_current_span("POST /orders", kind=SpanKind.SERVER) as span:
            span.set_attribute("http.method", "POST")
            span.set_attribute("http.url", "/orders")

            body = request.get_json(silent=True) or {}
            user_id = body.get("user_id")
            items = body.get("items", [])
            span.set_attribute("order.user_id", user_id or "unknown")
            span.set_attribute("order.items_count", len(items))

            # Validate user exists (cross-service call)
            with tracer.start_as_current_span("validate_user", kind=SpanKind.CLIENT) as val_span:
                val_span.set_attribute("peer.service", "user-service")
                val_span.set_attribute("http.method", "GET")
                val_span.set_attribute("http.url", f"http://localhost:5001/users/{user_id}")
                try:
                    resp = requests.get(f"http://localhost:5001/users/{user_id}",
                                        headers=_propagated_headers(), timeout=5)
                    val_span.set_attribute("http.status_code", resp.status_code)
                    if resp.status_code == 404:
                        val_span.set_status(StatusCode.ERROR, "user not found")
                        span.set_status(StatusCode.ERROR, "invalid user")
                        span.set_attribute("http.status_code", 400)
                        return jsonify({"error": f"user {user_id} not found"}), 400
                except requests.RequestException as e:
                    val_span.set_status(StatusCode.ERROR, str(e))
                    val_span.record_exception(e)
                    span.set_status(StatusCode.ERROR, "user validation failed")
                    span.set_attribute("http.status_code", 502)
                    return jsonify({"error": "user-service unavailable"}), 502

            # Calculate total
            with tracer.start_as_current_span("calculate_total", kind=SpanKind.INTERNAL) as calc_span:
                total = sum(item.get("price", 0) * item.get("qty", 1) for item in items)
                calc_span.set_attribute("order.total", total)
                calc_span.set_attribute("order.currency", "USD")
                if total > 10000:
                    calc_span.add_event("high_value_order", {"total": total, "threshold": 10000})

            order_id = str(uuid.uuid4())[:8]

            # Write to DB
            with tracer.start_as_current_span("db.insert", kind=SpanKind.CLIENT) as db_span:
                db_span.set_attribute("db.system", "sqlite")
                db_span.set_attribute("db.name", "orders")
                db_span.set_attribute("db.operation", "INSERT")
                db_span.set_attribute("db.statement",
                                      "INSERT INTO orders (id, user_id, items, total, status) VALUES (...)")

                conn = sqlite3.connect(DB_PATH)
                time.sleep(0.008)  # simulate DB latency
                try:
                    conn.execute(
                        "INSERT INTO orders (id, user_id, items, total, status) VALUES (?, ?, ?, ?, ?)",
                        (order_id, user_id, json.dumps(items), total, "created"))
                    conn.commit()
                    db_span.set_attribute("db.rows_affected", 1)
                    db_span.add_event("order_persisted", {"order_id": order_id})
                except Exception as e:
                    db_span.set_status(StatusCode.ERROR, str(e))
                    db_span.record_exception(e)
                    span.set_status(StatusCode.ERROR, "db write failed")
                    span.set_attribute("http.status_code", 500)
                    return jsonify({"error": "database error"}), 500
                finally:
                    conn.close()

            # Publish order event (PRODUCER span — simulates message queue)
            with tracer.start_as_current_span("publish order.created", kind=SpanKind.PRODUCER) as pub_span:
                pub_span.set_attribute("messaging.system", "internal")
                pub_span.set_attribute("messaging.destination", "orders.created")
                pub_span.set_attribute("messaging.message_id", order_id)
                pub_span.add_event("message_published", {
                    "topic": "orders.created",
                    "order_id": order_id,
                    "user_id": user_id,
                })
                time.sleep(0.002)  # simulate publish latency

            span.set_attribute("http.status_code", 201)
            span.set_attribute("order.id", order_id)
            return jsonify({"id": order_id, "total": total, "status": "created"}), 201
    finally:
        context.detach(token)


@app.route("/orders")
def list_orders():
    ctx = _extract_context()
    token = context.attach(ctx)
    try:
        with tracer.start_as_current_span("GET /orders", kind=SpanKind.SERVER) as span:
            span.set_attribute("http.method", "GET")
            span.set_attribute("http.url", "/orders")

            with tracer.start_as_current_span("db.query", kind=SpanKind.CLIENT) as db_span:
                db_span.set_attribute("db.system", "sqlite")
                db_span.set_attribute("db.statement", "SELECT * FROM orders ORDER BY created_at DESC LIMIT 50")
                db_span.set_attribute("db.operation", "SELECT")

                conn = sqlite3.connect(DB_PATH)
                rows = conn.execute(
                    "SELECT id, user_id, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 50"
                ).fetchall()
                conn.close()
                db_span.set_attribute("db.rows_affected", len(rows))

            orders = [{"id": r[0], "user_id": r[1], "total": r[2],
                       "status": r[3], "created_at": r[4]} for r in rows]
            span.set_attribute("http.status_code", 200)
            return jsonify(orders)
    finally:
        context.detach(token)


if __name__ == "__main__":
    _init_db()
    print("order-service starting on :5002")
    app.run(host="0.0.0.0", port=5002, debug=False)
