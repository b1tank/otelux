"""
user-service — User CRUD with DB and caching.

Routes:
  GET /users       → list all users
  GET /users/<id>  → get user by ID (with cache layer)
"""
import time
import sqlite3
import os
from flask import Flask, jsonify
from opentelemetry import trace, context
from opentelemetry.trace import StatusCode, SpanKind
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from otel_config import setup_tracing

app = Flask(__name__)
tracer = setup_tracing("user-service", "1.4.2")
propagator = TraceContextTextMapPropagator()

# Simple in-memory cache
_cache = {}

DB_PATH = "/tmp/otelux_test_users.db"


def _init_db():
    """Initialize SQLite DB with sample users."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT
    )""")
    conn.execute("DELETE FROM users")
    users = [
        (1, "Alice Chen", "alice@example.com", "admin"),
        (2, "Bob Smith", "bob@example.com", "engineer"),
        (3, "Carol Davis", "carol@example.com", "engineer"),
        (4, "Dan Wilson", "dan@example.com", "manager"),
        (5, "Eve Johnson", "eve@example.com", "intern"),
    ]
    conn.executemany("INSERT INTO users VALUES (?, ?, ?, ?)", users)
    conn.commit()
    conn.close()


def _extract_context():
    """Extract trace context from incoming request headers."""
    from flask import request
    ctx = propagator.extract(request.headers)
    return ctx


@app.route("/users")
def list_users():
    ctx = _extract_context()
    token = context.attach(ctx)
    try:
        with tracer.start_as_current_span("GET /users", kind=SpanKind.SERVER) as span:
            span.set_attribute("http.method", "GET")
            span.set_attribute("http.url", "/users")

            # DB query
            with tracer.start_as_current_span("db.query", kind=SpanKind.CLIENT) as db_span:
                db_span.set_attribute("db.system", "sqlite")
                db_span.set_attribute("db.name", "users")
                db_span.set_attribute("db.statement", "SELECT id, name, email, role FROM users")
                db_span.set_attribute("db.operation", "SELECT")

                conn = sqlite3.connect(DB_PATH)
                time.sleep(0.005)  # simulate DB latency
                rows = conn.execute("SELECT id, name, email, role FROM users").fetchall()
                conn.close()
                db_span.set_attribute("db.rows_affected", len(rows))

            users = [{"id": r[0], "name": r[1], "email": r[2], "role": r[3]} for r in rows]
            span.set_attribute("http.status_code", 200)
            span.set_attribute("users.count", len(users))
            return jsonify(users)
    finally:
        context.detach(token)


@app.route("/users/<int:user_id>")
def get_user(user_id):
    ctx = _extract_context()
    token = context.attach(ctx)
    try:
        with tracer.start_as_current_span("GET /users/:id", kind=SpanKind.SERVER) as span:
            span.set_attribute("http.method", "GET")
            span.set_attribute("http.url", f"/users/{user_id}")
            span.set_attribute("user.id", user_id)

            # Cache lookup
            with tracer.start_as_current_span("cache.lookup", kind=SpanKind.INTERNAL) as cache_span:
                cache_key = f"user:{user_id}"
                cache_span.set_attribute("cache.key", cache_key)
                if cache_key in _cache:
                    cache_span.set_attribute("cache.hit", True)
                    cache_span.add_event("cache_hit", {"key": cache_key})
                    span.set_attribute("http.status_code", 200)
                    return jsonify(_cache[cache_key])
                cache_span.set_attribute("cache.hit", False)
                cache_span.add_event("cache_miss", {"key": cache_key})

            # DB query
            with tracer.start_as_current_span("db.query", kind=SpanKind.CLIENT) as db_span:
                db_span.set_attribute("db.system", "sqlite")
                db_span.set_attribute("db.name", "users")
                db_span.set_attribute("db.statement", f"SELECT * FROM users WHERE id = {user_id}")
                db_span.set_attribute("db.operation", "SELECT")

                conn = sqlite3.connect(DB_PATH)
                time.sleep(0.003)  # simulate DB latency
                row = conn.execute("SELECT id, name, email, role FROM users WHERE id = ?",
                                   (user_id,)).fetchone()
                conn.close()

                if not row:
                    db_span.set_attribute("db.rows_affected", 0)
                    span.set_status(StatusCode.ERROR, "user not found")
                    span.set_attribute("http.status_code", 404)
                    return jsonify({"error": "user not found"}), 404

                db_span.set_attribute("db.rows_affected", 1)

            user = {"id": row[0], "name": row[1], "email": row[2], "role": row[3]}

            # Cache write
            with tracer.start_as_current_span("cache.set", kind=SpanKind.INTERNAL) as cache_span:
                cache_span.set_attribute("cache.key", f"user:{user_id}")
                _cache[f"user:{user_id}"] = user
                cache_span.add_event("cache_write", {"key": f"user:{user_id}"})

            span.set_attribute("http.status_code", 200)
            return jsonify(user)
    finally:
        context.detach(token)


if __name__ == "__main__":
    _init_db()
    print("user-service starting on :5001")
    app.run(host="0.0.0.0", port=5001, debug=False)
