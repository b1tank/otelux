# @otelux/protocol

Browser-safe contracts shared by OTelux clients and the local runtime. The package defines the `DataSource` query surface plus runtime settings, lifecycle statuses, control results, and events.

The current contract covers traces, logs, and metrics:

- `listTraces(query)` — paginated trace list with sort, time-window, service, error, and free-text filters.
- `getTrace({ traceId })` — fully materialized trace with spans, root, services, and timings.
- `getSpanDetails({ traceId, spanId })` — detail view using the full OTLP span identity.
- `listLogs(query)` — lightweight structured-log summaries with severity, service, free-text filters, and opaque detail IDs.
- `getLogDetails({ logId })` — the full selected log record, including attribute, resource, and scope bags.
- `listMetrics(query)` — meter/instrument query surface for sums, gauges, and histograms.
- `subscribe(handler)` — live change events used by the workbench to refresh as new traces, logs, and metrics arrive.

Profile queries are not part of the current contract.
