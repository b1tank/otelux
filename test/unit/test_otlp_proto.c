/*
 * OTelux — test/unit/test_otlp_proto.c — OTLP protobuf parser tests
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 *
 * Inspired by Aspire's TelemetryTestHelpers pattern: inline test data
 * builders instead of requiring real SDK traffic for unit tests.
 */
#include "../testlib.h"
#include "../../src/store/db.h"
#include "../../src/store/traces.h"
#include "../../src/ingest/otlp_proto.h"
#include <string.h>

/*
 * Protobuf wire-format helpers for building test payloads.
 * These let us construct valid OTLP protobuf at the byte level,
 * giving us full control over every field — similar to Aspire's
 * TelemetryTestHelpers.CreateSpan() factory pattern.
 */

typedef struct {
    unsigned char *data;
    int            len;
    int            cap;
} PbWriter;

static void pw_init(PbWriter *w) {
    w->cap = 1024;
    w->data = malloc(w->cap);
    w->len = 0;
}

static void pw_grow(PbWriter *w, int need) {
    while (w->len + need > w->cap) {
        w->cap *= 2;
        w->data = realloc(w->data, w->cap);
    }
}

static void pw_write_varint(PbWriter *w, uint64_t val) {
    pw_grow(w, 10);
    do {
        unsigned char b = val & 0x7F;
        val >>= 7;
        if (val) b |= 0x80;
        w->data[w->len++] = b;
    } while (val);
}

static void pw_write_tag(PbWriter *w, int field, int wire_type) {
    pw_write_varint(w, ((uint64_t)field << 3) | wire_type);
}

static void pw_write_bytes(PbWriter *w, int field, const void *data, int len) {
    pw_write_tag(w, field, 2); /* length-delimited */
    pw_write_varint(w, len);
    pw_grow(w, len);
    memcpy(w->data + w->len, data, len);
    w->len += len;
}

static void pw_write_string(PbWriter *w, int field, const char *s) {
    pw_write_bytes(w, field, s, (int)strlen(s));
}

static void pw_write_varint_field(PbWriter *w, int field, uint64_t val) {
    pw_write_tag(w, field, 0); /* varint */
    pw_write_varint(w, val);
}

static void pw_write_fixed64(PbWriter *w, int field, uint64_t val) {
    pw_write_tag(w, field, 1);
    pw_grow(w, 8);
    memcpy(w->data + w->len, &val, 8);
    w->len += 8;
}

static void pw_write_sub(PbWriter *w, int field, PbWriter *child) {
    pw_write_bytes(w, field, child->data, child->len);
}

static void pw_free(PbWriter *w) { free(w->data); }

/* Hex string → raw bytes (for trace_id / span_id) */
static int hex_to_bytes(const char *hex, unsigned char *out, int max_out) {
    int len = (int)strlen(hex) / 2;
    if (len > max_out) len = max_out;
    for (int i = 0; i < len; i++) {
        unsigned int b;
        sscanf(hex + i * 2, "%2x", &b);
        out[i] = (unsigned char)b;
    }
    return len;
}

/*
 * Build a minimal ExportTraceServiceRequest with one resource + one span.
 * This is equivalent to Aspire's:
 *   TelemetryTestHelpers.CreateSpan(traceId, spanId, startTime, endTime, ...)
 */
