# @otelux/receiver

OTLP receiver wired to an `@otelux/engine` instance.

Milestone 1 ships the OTLP/HTTP **JSON** encoding for traces:

- `POST /v1/traces` — accepts `ExportTraceServiceRequest` JSON bodies and
  decodes them into engine spans via `decodeExportTraceServiceRequest`.
- `GET /healthz` — 200 OK probe used by the desktop app to know when the
  server is ready to accept connections.
- Binds to `127.0.0.1:4318` by default so a desktop install is not
  exposed on the LAN; both host and port are configurable.

The protobuf encoding (`Content-Type: application/x-protobuf`) and the
OTLP/gRPC server are intentionally deferred — OTel SDKs all support
`protocol=http/json`, so we lose no real-world senders in M1. Logs and
metrics ingest lands alongside their query paths in later milestones.
