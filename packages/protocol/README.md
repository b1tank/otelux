# @otelux/protocol

The `DataSource` interface and query/result shapes that connect `@otelux/ui` to any backend, including an in-process engine and the VS Code postMessage bridge.

The current contract covers traces, logs, and metrics:

- `listTraces(query)` — paginated trace list with sort, time-window, service, error, and free-text filters.
- `getTrace({ traceId })` — fully materialized trace with spans, root, services, and timings.
- `getSpanDetails({ spanId })` — detail view used by the span drawer.
- `listLogs(query)` — structured log search with severity, service, and free-text filters.
- `listMetrics(query)` — meter/instrument query surface for sums, gauges, and histograms.
- `subscribe(handler)` — live change events used by the workbench to refresh as new traces, logs, and metrics arrive.

Profile queries are not part of the current contract.
