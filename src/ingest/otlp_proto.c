/*
 * OTelux — ingest/otlp_proto.c — OTLP protobuf wire-format parser
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 *
 * Hand-written protobuf wire-format decoder for ExportTraceServiceRequest.
 * Only parses the fields OTelux needs — no external protobuf library required.
 *
 * Proto schema reference (field numbers):
 *   ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
 *   ResourceSpans { Resource resource = 1; repeated ScopeSpans scope_spans = 2; }
 *   Resource { repeated KeyValue attributes = 1; }
 *   ScopeSpans { InstrumentationScope scope = 1; repeated Span spans = 2; }
 *   Span {
 *     bytes  trace_id = 1;       bytes  span_id = 2;
 *     string trace_state = 3;    bytes  parent_span_id = 4;
 *     string name = 5;           SpanKind kind = 6;
 *     fixed64 start_time_unix_nano = 7;  fixed64 end_time_unix_nano = 8;
 *     repeated KeyValue attributes = 9;  repeated Event events = 11;
 *     Status status = 15;
 *   }
 *   Status { string message = 1; StatusCode code = 2; }
 *   KeyValue { string key = 1; AnyValue value = 2; }
 *   AnyValue { string string_value = 1; int64 int_value = 3; bool bool_value = 5; }
 */
#define _GNU_SOURCE
#include "otlp_proto.h"
#include "../store/traces.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* --- Protobuf wire format helpers --- */

/* Wire types */
#define WT_VARINT  0
#define WT_64BIT   1
#define WT_LENGTH  2
#define WT_32BIT   5

typedef struct {
    const unsigned char *data;
    int pos;
    int len;
} PbReader;

static int pb_eof(const PbReader *r) { return r->pos >= r->len; }

static uint64_t pb_read_varint(PbReader *r) {
    uint64_t val = 0;
    int shift = 0;
    while (r->pos < r->len) {
        unsigned char b = r->data[r->pos++];
        val |= (uint64_t)(b & 0x7F) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
        if (shift > 63) break;
    }
    return val;
}

static uint64_t pb_read_fixed64(PbReader *r) {
    if (r->pos + 8 > r->len) { r->pos = r->len; return 0; }
    uint64_t val = 0;
    memcpy(&val, r->data + r->pos, 8);
    r->pos += 8;
    return val;
}

static void pb_skip(PbReader *r, int wire_type) {
    switch (wire_type) {
        case WT_VARINT: pb_read_varint(r); break;
        case WT_64BIT:  r->pos += 8; break;
        case WT_32BIT:  r->pos += 4; break;
        case WT_LENGTH: {
            int len = (int)pb_read_varint(r);
            r->pos += len;
            break;
        }
    }
    if (r->pos > r->len) r->pos = r->len;
}

/* Read a tag, return field number and wire type */
static int pb_read_tag(PbReader *r, int *wire_type) {
    if (pb_eof(r)) return 0;
    uint64_t tag = pb_read_varint(r);
    *wire_type = (int)(tag & 0x07);
    return (int)(tag >> 3);
}

/* Get a sub-reader for a length-delimited field */
static PbReader pb_sub(PbReader *r) {
    int len = (int)pb_read_varint(r);
    PbReader sub = { r->data + r->pos, 0, len };
    if (r->pos + len > r->len) sub.len = r->len - r->pos;
    r->pos += len;
    if (r->pos > r->len) r->pos = r->len;
    return sub;
}

/* Read bytes as hex string (for trace_id, span_id) */
static void pb_read_hex(PbReader *r, int byte_len, char *out, int out_len) {
    static const char hex[] = "0123456789abcdef";
    int i;
    for (i = 0; i < byte_len && i * 2 + 1 < out_len - 1 && r->pos + i <= r->len; i++) {
        unsigned char b = (r->pos + i < r->len) ? r->data[r->pos + i] : 0;
        out[i * 2]     = hex[b >> 4];
        out[i * 2 + 1] = hex[b & 0x0F];
    }
    out[i * 2] = '\0';
    r->pos += byte_len;
    if (r->pos > r->len) r->pos = r->len;
}

/* Read a string into a buffer */
static void pb_read_string(PbReader *r, int byte_len, char *out, int out_len) {
    int copy = byte_len < out_len - 1 ? byte_len : out_len - 1;
    if (r->pos + copy > r->len) copy = r->len - r->pos;
    if (copy > 0) memcpy(out, r->data + r->pos, copy);
    out[copy] = '\0';
    r->pos += byte_len;
    if (r->pos > r->len) r->pos = r->len;
}

/* --- OTLP-specific parsers --- */

