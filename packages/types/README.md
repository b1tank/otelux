# @otelux/types

OpenTelemetry data-model TypeScript types used across `@otelux/*`. These mirror the OTLP wire format (https://opentelemetry.io/docs/specs/otlp/) and are the canonical in-memory representation every other package consumes.

The package covers the live trace, log, and metric surfaces: `TraceId`, `SpanId`, `Span`, `LogRecord`, `Metric`, `Resource`, `InstrumentationScope`, and the `AttributeValue` / `AttributeMap` primitives shared by every signal. Profiles are planned for a later phase.

## Status

Pre-release. APIs may change while the workbench and storage layers settle.
