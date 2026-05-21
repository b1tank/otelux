# @otelux/protocol

The `DataSource` interface and query/result shapes that connect
`@otelux/ui` to any backend (in-process engine, postMessage bridge, Tauri
IPC).

Milestone 1 ships the trace surface of the contract:

- `listTraces(query)` — paginated trace list with sort, time-window,
  service, error, and free-text filters.
- `getTrace({ traceId })` — fully materialized trace with spans, root,
  services, and timings.
- `getSpanDetails({ spanId })` — detail view used by the span drawer.
- `subscribe(handler)` — live change events used by the workbench to
  refresh as new spans arrive.

Logs, metrics, and profile queries are reserved on the interface and
land alongside their ingest paths in later milestones.
