# @otelux/receiver

OTLP receiver wired to an `@otelux/engine` instance.

The receiver currently ships the OTLP/HTTP **JSON** encoding for traces, logs, and metrics:

- `POST /v1/traces` — accepts `ExportTraceServiceRequest` JSON bodies and decodes them into engine spans via `decodeExportTraceServiceRequest`.
- `POST /v1/logs` — accepts `ExportLogsServiceRequest` JSON bodies and decodes them into engine log records via `decodeExportLogsServiceRequest`.
- `POST /v1/metrics` — accepts `ExportMetricsServiceRequest` JSON bodies and decodes them into engine metrics via `decodeExportMetricsServiceRequest`.
- `GET /healthz` — 200 OK probe used by the desktop app to know when the server is ready to accept connections.
- Binds to `127.0.0.1:4318` by default so a desktop install is not exposed on the LAN; both host and port are configurable.

The protobuf encoding (`Content-Type: application/x-protobuf`) and the OTLP/gRPC server are intentionally deferred — OTel SDKs all support `protocol=http/json`, so JSON keeps local development useful while the receiver hardening work continues.