/* Parse AnyValue, return as allocated string (caller frees) */
static char *parse_any_value(PbReader *r) {
    char *result = NULL;
    int wt;
    while (!pb_eof(r)) {
        int field = pb_read_tag(r, &wt);
        if (!field) break;
        switch (field) {
            case 1: { /* string_value */
                int len = (int)pb_read_varint(r);
                result = malloc(len + 1);
                if (len > 0 && r->pos + len <= r->len) {
                    memcpy(result, r->data + r->pos, len);
                }
                result[len] = '\0';
                r->pos += len;
                break;
            }
            case 3: { /* int_value */
                int64_t v = (int64_t)pb_read_varint(r);
                result = malloc(32);
                snprintf(result, 32, "%lld", (long long)v);
                break;
            }
            case 4: { /* double_value (fixed64) */
                double v;
                uint64_t raw = pb_read_fixed64(r);
                memcpy(&v, &raw, sizeof(v));
                result = malloc(32);
                snprintf(result, 32, "%.2f", v);
                break;
            }
            case 5: { /* bool_value */
                int v = (int)pb_read_varint(r);
                result = strdup(v ? "true" : "false");
                break;
            }
            default:
                pb_skip(r, wt);
                break;
        }
    }
    return result ? result : strdup("");
}

/* Parse KeyValue and append to a JSON-like string buffer */
typedef struct {
    char *buf;
    int   len;
    int   cap;
    int   count;
} AttrBuf;

static void attr_buf_init(AttrBuf *ab) {
    ab->cap = 256;
    ab->buf = malloc(ab->cap);
    ab->buf[0] = '{';
    ab->len = 1;
    ab->count = 0;
}

static void attr_buf_append(AttrBuf *ab, const char *key, const char *value) {
    /* Format: "key":"value" with JSON escaping (simplified) */
    int need = (int)strlen(key) + (int)strlen(value) + 10;
    while (ab->len + need >= ab->cap) {
        ab->cap *= 2;
        ab->buf = realloc(ab->buf, ab->cap);
    }
    if (ab->count > 0) ab->buf[ab->len++] = ',';
    ab->len += snprintf(ab->buf + ab->len, ab->cap - ab->len, "\"%s\":\"%s\"", key, value);
    ab->count++;
}

static char *attr_buf_finish(AttrBuf *ab) {
    if (ab->len + 2 >= ab->cap) {
        ab->cap += 2;
        ab->buf = realloc(ab->buf, ab->cap);
    }
    ab->buf[ab->len++] = '}';
    ab->buf[ab->len] = '\0';
    if (ab->count == 0) { free(ab->buf); return NULL; }
    return ab->buf;
}

static void parse_attributes(PbReader *r, AttrBuf *ab) {
    char key[256] = {0};
    char *value = NULL;
    int wt;
    while (!pb_eof(r)) {
        int field = pb_read_tag(r, &wt);
        if (!field) break;
        switch (field) {
            case 1: { /* key */
                int len = (int)pb_read_varint(r);
                pb_read_string(r, len, key, sizeof(key));
                break;
            }
            case 2: { /* value (AnyValue) */
                PbReader sub = pb_sub(r);
                value = parse_any_value(&sub);
                break;
            }
            default:
                pb_skip(r, wt);
                break;
        }
    }
    if (key[0] && value) {
        attr_buf_append(ab, key, value);
    }
    free(value);
}

/* Get service.name from resource attributes */
static void parse_resource(PbReader *r, char *service_name, int sn_len) {
    int wt;
    while (!pb_eof(r)) {
        int field = pb_read_tag(r, &wt);
        if (!field) break;
        if (field == 1 && wt == WT_LENGTH) { /* attributes (repeated KeyValue) */
            PbReader attr_r = pb_sub(r);
            char key[128] = {0};
            char *value = NULL;
            int awt;
            while (!pb_eof(&attr_r)) {
                int af = pb_read_tag(&attr_r, &awt);
                if (!af) break;
                if (af == 1 && awt == WT_LENGTH) { /* key */
                    int len = (int)pb_read_varint(&attr_r);
                    if (len > 0 && attr_r.pos + len <= attr_r.len) {
                        int copy = len < (int)sizeof(key) - 1 ? len : (int)sizeof(key) - 1;
                        memcpy(key, attr_r.data + attr_r.pos, copy);
                        key[copy] = '\0';
                    }
                    attr_r.pos += len;
                } else if (af == 2 && awt == WT_LENGTH) { /* value */
                    PbReader val_r = pb_sub(&attr_r);
                    value = parse_any_value(&val_r);
                } else {
                    pb_skip(&attr_r, awt);
                }
            }
            if (strcmp(key, "service.name") == 0 && value) {
                snprintf(service_name, sn_len, "%s", value);
            }
            free(value);
        } else {
            pb_skip(r, wt);
        }
    }
}