static PbWriter build_trace_request(
    const char *service_name,
    const char *trace_id_hex,    /* 32 hex chars */
    const char *span_id_hex,     /* 16 hex chars */
    const char *parent_span_hex, /* 16 hex chars or NULL */
    const char *span_name,
    int span_kind,               /* 0-4 */
    uint64_t start_nanos,
    uint64_t end_nanos,
    int status_code              /* 0=unset, 1=ok, 2=error */
) {
    unsigned char trace_id[16], span_id[8], parent_id[8];

    /* Span */
    PbWriter span;
    pw_init(&span);
    hex_to_bytes(trace_id_hex, trace_id, 16);
    pw_write_bytes(&span, 1, trace_id, 16);       /* trace_id */
    hex_to_bytes(span_id_hex, span_id, 8);
    pw_write_bytes(&span, 2, span_id, 8);         /* span_id */
    if (parent_span_hex) {
        hex_to_bytes(parent_span_hex, parent_id, 8);
        pw_write_bytes(&span, 4, parent_id, 8);   /* parent_span_id */
    }
    pw_write_string(&span, 5, span_name);          /* name */
    pw_write_varint_field(&span, 6, span_kind);    /* kind */
    pw_write_fixed64(&span, 7, start_nanos);       /* start_time_unix_nano */
    pw_write_fixed64(&span, 8, end_nanos);         /* end_time_unix_nano */

    /* Status sub-message */
    if (status_code > 0) {
        PbWriter status;
        pw_init(&status);
        pw_write_varint_field(&status, 2, status_code);
        pw_write_sub(&span, 15, &status);
        pw_free(&status);
    }

    /* KeyValue: service.name attribute */
    PbWriter svc_kv, svc_val;
    pw_init(&svc_kv);
    pw_init(&svc_val);
    pw_write_string(&svc_val, 1, service_name);  /* AnyValue.string_value */
    pw_write_string(&svc_kv, 1, "service.name"); /* key */
    pw_write_sub(&svc_kv, 2, &svc_val);          /* value */

    /* Resource */
    PbWriter resource;
    pw_init(&resource);
    pw_write_sub(&resource, 1, &svc_kv);  /* attributes[0] */

    /* ScopeSpans */
    PbWriter scope_spans;
    pw_init(&scope_spans);
    pw_write_sub(&scope_spans, 2, &span); /* spans[0] */

    /* ResourceSpans */
    PbWriter resource_spans;
    pw_init(&resource_spans);
    pw_write_sub(&resource_spans, 1, &resource);
    pw_write_sub(&resource_spans, 2, &scope_spans);

    /* ExportTraceServiceRequest */
    PbWriter request;
    pw_init(&request);
    pw_write_sub(&request, 1, &resource_spans);

    pw_free(&resource_spans);
    pw_free(&scope_spans);
    pw_free(&resource);
    pw_free(&svc_kv);
    pw_free(&svc_val);
    pw_free(&span);

    return request;
}

/*
 * Build a request with multiple spans across multiple resources.
 * Simulates a distributed trace like Aspire's TestShop.
 */
static PbWriter build_distributed_trace(void) {
    /* Two resources: frontend + backend */
    unsigned char trace_id[16] = {
        0xAA,0xBB,0xCC,0xDD,0xEE,0xFF,0x00,0x11,
        0x22,0x33,0x44,0x55,0x66,0x77,0x88,0x99
    };
    unsigned char root_span[8]  = {0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08};
    unsigned char child_span[8] = {0x0A,0x0B,0x0C,0x0D,0x0E,0x0F,0x10,0x11};

    uint64_t t0 = 1700000000000000000ULL;
    uint64_t t1 = t0 + 50000000ULL; /* 50ms */
    uint64_t t2 = t0 + 5000000ULL;  /* child starts 5ms in */
    uint64_t t3 = t0 + 40000000ULL; /* child ends 40ms in */

    /* Root span (server) in frontend */
    PbWriter root;
    pw_init(&root);
    pw_write_bytes(&root, 1, trace_id, 16);
    pw_write_bytes(&root, 2, root_span, 8);
    pw_write_string(&root, 5, "GET /api/data");
    pw_write_varint_field(&root, 6, 2); /* SERVER */
    pw_write_fixed64(&root, 7, t0);
    pw_write_fixed64(&root, 8, t1);

    /* Child span (client) in frontend, calling backend */
    PbWriter child;
    pw_init(&child);
    pw_write_bytes(&child, 1, trace_id, 16);
    pw_write_bytes(&child, 2, child_span, 8);
    pw_write_bytes(&child, 4, root_span, 8); /* parent */
    pw_write_string(&child, 5, "call backend");
    pw_write_varint_field(&child, 6, 3); /* CLIENT */
    pw_write_fixed64(&child, 7, t2);
    pw_write_fixed64(&child, 8, t3);

    /* Frontend resource */
    PbWriter fe_svc_val, fe_svc_kv, fe_resource;
    pw_init(&fe_svc_val); pw_init(&fe_svc_kv); pw_init(&fe_resource);
    pw_write_string(&fe_svc_val, 1, "frontend");
    pw_write_string(&fe_svc_kv, 1, "service.name");
    pw_write_sub(&fe_svc_kv, 2, &fe_svc_val);
    pw_write_sub(&fe_resource, 1, &fe_svc_kv);

    PbWriter fe_scope_spans;
    pw_init(&fe_scope_spans);
    pw_write_sub(&fe_scope_spans, 2, &root);
    pw_write_sub(&fe_scope_spans, 2, &child);

    PbWriter fe_rs;
    pw_init(&fe_rs);
    pw_write_sub(&fe_rs, 1, &fe_resource);
    pw_write_sub(&fe_rs, 2, &fe_scope_spans);

    /* Request */
    PbWriter request;
    pw_init(&request);
    pw_write_sub(&request, 1, &fe_rs);

    pw_free(&fe_rs); pw_free(&fe_scope_spans); pw_free(&fe_resource);
    pw_free(&fe_svc_kv); pw_free(&fe_svc_val);
    pw_free(&root); pw_free(&child);

    return request;
}

