/**
 * OpenTelemetry data-model TypeScript types.
 *
 * These mirror the OTLP wire format (https://opentelemetry.io/docs/specs/otlp/)
 * and serve as the canonical in-memory representation across @otelux packages.
 * Phase 0 ships only the minimum needed for the workspace to typecheck; full
 * trace/log/metric/profile types land in Phase 1.
 */

export type Nanoseconds = bigint;

export interface Resource {
	attributes: Record<string, AttributeValue>;
	droppedAttributesCount?: number;
}

export type AttributeValue =
	| string
	| number
	| bigint
	| boolean
	| readonly string[]
	| readonly number[]
	| readonly bigint[]
	| readonly boolean[];

export const OTELUX_TYPES_VERSION = '0.0.0' as const;
