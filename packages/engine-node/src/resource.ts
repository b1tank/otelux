import type { Resource } from '@otelux/types';

export function serviceNameOf(resource: Resource): string {
	const service = resource.attributes['service.name'];
	return typeof service === 'string' ? service : '';
}

/**
 * Application-level telemetry source. OpenTelemetry's standard
 * `service.namespace` groups related component services. Exact service.name is
 * the compatibility fallback; this deliberately performs no name inference.
 */
export function sourceNameOf(resource: Resource): string {
	const namespace = resource.attributes['service.namespace'];
	return typeof namespace === 'string' && namespace !== '' ? namespace : serviceNameOf(resource);
}
