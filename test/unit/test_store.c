/*
 * OTelux — test/unit/test_store.c — SQLite store unit tests
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include "../testlib.h"
#include "../../src/store/db.h"
#include "../../src/store/traces.h"

static int test_db_open_memory(void) {
    sqlite3 *db = db_open(":memory:");
    ASSERT_NOT_NULL(db);
    ASSERT_EQ(db_migrate(db), 0);
    db_close(db);
    return 0;
}

static int test_insert_and_query_span(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    OteluxTrace trace = {0};
    snprintf(trace.trace_id, sizeof(trace.trace_id), "abc123");
    snprintf(trace.root_name, sizeof(trace.root_name), "GET /test");
    snprintf(trace.service_name, sizeof(trace.service_name), "test-svc");
    trace.start_time = 1700000000000000000LL;
    trace.duration = 45000000LL;
    trace.span_count = 1;
    ASSERT_EQ(store_trace_upsert(db, &trace), 0);

    OteluxSpan span = {0};
    snprintf(span.span_id, sizeof(span.span_id), "span1");
    snprintf(span.trace_id, sizeof(span.trace_id), "abc123");
    snprintf(span.name, sizeof(span.name), "GET /test");
    snprintf(span.service_name, sizeof(span.service_name), "test-svc");
    span.kind = 1;
    span.start_time = 1700000000000000000LL;
    span.duration = 45000000LL;
    span.status = 1;
    ASSERT_EQ(store_span_insert(db, &span), 0);

    /* Query back */
    OteluxSpanList *spans = store_spans_by_trace(db, "abc123");
    ASSERT_NOT_NULL(spans);
    ASSERT_EQ(spans->count, 1);
    ASSERT_STR_EQ(spans->items[0].name, "GET /test");
    ASSERT_EQ(spans->items[0].kind, 1);
    store_span_list_free(spans);

    db_close(db);
    return 0;
}

static int test_traces_list(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    for (int i = 0; i < 10; i++) {
        OteluxTrace trace = {0};
        snprintf(trace.trace_id, sizeof(trace.trace_id), "trace%03d", i);
        snprintf(trace.root_name, sizeof(trace.root_name), "op-%d", i);
        snprintf(trace.service_name, sizeof(trace.service_name), "svc-%d", i % 3);
        trace.start_time = 1700000000000000000LL + (int64_t)i * 1000000000LL;
        trace.duration = (int64_t)(i + 1) * 10000000LL;
        trace.span_count = i + 1;
        store_trace_upsert(db, &trace);
    }

    OteluxTraceList *list = store_traces_list(db, NULL, NULL, -1, 100, 0);
    ASSERT_NOT_NULL(list);
    ASSERT_EQ(list->count, 10);
    store_trace_list_free(list);

    /* Filter by service */
    list = store_traces_list(db, "svc-0", NULL, -1, 100, 0);
    ASSERT_NOT_NULL(list);
    ASSERT_TRUE(list->count > 0);
    for (int i = 0; i < list->count; i++) {
        ASSERT_STR_EQ(list->items[i].service_name, "svc-0");
    }
    store_trace_list_free(list);

    db_close(db);
    return 0;
}

static int test_span_get(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    /* Create trace first (FK constraint) */
    OteluxTrace trace = {0};
    snprintf(trace.trace_id, sizeof(trace.trace_id), "mytrace");
    store_trace_upsert(db, &trace);

    OteluxSpan span = {0};
    snprintf(span.span_id, sizeof(span.span_id), "myspan");
    snprintf(span.trace_id, sizeof(span.trace_id), "mytrace");
    snprintf(span.name, sizeof(span.name), "test-op");
    span.attributes = strdup("{\"key\":\"value\"}");
    store_span_insert(db, &span);
    free(span.attributes);

    OteluxSpan *got = store_span_get(db, "myspan");
    ASSERT_NOT_NULL(got);
    ASSERT_STR_EQ(got->name, "test-op");
    ASSERT_NOT_NULL(got->attributes);
    store_span_free(got);

    /* Non-existent */
    got = store_span_get(db, "nonexistent");
    ASSERT_NULL(got);

    db_close(db);
    return 0;
}

static int test_traces_count(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    ASSERT_EQ(store_traces_count(db), 0);

    OteluxTrace trace = {0};
    snprintf(trace.trace_id, sizeof(trace.trace_id), "t1");
    store_trace_upsert(db, &trace);

    ASSERT_EQ(store_traces_count(db), 1);

    db_close(db);
    return 0;
}

int main(void) {
    printf("test_store:\n");
    RUN_TEST(test_db_open_memory);
    RUN_TEST(test_insert_and_query_span);
    RUN_TEST(test_traces_list);
    RUN_TEST(test_span_get);
    RUN_TEST(test_traces_count);
    TEST_SUMMARY();
}
