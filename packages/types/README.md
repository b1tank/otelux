# @otelux/types

OpenTelemetry data-model TypeScript types used across `@otelux/*`. These
mirror the OTLP wire format
(https://opentelemetry.io/docs/specs/otlp/) and are the canonical
in-memory representation every other package consumes.

Milestone 1 covers the trace signal end-to-end: `TraceId`, `SpanId`,
`Span` (including `SpanKind`, status, events, links), `Resource`, and
`InstrumentationScope`, plus the `AttributeValue` / `AttributeMap`
primitives shared by every signal. Logs, metrics, and profiles land in
later milestones alongside their respective ingest paths.

## Status

Pre-release. APIs may change without notice until Milestone 1 ships.
