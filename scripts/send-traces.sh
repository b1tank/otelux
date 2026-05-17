#!/usr/bin/env bash
# Push a fixture OTLP/HTTP request at the running desktop receiver.
#
# Usage:
#   ./scripts/send-traces.sh                            # uses fixtures/sample_trace.json on :4319
#   PORT=14318 FIXTURE=fixtures/distributed_trace.json ./scripts/send-traces.sh
#
# The desktop app's main process binds 127.0.0.1:$OTELUX_OTLP_PORT (default
# 4319 — one above the OTLP/HTTP standard 4318 to avoid colliding with a
# local OTel Collector). Run the app, then run this script in a second
# terminal — the workbench should immediately surface the new trace.

set -euo pipefail

PORT="${PORT:-4319}"
HOST="${HOST:-127.0.0.1}"
FIXTURE="${FIXTURE:-fixtures/sample_trace.json}"

if [[ ! -f "${FIXTURE}" ]]; then
	echo "error: fixture '${FIXTURE}' not found (run from repo root)" >&2
	exit 1
fi

echo "POST http://${HOST}:${PORT}/v1/traces  <-  ${FIXTURE}"

curl --fail-with-body \
	--silent --show-error \
	-X POST \
	-H 'Content-Type: application/json' \
	--data-binary "@${FIXTURE}" \
	"http://${HOST}:${PORT}/v1/traces"
echo
