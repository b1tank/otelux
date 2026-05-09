#!/usr/bin/env bash
# OTelux — test/scripts/smoke.sh
# L4 smoke test: starts otelux, sends trace via HTTP, verifies response
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
OTELUX_BIN="$BUILD_DIR/otelux"
DB_FILE="/tmp/otelux_smoke_test_$$.db"
HTTP_PORT=24318
PASS=0
FAIL=0

cleanup() {
    if [ -n "${OTELUX_PID:-}" ] && kill -0 "$OTELUX_PID" 2>/dev/null; then
        kill "$OTELUX_PID" 2>/dev/null || true
        wait "$OTELUX_PID" 2>/dev/null || true
    fi
    rm -f "$DB_FILE"
}
trap cleanup EXIT

run_test() {
    local name="$1"
    shift
    if "$@"; then
        echo "  PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $name"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== OTelux Smoke Test ==="

# 1. Binary exists
run_test "binary_exists" test -x "$OTELUX_BIN"

# 2. Health endpoint
echo "Starting OTelux (headless mode)..."
# Start with GDK_BACKEND=x11 to avoid Wayland issues, or skip if no display
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    echo "  SKIP: No display available — skipping UI smoke tests"
    echo ""
    echo "Smoke results: ${PASS} passed, ${FAIL} failed (some skipped — no display)"
    exit $FAIL
fi

export GDK_BACKEND=x11
"$OTELUX_BIN" --db "$DB_FILE" --port "$HTTP_PORT" &
OTELUX_PID=$!

# Wait for HTTP to be ready
for i in $(seq 1 30); do
    if curl -s "http://localhost:${HTTP_PORT}/health" > /dev/null 2>&1; then
        break
    fi
    sleep 0.1
done

run_test "health_endpoint" curl -sf "http://localhost:${HTTP_PORT}/health"

# 3. POST trace data
TRACE_JSON=$(cat "$ROOT_DIR/test/fixtures/sample_trace.json")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "http://localhost:${HTTP_PORT}/v1/traces" \
    -H "Content-Type: application/json" \
    -d "$TRACE_JSON")
run_test "post_traces_200" [ "$HTTP_CODE" = "200" ]

# 4. POST malformed data
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "http://localhost:${HTTP_PORT}/v1/traces" \
    -H "Content-Type: application/json" \
    -d '{{broken}')
run_test "post_malformed_400" [ "$HTTP_CODE" = "400" ]

# 5. CORS headers
CORS=$(curl -sI "http://localhost:${HTTP_PORT}/health" | grep -i "access-control-allow-origin" || true)
run_test "cors_header" [ -n "$CORS" ]

echo ""
echo "Smoke results: ${PASS} passed, ${FAIL} failed"
exit $FAIL