/* ---- Tests ---- */

static int test_proto_parse_single_span(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    PbWriter req = build_trace_request(
        "test-service",
        "aabbccdd11223344aabbccdd11223344", /* trace_id */
        "1122334455667788",                  /* span_id */
        NULL,                                /* no parent */
        "GET /health",
        2,  /* SERVER */
        1700000000000000000ULL,
        1700000000050000000ULL,
        1   /* OK */
    );

    int n = otlp_proto_parse_traces(db, req.data, req.len);
    ASSERT_EQ(n, 1);

    /* Verify span in store */
    OteluxSpanList *spans = store_spans_by_trace(db, "aabbccdd11223344aabbccdd11223344");
    ASSERT_NOT_NULL(spans);
    ASSERT_EQ(spans->count, 1);
    ASSERT_STR_EQ(spans->items[0].name, "GET /health");
    ASSERT_STR_EQ(spans->items[0].service_name, "test-service");
    ASSERT_EQ(spans->items[0].kind, 2); /* SERVER */
    ASSERT_EQ(spans->items[0].status, 1); /* OK */

    /* Verify duration */
    int64_t expected_dur = 50000000LL; /* 50ms in nanos */
    ASSERT_EQ(spans->items[0].duration, expected_dur);

    store_span_list_free(spans);

    /* Verify trace record */
    OteluxTraceList *traces = store_traces_list(db, NULL, NULL, -1, 100, 0);
    ASSERT_NOT_NULL(traces);
    ASSERT_EQ(traces->count, 1);
    ASSERT_STR_EQ(traces->items[0].service_name, "test-service");
    ASSERT_STR_EQ(traces->items[0].root_name, "GET /health");
    store_trace_list_free(traces);

    pw_free(&req);
    db_close(db);
    return 0;
}

static int test_proto_parse_with_parent(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    /* Root span */
    PbWriter req1 = build_trace_request(
        "api-svc", "aaaa000000000000aaaa000000000000",
        "1111111111111111", NULL, "POST /orders",
        2, 1700000000000000000ULL, 1700000000100000000ULL, 1);
    ASSERT_EQ(otlp_proto_parse_traces(db, req1.data, req1.len), 1);

    /* Child span with parent */
    PbWriter req2 = build_trace_request(
        "order-svc", "aaaa000000000000aaaa000000000000",
        "2222222222222222", "1111111111111111", "db.insert",
        3, 1700000000010000000ULL, 1700000000090000000ULL, 1);
    ASSERT_EQ(otlp_proto_parse_traces(db, req2.data, req2.len), 1);

    /* Verify both spans belong to same trace */
    OteluxSpanList *spans = store_spans_by_trace(db, "aaaa000000000000aaaa000000000000");
    ASSERT_NOT_NULL(spans);
    ASSERT_EQ(spans->count, 2);

    /* Verify parent-child relationship */
    OteluxSpan *child = NULL;
    for (int i = 0; i < spans->count; i++) {
        if (strcmp(spans->items[i].name, "db.insert") == 0) {
            child = &spans->items[i];
            break;
        }
    }
    ASSERT_NOT_NULL(child);
    ASSERT_STR_EQ(child->parent_span_id, "1111111111111111");

    /* Verify trace still has root service name (Aspire pattern: root wins) */
    OteluxTraceList *traces = store_traces_list(db, NULL, NULL, -1, 100, 0);
    ASSERT_NOT_NULL(traces);
    ASSERT_EQ(traces->count, 1);
    ASSERT_STR_EQ(traces->items[0].service_name, "api-svc");
    store_trace_list_free(traces);

    store_span_list_free(spans);
    pw_free(&req1);
    pw_free(&req2);
    db_close(db);
    return 0;
}