/* Parse Status message */
static int parse_status(PbReader *r) {
    int code = 0;
    int wt;
    while (!pb_eof(r)) {
        int field = pb_read_tag(r, &wt);
        if (!field) break;
        if (field == 2) { /* code */
            code = (int)pb_read_varint(r);
        } else {
            pb_skip(r, wt);
        }
    }
    return code;
}

/* Parse a single Span */
static int parse_span(PbReader *r, OteluxSpan *span) {
    AttrBuf ab;
    attr_buf_init(&ab);
    int wt;
    while (!pb_eof(r)) {
        int field = pb_read_tag(r, &wt);
        if (!field) break;
        switch (field) {
            case 1: { /* trace_id (bytes, 16 bytes) */
                int len = (int)pb_read_varint(r);
                pb_read_hex(r, len, span->trace_id, sizeof(span->trace_id));
                break;
            }
            case 2: { /* span_id (bytes, 8 bytes) */
                int len = (int)pb_read_varint(r);
                pb_read_hex(r, len, span->span_id, sizeof(span->span_id));
                break;
            }
            case 4: { /* parent_span_id (bytes) */
                int len = (int)pb_read_varint(r);
                if (len > 0) {
                    pb_read_hex(r, len, span->parent_span_id, sizeof(span->parent_span_id));
                }
                break;
            }
            case 5: { /* name (string) */
                int len = (int)pb_read_varint(r);
                pb_read_string(r, len, span->name, sizeof(span->name));
                break;
            }
            case 6: { /* kind (enum/varint) */
                span->kind = (int)pb_read_varint(r);
                break;
            }
            case 7: { /* start_time_unix_nano (fixed64) */
                span->start_time = (int64_t)pb_read_fixed64(r);
                break;
            }
            case 8: { /* end_time_unix_nano (fixed64) */
                int64_t end = (int64_t)pb_read_fixed64(r);
                span->duration = end - span->start_time;
                break;
            }
            case 9: { /* attributes (repeated KeyValue) */
                PbReader attr_r = pb_sub(r);
                parse_attributes(&attr_r, &ab);
                break;
            }
            case 11: { /* events — skip for now, store raw */
                pb_skip(r, wt);
                break;
            }
            case 15: { /* status */
                PbReader status_r = pb_sub(r);
                span->status = parse_status(&status_r);
                break;
            }
            default:
                pb_skip(r, wt);
                break;
        }
    }
    span->attributes = attr_buf_finish(&ab);
    return 0;
}

/* Parse ScopeSpans */
static int parse_scope_spans(PbReader *r, sqlite3 *db, const char *service_name) {
    int span_count = 0;
    int wt;
    while (!pb_eof(r)) {
        int field = pb_read_tag(r, &wt);
        if (!field) break;
        if (field == 2 && wt == WT_LENGTH) { /* spans */
            PbReader span_r = pb_sub(r);
            OteluxSpan span = {0};
            snprintf(span.service_name, sizeof(span.service_name), "%s", service_name);
            parse_span(&span_r, &span);

            /* Upsert trace BEFORE span (FK constraint) */
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
        } else {
            pb_skip(r, wt);
        }
    }
    return span_count;
}

/* Parse ResourceSpans */
static int parse_resource_spans(PbReader *r, sqlite3 *db) {
    char service_name[128] = "unknown";
    int span_count = 0;
    int wt;

    /* First pass: find resource to get service.name */
    PbReader saved = *r;
    while (!pb_eof(r)) {
        int field = pb_read_tag(r, &wt);
        if (!field) break;
        if (field == 1 && wt == WT_LENGTH) { /* resource */
            PbReader res_r = pb_sub(r);
            parse_resource(&res_r, service_name, sizeof(service_name));
        } else {
            pb_skip(r, wt);
        }
    }

    /* Second pass: parse scope_spans with the service_name */
    *r = saved;
    while (!pb_eof(r)) {
        int field = pb_read_tag(r, &wt);
        if (!field) break;
        if (field == 2 && wt == WT_LENGTH) { /* scope_spans */
            PbReader ss_r = pb_sub(r);
            span_count += parse_scope_spans(&ss_r, db, service_name);
        } else {
            pb_skip(r, wt);
        }
    }
    return span_count;
}

/* Entry point: parse ExportTraceServiceRequest */
int otlp_proto_parse_traces(sqlite3 *db, const unsigned char *data, int len) {
    if (!data || len <= 0) return -1;

    PbReader r = { data, 0, len };
    int span_count = 0;
    int wt;

    while (!pb_eof(&r)) {
        int field = pb_read_tag(&r, &wt);
        if (!field) break;
        if (field == 1 && wt == WT_LENGTH) { /* resource_spans */
            PbReader rs_r = pb_sub(&r);
            span_count += parse_resource_spans(&rs_r, db);
        } else {
            pb_skip(&r, wt);
        }
    }

    return span_count > 0 ? span_count : -1;
}
