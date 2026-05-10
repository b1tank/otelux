/*
 * OTelux — test/integration/test_distributed_trace.c
 * Tests multi-service distributed trace ingestion and querying.
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 *
 * Inspired by Aspire's TraceTests.cs and SpanWaterfallViewModelTests.cs:
 * - Multi-resource spans in a single ExportTraceServiceRequest
 * - Parent-child relationship assertions across services
 * - Service name preserved from root span's resource
 * - Span kind and status assertions
 */
#include "../testlib.h"
#include "../../src/store/db.h"
#include "../../src/store/traces.h"
#include "../../src/ingest/otlp_json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *read_file_contents(const char *path, int *out_len) {
    FILE *f = fopen(path, "r");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)len + 1);
    *out_len = (int)fread(buf, 1, (size_t)len, f);
    buf[*out_len] = '\0';
    fclose(f);
    return buf;
}

/*
 * Ingest the 3-service distributed trace fixture and verify
 * the full span tree structure.
 */
static int test_distributed_trace_structure(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    int len;
    char *json = read_file_contents("test/fixtures/distributed_trace.json", &len);
    ASSERT_NOT_NULL(json);

    int n = otlp_json_parse_traces(db, json, len);
    /* 3 resources × (2+3+3) = 8 spans total */
    ASSERT_EQ(n, 8);
    free(json);

    /* All spans should belong to the same trace */
    const char *trace_id = "dd00dd00dd00dd00dd00dd00dd00dd00";
    OteluxSpanList *spans = store_spans_by_trace(db, trace_id);
    ASSERT_NOT_NULL(spans);
    ASSERT_EQ(spans->count, 8);

    /* Only one trace record */
    OteluxTraceList *traces = store_traces_list(db, NULL, NULL, -1, 100, 0);
    ASSERT_EQ(traces->count, 1);

    /* Trace service_name should be root span's service: "api-gateway" */
    ASSERT_STR_EQ(traces->items[0].service_name, "api-gateway");
    ASSERT_STR_EQ(traces->items[0].root_name, "POST /orders");

    store_trace_list_free(traces);
    store_span_list_free(spans);
    db_close(db);
    return 0;
}

/*
 * Verify parent-child relationships across 3 services.
 * Span tree:
 *   api-gateway: POST /orders (root, aa01)
 *     → call order-service (client, aa02)
 *       → order-service: POST /orders (server, bb01)
 *         → db.insert orders (client, bb02)
 *         → call user-service (client, bb03)
 *           → user-service: GET /users/42 (server, cc01)
 *             → cache.lookup (internal, cc02)
 *             → db.query users (client, cc03)
 */
static int test_distributed_parent_child(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    int len;
    char *json = read_file_contents("test/fixtures/distributed_trace.json", &len);
    ASSERT_NOT_NULL(json);
    otlp_json_parse_traces(db, json, len);
    free(json);

    /* Root span: no parent */
    OteluxSpan *root = store_span_get(db, "aa00000000000001");
    ASSERT_NOT_NULL(root);
    ASSERT_STR_EQ(root->name, "POST /orders");
    ASSERT_TRUE(root->parent_span_id[0] == '\0');
    ASSERT_STR_EQ(root->service_name, "api-gateway");
    ASSERT_EQ(root->kind, 2); /* SERVER */
    store_span_free(root);

    /* Gateway's client span → order-service */
    OteluxSpan *call_order = store_span_get(db, "aa00000000000002");
    ASSERT_NOT_NULL(call_order);
    ASSERT_STR_EQ(call_order->parent_span_id, "aa00000000000001");
    ASSERT_EQ(call_order->kind, 3); /* CLIENT */
    store_span_free(call_order);

    /* Order-service server span, parented to gateway client */
    OteluxSpan *order_srv = store_span_get(db, "bb00000000000001");
    ASSERT_NOT_NULL(order_srv);
    ASSERT_STR_EQ(order_srv->parent_span_id, "aa00000000000002");
    ASSERT_STR_EQ(order_srv->service_name, "order-service");
    ASSERT_EQ(order_srv->kind, 2); /* SERVER */
    store_span_free(order_srv);

    /* Order-service → user-service client call */
    OteluxSpan *call_user = store_span_get(db, "bb00000000000003");
    ASSERT_NOT_NULL(call_user);
    ASSERT_STR_EQ(call_user->parent_span_id, "bb00000000000001");
    ASSERT_EQ(call_user->kind, 3); /* CLIENT */
    store_span_free(call_user);

    /* User-service server span */
    OteluxSpan *user_srv = store_span_get(db, "cc00000000000001");
    ASSERT_NOT_NULL(user_srv);
    ASSERT_STR_EQ(user_srv->parent_span_id, "bb00000000000003");
    ASSERT_STR_EQ(user_srv->service_name, "user-service");
    store_span_free(user_srv);

    /* Cache lookup: internal span in user-service */
    OteluxSpan *cache = store_span_get(db, "cc00000000000002");
    ASSERT_NOT_NULL(cache);
    ASSERT_STR_EQ(cache->name, "cache.lookup");
    ASSERT_STR_EQ(cache->parent_span_id, "cc00000000000001");
    ASSERT_EQ(cache->kind, 0); /* INTERNAL */
    store_span_free(cache);

    db_close(db);
    return 0;
}

/*
 * Verify span durations are computed correctly across the distributed trace.
 */
static int test_distributed_durations(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    int len;
    char *json = read_file_contents("test/fixtures/distributed_trace.json", &len);
    ASSERT_NOT_NULL(json);
    otlp_json_parse_traces(db, json, len);
    free(json);

    /* Root: 100ms */
    OteluxSpan *root = store_span_get(db, "aa00000000000001");
    ASSERT_NOT_NULL(root);
    ASSERT_EQ(root->duration, 100000000LL); /* 100ms in nanos */
    store_span_free(root);

    /* Cache lookup: 1ms */
    OteluxSpan *cache = store_span_get(db, "cc00000000000002");
    ASSERT_NOT_NULL(cache);
    ASSERT_EQ(cache->duration, 1000000LL); /* 1ms */
    store_span_free(cache);

    /* DB query: 17ms */
    OteluxSpan *dbq = store_span_get(db, "cc00000000000003");
    ASSERT_NOT_NULL(dbq);
    ASSERT_EQ(dbq->duration, 17000000LL); /* 17ms */
    store_span_free(dbq);

    db_close(db);
    return 0;
}

/*
 * Filter by service: only one service's spans should be returned
 * when filtering by service_name.
 */
static int test_distributed_service_filter(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    int len;
    char *json = read_file_contents("test/fixtures/distributed_trace.json", &len);
    ASSERT_NOT_NULL(json);
    otlp_json_parse_traces(db, json, len);
    free(json);

    /* The trace should appear when filtering by "api-gateway" (root service) */
    OteluxTraceList *list = store_traces_list(db, "api-gateway", NULL, -1, 100, 0);
    ASSERT_NOT_NULL(list);
    ASSERT_EQ(list->count, 1);
    store_trace_list_free(list);

    /* The trace should NOT appear when filtering by a non-root service */
    list = store_traces_list(db, "user-service", NULL, -1, 100, 0);
    ASSERT_NOT_NULL(list);
    ASSERT_EQ(list->count, 0);
    store_trace_list_free(list);

    db_close(db);
    return 0;
}

int main(void) {
    printf("test_distributed_trace:\n");
    RUN_TEST(test_distributed_trace_structure);
    RUN_TEST(test_distributed_parent_child);
    RUN_TEST(test_distributed_durations);
    RUN_TEST(test_distributed_service_filter);
    TEST_SUMMARY();
}