static int test_proto_distributed_trace(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    PbWriter req = build_distributed_trace();
    int n = otlp_proto_parse_traces(db, req.data, req.len);
    ASSERT_EQ(n, 2);

    /* Both spans same trace */
    OteluxSpanList *spans = store_spans_by_trace(db, "aabbccddeeff00112233445566778899");
    ASSERT_NOT_NULL(spans);
    ASSERT_EQ(spans->count, 2);

    /* Find root and child by checking parent_span_id */
    OteluxSpan *root_span = NULL, *child_span = NULL;
    for (int i = 0; i < spans->count; i++) {
        if (spans->items[i].parent_span_id[0] == '\0')
            root_span = &spans->items[i];
        else
            child_span = &spans->items[i];
    }
    ASSERT_NOT_NULL(root_span);
    ASSERT_NOT_NULL(child_span);

    /* Verify names */
    ASSERT_STR_EQ(root_span->name, "GET /api/data");
    ASSERT_STR_EQ(child_span->name, "call backend");

    /* Verify kinds */
    ASSERT_EQ(root_span->kind, 2); /* SERVER */
    ASSERT_EQ(child_span->kind, 3); /* CLIENT */

    /* Verify child's parent is the root */
    ASSERT_STR_EQ(child_span->parent_span_id, root_span->span_id);

    /* Verify service name on trace is root's service */
    OteluxTraceList *traces = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_EQ(traces->count, 1);
    ASSERT_STR_EQ(traces->items[0].service_name, "frontend");
    store_trace_list_free(traces);

    store_span_list_free(spans);
    pw_free(&req);
    db_close(db);
    return 0;
}

static int test_proto_error_status(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    PbWriter req = build_trace_request(
        "err-svc", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "e0e0e0e0e0e0e0e0", NULL, "failed-op",
        2, 1700000000000000000ULL, 1700000000005000000ULL,
        2); /* ERROR status */

    ASSERT_EQ(otlp_proto_parse_traces(db, req.data, req.len), 1);

    OteluxSpan *span = store_span_get(db, "e0e0e0e0e0e0e0e0");
    ASSERT_NOT_NULL(span);
    ASSERT_EQ(span->status, 2); /* ERROR */
    store_span_free(span);

    /* Trace should have has_error set */
    OteluxTraceList *traces = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_EQ(traces->count, 1);
    ASSERT_EQ(traces->items[0].has_error, 1);
    store_trace_list_free(traces);

    pw_free(&req);
    db_close(db);
    return 0;
}

static int test_proto_empty_data(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    /* Empty protobuf message — parser returns -1 for zero-length input */
    unsigned char empty = 0;
    int n = otlp_proto_parse_traces(db, &empty, 0);
    ASSERT_EQ(n, -1);

    ASSERT_EQ(store_traces_count(db), 0);

    db_close(db);
    return 0;
}

static int test_proto_truncated_data(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    /* Build a valid request then truncate it */
    PbWriter req = build_trace_request(
        "trunc-svc", "ffffffffffffffffffffffffffffffff",
        "ff00ff00ff00ff00", NULL, "truncated",
        1, 1700000000000000000ULL, 1700000000010000000ULL, 0);

    /* Feed only first 10 bytes — parser should not crash */
    int n = otlp_proto_parse_traces(db, req.data, 10);
    /* Returns -1 for incomplete data (no full span parsed), just don't crash */
    ASSERT_EQ(n, -1);

    pw_free(&req);
    db_close(db);
    return 0;
}

int main(void) {
    printf("test_otlp_proto:\n");
    RUN_TEST(test_proto_parse_single_span);
    RUN_TEST(test_proto_parse_with_parent);
    RUN_TEST(test_proto_distributed_trace);
    RUN_TEST(test_proto_error_status);
    RUN_TEST(test_proto_empty_data);
    RUN_TEST(test_proto_truncated_data);
    TEST_SUMMARY();
}
