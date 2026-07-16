---
name: service-health
description: "Summarize local service health from OTelux traces, errors, latency, and logs. Use when: asking what services are active, which service is unhealthy or slow, or requesting an observability status report."
---

# Summarize service health with OTelux

1. Call `otel_get_service_overview` for the requested window (default 60 minutes).
2. Call `otel_find_recent_errors` for services with error traces and `otel_get_slowest_spans` for the busiest or explicitly requested services.
3. Use `otel_search_logs` for concrete error terms only when needed to explain an unhealthy service.
4. Build a service table with trace volume, error traces/rate (when denominator is available), span volume, slowest observed request, and confidence/coverage notes.
5. Highlight:
   - services with errors;
   - latency outliers;
   - services with weak or missing telemetry;
   - cross-service traces that concentrate failures.
6. Recommend the next trace IDs/service filters to open in the OTelux desktop UI.

Do not describe this as a production SLO report: OTelux is a local workbench and the service overview currently derives mainly from recent trace summaries. State that limitation when it materially affects the conclusion.
