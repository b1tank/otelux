/**
 * OTLP/HTTP JSON decoder for logs.
 *
 * Mirrors the trace decoder in `otlp.ts`: camelCase fields, fixed64 sent as
 * JSON strings, attribute values wrapped in `AnyValue` envelopes. We accept
 * the JSON shape that OpenTelemetry SDKs emit and normalize it to our
 * internal {@link LogRecord} model. Unknown fields are dropped silently —
 * receivers must be lenient.
 *
 * The load-bearing case for OTelux is the Codex CLI logs pipeline, which
 * carries the human-readable content. A real record looks like (truncated):
 *   {
 *     "resourceLogs": [{
 *       "resource": { "attributes": [{ "key": "service.name",
 *                                       "value": { "stringValue": "codex_exec" } }] },
 *       "scopeLogs": [{
 *         "scope": { "name": "codex" },
 *         "logRecords": [{
 *           "timeUnixNano": "1750000000000000000",
 *           "observedTimeUnixNano": "1750000000000000000",
 *           "severityNumber": 9, "severityText": "INFO",
 *           "eventName": "codex.user_prompt",
 *           "attributes": [
 *             { "key": "event.name", "value": { "stringValue": "codex.user_prompt" } },
 *             { "key": "prompt",     "value": { "stringValue": "Reply with …" } }
 *           ]
 *         }]
 *       }]
 *     }]
 *   }
 *
 * Note: Codex puts the payload in `attributes` (`prompt`, `model`, …), not
 * in `body`. The body may be absent entirely.
 */

import type { AttributeValue, InstrumentationScope, LogRecord, Resource } from '@otelux/types';
import {
	type OtlpAnyValue,
	type OtlpAttribute,
	type OtlpResource,
	type OtlpScope,
	decodeAnyValue,
	decodeAttributes,
	decodeResource,
	decodeScope,
} from './otlp.js';

interface OtlpLogRecord {
	timeUnixNano?: string;
	observedTimeUnixNano?: string;
	severityNumber?: number;
	severityText?: string;
	eventName?: string;
	body?: OtlpAnyValue;
	attributes?: OtlpAttribute[];
	droppedAttributesCount?: number;
	flags?: number;
	traceId?: string;
	spanId?: string;
}

interface OtlpScopeLogs {
	scope?: OtlpScope;
	logRecords?: OtlpLogRecord[];
}

interface OtlpResourceLogs {
	resource?: OtlpResource;
	scopeLogs?: OtlpScopeLogs[];
}

export interface OtlpExportLogsServiceRequest {
	resourceLogs?: OtlpResourceLogs[];
}

function decodeLogRecord(
	r: OtlpLogRecord,
	resource: Resource,
	scope: InstrumentationScope,
): LogRecord | undefined {
	// A record with neither an explicit nor an observed timestamp can't be
	// placed on a timeline — drop it rather than invent a time. Codex emits
	// `timeUnixNano: "0"` (the explicit timestamp is unset) and carries the
	// real emit time only in `observedTimeUnixNano`, so a zero/empty explicit
	// value is treated as absent and we fall back to the observed time
	// instead of pinning the record to the Unix epoch.
	const explicitTime = r.timeUnixNano && r.timeUnixNano !== '0' ? r.timeUnixNano : undefined;
	const time = explicitTime ?? r.observedTimeUnixNano;
	if (!time || time === '0') {
		return undefined;
	}
	const body: AttributeValue | undefined = decodeAnyValue(r.body);
	const record: LogRecord = {
		timeUnixNano: BigInt(time),
		severityNumber: r.severityNumber ?? 0,
		attributes: decodeAttributes(r.attributes),
		resource,
		scope,
		...(r.observedTimeUnixNano ? { observedTimeUnixNano: BigInt(r.observedTimeUnixNano) } : {}),
		...(r.severityText ? { severityText: r.severityText } : {}),
		...(r.eventName ? { eventName: r.eventName } : {}),
		...(body !== undefined ? { body } : {}),
		...(r.droppedAttributesCount !== undefined
			? { droppedAttributesCount: r.droppedAttributesCount }
			: {}),
		...(r.flags !== undefined ? { flags: r.flags } : {}),
		...(r.traceId ? { traceId: r.traceId } : {}),
		...(r.spanId ? { spanId: r.spanId } : {}),
	};
	return record;
}

/**
 * Decode an OTLP/HTTP JSON `ExportLogsServiceRequest` into our internal
 * {@link LogRecord} model. Drops records with no usable timestamp.
 */
export function decodeExportLogsServiceRequest(payload: OtlpExportLogsServiceRequest): LogRecord[] {
	const records: LogRecord[] = [];
	for (const rl of payload.resourceLogs ?? []) {
		const resource = decodeResource(rl.resource);
		for (const sl of rl.scopeLogs ?? []) {
			const scope = decodeScope(sl.scope);
			for (const r of sl.logRecords ?? []) {
				const decoded = decodeLogRecord(r, resource, scope);
				if (decoded) {
					records.push(decoded);
				}
			}
		}
	}
	return records;
}
