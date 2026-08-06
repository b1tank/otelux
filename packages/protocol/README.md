# @otelux/protocol

Browser-safe contracts shared by OTelux clients and the local runtime. The package defines the `DataSource` query surface plus runtime settings, lifecycle statuses, control results, and events.

The current contract covers traces, logs, and metrics:

- `listTraces(query)` — paginated trace list with sort, time-window, service, error, and free-text filters.
- `getTrace({ traceId })` — fully materialized trace with spans, root, services, and timings.
- `getSpanDetails({ traceId, spanId })` — detail view using the full OTLP span identity.
- `listLogs(query)` — lightweight structured-log summaries with severity, service, free-text filters, and opaque detail IDs.
- `getLogDetails({ logId })` — the full selected log record, including attribute, resource, and scope bags.
- `listMetricInstruments(query)` — lightweight instrument metadata, latest-value summaries, and opaque instrument IDs.
- `getMetricPoints({ instrumentId, limit, cursor? })` — one selected instrument with at most 1,000 event-time-ordered points, continuation, full resource/scope metadata, and explicit attribute-truncation metadata.
- `subscribe(handler)` — live change events used by the workbench to refresh as new traces, logs, and metrics arrive.

Every advertised Runtime RPC and Electron invoke result is covered by an exhaustive canonical decoder registry. HTTP and IPC adapters use these method-specific decoders at runtime rather than trusting TypeScript casts. Checked draft 2020-12 result schemas live under `schema/v1/`, and `fixtures/results/v1.json` is the shared tagged-bigint parity fixture for all current methods.

Profile queries are not part of the current contract.
