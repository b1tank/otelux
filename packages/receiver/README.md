# @otelux/receiver

OTLP receiver wired to an `@otelux/engine` instance.

The receiver ships the OTLP/HTTP **JSON** and **protobuf** encodings for traces, logs, and metrics, selected by `Content-Type`:

- `POST /v1/traces` — accepts `ExportTraceServiceRequest` bodies and decodes them into engine spans via `decodeExportTraceServiceRequest`.
- `POST /v1/logs` — accepts `ExportLogsServiceRequest` bodies and decodes them into engine log records via `decodeExportLogsServiceRequest`.
- `POST /v1/metrics` — accepts `ExportMetricsServiceRequest` bodies and decodes them into engine metrics via `decodeExportMetricsServiceRequest`.
- `GET /healthz` — 200 OK probe used by the desktop app to know when the server is ready to accept connections.
- Binds to `127.0.0.1:4318` by default so a desktop install is not exposed on the LAN; both host and port are configurable.

Encoding is chosen by `Content-Type`: `application/json` for JSON, or `application/x-protobuf` (also `application/protobuf`) for protobuf — the default wire format for most OTel SDK exporters. The success response mirrors the request encoding. OTLP/gRPC is still deferred.
