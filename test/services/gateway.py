"""
api-gateway — Entry point for all requests.

Routes:
  GET  /health         → internal health check
  GET  /users          → proxy to user-service
  GET  /users/<id>     → proxy to user-service
  POST /orders         → proxy to order-service
  GET  /slow           → simulates slow request
"""
import time
import requests
from flask import Flask, request, jsonify
from opentelemetry import trace, context
from opentelemetry.trace import StatusCode, SpanKind
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from otel_config import setup_tracing

app = Flask(__name__)
tracer = setup_tracing("api-gateway", "2.1.0")
propagator = TraceContextTextMapPropagator()

USER_SVC = "http://localhost:5001"
ORDER_SVC = "http://localhost:5002"


def propagated_headers():
    """Inject current trace context into HTTP headers for downstream calls."""
    headers = {}
    propagator.inject(headers)
    return headers


@app.route("/health")
def health():
    with tracer.start_as_current_span("health_check", kind=SpanKind.INTERNAL) as span:
        span.set_attribute("health.status", "ok")
        return jsonify({"status": "ok"})


@app.route("/users")
def list_users():
    with tracer.start_as_current_span("GET /users", kind=SpanKind.SERVER) as span:
        span.set_attribute("http.method", "GET")
        span.set_attribute("http.url", "/users")
        span.set_attribute("http.route", "/users")

        # Auth check (internal span)
        with tracer.start_as_current_span("auth.verify", kind=SpanKind.INTERNAL) as auth_span:
            auth_span.set_attribute("auth.method", "bearer_token")
            auth_span.set_attribute("auth.user_id", "usr_42")
            time.sleep(0.003)  # simulate token validation

        # Call user-service
        with tracer.start_as_current_span("call user-service", kind=SpanKind.CLIENT) as client_span:
            client_span.set_attribute("http.method", "GET")
            client_span.set_attribute("http.url", f"{USER_SVC}/users")
            client_span.set_attribute("peer.service", "user-service")
            try:
                resp = requests.get(f"{USER_SVC}/users", headers=propagated_headers(), timeout=5)
                client_span.set_attribute("http.status_code", resp.status_code)
                span.set_attribute("http.status_code", resp.status_code)
                return jsonify(resp.json()), resp.status_code
            except requests.RequestException as e:
                client_span.set_status(StatusCode.ERROR, str(e))
                client_span.record_exception(e)
                span.set_status(StatusCode.ERROR, "upstream failure")
                return jsonify({"error": "user-service unavailable"}), 502


@app.route("/users/<int:user_id>")
def get_user(user_id):
    with tracer.start_as_current_span("GET /users/:id", kind=SpanKind.SERVER) as span:
        span.set_attribute("http.method", "GET")
        span.set_attribute("http.url", f"/users/{user_id}")
        span.set_attribute("http.route", "/users/:id")
        span.set_attribute("user.id", user_id)

        with tracer.start_as_current_span("call user-service", kind=SpanKind.CLIENT) as client_span:
            client_span.set_attribute("peer.service", "user-service")
            try:
                resp = requests.get(f"{USER_SVC}/users/{user_id}",
                                    headers=propagated_headers(), timeout=5)
                client_span.set_attribute("http.status_code", resp.status_code)
                span.set_attribute("http.status_code", resp.status_code)
                if resp.status_code == 404:
                    span.set_status(StatusCode.ERROR, "user not found")
                return jsonify(resp.json()), resp.status_code
            except requests.RequestException as e:
                client_span.set_status(StatusCode.ERROR, str(e))
                client_span.record_exception(e)
                return jsonify({"error": "upstream failure"}), 502


@app.route("/orders", methods=["POST"])
def create_order():
    with tracer.start_as_current_span("POST /orders", kind=SpanKind.SERVER) as span:
        span.set_attribute("http.method", "POST")
        span.set_attribute("http.url", "/orders")

        body = request.get_json(silent=True) or {}
        span.set_attribute("order.user_id", body.get("user_id", "unknown"))
        span.set_attribute("order.items_count", len(body.get("items", [])))

        # Validate request
        with tracer.start_as_current_span("validate_request", kind=SpanKind.INTERNAL) as val_span:
            if not body.get("user_id"):
                val_span.set_status(StatusCode.ERROR, "missing user_id")
                span.set_status(StatusCode.ERROR, "validation failed")
                span.set_attribute("http.status_code", 400)
                return jsonify({"error": "user_id required"}), 400
            val_span.set_attribute("validation.passed", True)

        # Call order-service
        with tracer.start_as_current_span("call order-service", kind=SpanKind.CLIENT) as client_span:
            client_span.set_attribute("peer.service", "order-service")
            try:
                resp = requests.post(f"{ORDER_SVC}/orders", json=body,
                                     headers=propagated_headers(), timeout=10)
                client_span.set_attribute("http.status_code", resp.status_code)
                span.set_attribute("http.status_code", resp.status_code)
                if resp.status_code >= 400:
                    span.set_status(StatusCode.ERROR, "order creation failed")
                return jsonify(resp.json()), resp.status_code
            except requests.RequestException as e:
                client_span.set_status(StatusCode.ERROR, str(e))
                client_span.record_exception(e)
                span.set_status(StatusCode.ERROR, "order-service unavailable")
                span.set_attribute("http.status_code", 502)
                return jsonify({"error": "order-service unavailable"}), 502


@app.route("/slow")
def slow_request():
    with tracer.start_as_current_span("GET /slow", kind=SpanKind.SERVER) as span:
        span.set_attribute("http.method", "GET")
        span.set_attribute("http.url", "/slow")

        with tracer.start_as_current_span("slow_computation", kind=SpanKind.INTERNAL) as slow_span:
            slow_span.add_event("computation_started", {"phase": "init"})
            time.sleep(0.05)
            slow_span.add_event("phase_1_complete", {"items_processed": 1000})
            time.sleep(0.08)
            slow_span.add_event("phase_2_complete", {"items_processed": 5000})
            time.sleep(0.02)
            slow_span.set_attribute("total_items", 6000)

        span.set_attribute("http.status_code", 200)
        return jsonify({"status": "done", "items": 6000})


if __name__ == "__main__":
    print("api-gateway starting on :5000")
    app.run(host="0.0.0.0", port=5000, debug=False)
