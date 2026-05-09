/*
 * OTelux — ingest/otlp_json.c — OTLP JSON trace parsing
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "otlp_json.h"
#include "../store/traces.h"
#include <cJSON/cJSON.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/* Helper: extract string from JSON or return "" */
static const char *json_str(const cJSON *obj, const char *key) {
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsString(item) && item->valuestring) return item->valuestring;
    return "";
}

static int64_t json_int64(const cJSON *obj, const char *key) {
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsString(item) && item->valuestring) {
        return strtoll(item->valuestring, NULL, 10);
    }
    if (cJSON_IsNumber(item)) return (int64_t)item->valuedouble;
    return 0;
}

static int json_int(const cJSON *obj, const char *key) {
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsNumber(item)) return item->valueint;
    return 0;
}

/* Convert OTLP attributes array to a simple JSON object string */
static char *attrs_to_json(const cJSON *attrs) {
    if (!attrs || !cJSON_IsArray(attrs) || cJSON_GetArraySize(attrs) == 0)
        return NULL;

    cJSON *obj = cJSON_CreateObject();
    const cJSON *attr;
    cJSON_ArrayForEach(attr, attrs) {
        const char *key = json_str(attr, "key");
        const cJSON *value = cJSON_GetObjectItemCaseSensitive(attr, "value");
        if (key[0] && value) {
            const cJSON *sv = cJSON_GetObjectItemCaseSensitive(value, "stringValue");
            const cJSON *iv = cJSON_GetObjectItemCaseSensitive(value, "intValue");
            const cJSON *bv = cJSON_GetObjectItemCaseSensitive(value, "boolValue");
            if (cJSON_IsString(sv)) {
                cJSON_AddStringToObject(obj, key, sv->valuestring);
            } else if (cJSON_IsString(iv)) {
                cJSON_AddStringToObject(obj, key, iv->valuestring);
            } else if (cJSON_IsNumber(iv)) {
                cJSON_AddNumberToObject(obj, key, iv->valuedouble);
            } else if (cJSON_IsBool(bv)) {
                cJSON_AddBoolToObject(obj, key, cJSON_IsTrue(bv));
            }
        }
    }

    char *result = cJSON_PrintUnformatted(obj);
    cJSON_Delete(obj);
    return result;
}

/* Get service.name from resource attributes */
static const char *get_service_name(const cJSON *resource) {
    if (!resource) return "unknown";
    const cJSON *attrs = cJSON_GetObjectItemCaseSensitive(resource, "attributes");
    if (!attrs) return "unknown";

    const cJSON *attr;
    cJSON_ArrayForEach(attr, attrs) {
        if (strcmp(json_str(attr, "key"), "service.name") == 0) {
            const cJSON *value = cJSON_GetObjectItemCaseSensitive(attr, "value");
            if (value) {
                const cJSON *sv = cJSON_GetObjectItemCaseSensitive(value, "stringValue");
                if (cJSON_IsString(sv)) return sv->valuestring;
            }
        }
    }
    return "unknown";
}

int otlp_json_parse_traces(sqlite3 *db, const char *json, int len) {
    (void)len;
    cJSON *root = cJSON_Parse(json);
    if (!root) return -1;

    int span_count = 0;
    const cJSON *resource_spans = cJSON_GetObjectItemCaseSensitive(root, "resourceSpans");
    if (!resource_spans) {
        cJSON_Delete(root);
        return -1;
    }

    const cJSON *rs;
    cJSON_ArrayForEach(rs, resource_spans) {
        const cJSON *resource = cJSON_GetObjectItemCaseSensitive(rs, "resource");
        const char *service_name = get_service_name(resource);

        const cJSON *scope_spans = cJSON_GetObjectItemCaseSensitive(rs, "scopeSpans");
        const cJSON *ss;
        cJSON_ArrayForEach(ss, scope_spans) {
            const cJSON *spans = cJSON_GetObjectItemCaseSensitive(ss, "spans");
            const cJSON *span_json;
            cJSON_ArrayForEach(span_json, spans) {
                OteluxSpan span = {0};
                snprintf(span.trace_id, sizeof(span.trace_id), "%s",
                         json_str(span_json, "traceId"));
                snprintf(span.span_id, sizeof(span.span_id), "%s",
                         json_str(span_json, "spanId"));
                snprintf(span.parent_span_id, sizeof(span.parent_span_id), "%s",
                         json_str(span_json, "parentSpanId"));
                snprintf(span.name, sizeof(span.name), "%s",
                         json_str(span_json, "name"));
                snprintf(span.service_name, sizeof(span.service_name), "%s",
                         service_name);
                span.kind = json_int(span_json, "kind");
                span.start_time = json_int64(span_json, "startTimeUnixNano");
                span.duration = json_int64(span_json, "endTimeUnixNano") - span.start_time;

                const cJSON *status_obj = cJSON_GetObjectItemCaseSensitive(span_json, "status");
                if (status_obj) {
                    span.status = json_int(status_obj, "code");
                }

                const cJSON *attrs = cJSON_GetObjectItemCaseSensitive(span_json, "attributes");
                span.attributes = attrs_to_json(attrs);

                const cJSON *events_arr = cJSON_GetObjectItemCaseSensitive(span_json, "events");
                if (events_arr && cJSON_GetArraySize(events_arr) > 0) {
                    span.events = cJSON_PrintUnformatted(events_arr);
                }

                /* Upsert trace summary BEFORE inserting span (FK constraint).
                   Only set root_name from the root span (no parent). */
                int is_root = (span.parent_span_id[0] == '\0');
                OteluxTrace trace = {0};
                snprintf(trace.trace_id, sizeof(trace.trace_id), "%s", span.trace_id);
                if (is_root) {
                    snprintf(trace.root_name, sizeof(trace.root_name), "%s", span.name);
                }
                snprintf(trace.service_name, sizeof(trace.service_name), "%s", span.service_name);
                trace.start_time = span.start_time;
                trace.duration = span.duration;
                trace.span_count = 1;
                trace.has_error = (span.status == 2) ? 1 : 0;
                store_trace_upsert(db, &trace);

                if (store_span_insert(db, &span) == 0) {
                    span_count++;
                }

                free(span.attributes);
                free(span.events);
            }
        }
    }

    cJSON_Delete(root);
    return span_count;
}
