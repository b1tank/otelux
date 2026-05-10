"""
OTelux test services — shared OpenTelemetry configuration.

Configures OTLP/HTTP export to OTelux (default localhost:24318).
"""
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource

OTELUX_ENDPOINT = os.environ.get("OTELUX_ENDPOINT", "http://localhost:24318")


def setup_tracing(service_name: str, service_version: str = "1.0.0") -> trace.Tracer:
    """Initialize OTEL tracing with OTLP/HTTP export to OTelux."""
    resource = Resource.create({
        "service.name": service_name,
        "service.version": service_version,
        "deployment.environment": "dev",
        "host.name": "localhost",
    })

    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=f"{OTELUX_ENDPOINT}/v1/traces")
    provider.add_span_processor(BatchSpanProcessor(
        exporter,
        max_queue_size=512,
        max_export_batch_size=64,
        schedule_delay_millis=1000,
    ))

    # Only set global provider for the first service; others use their own
    if not trace.get_tracer_provider().__class__.__name__.startswith("Tracer"):
        trace.set_tracer_provider(provider)

    return provider.get_tracer(service_name, service_version)
