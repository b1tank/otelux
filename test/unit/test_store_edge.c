/*
 * OTelux — test/unit/test_store_edge.c — Store edge case tests
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 *
 * Inspired by Aspire's edge case patterns:
 * - AddTraces_SelfParent_Reject  (cycle detection)
 * - Service name preservation across upserts
 * - Zero-duration spans
 * - Duplicate span handling
 */
#include "../testlib.h"
#include "../../src/store/db.h"
#include "../../src/store/traces.h"
#include <string.h>

/* Fixed test timestamps (Aspire pattern: deterministic s_testTime) */
#define T_BASE  1700000000000000000LL  /* 2023-11-14 22:13:20 UTC */
#define T_10MS  10000000LL
#define T_50MS  50000000LL
#define T_100MS 100000000LL

static sqlite3 *setup_db(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);
    return db;
}

/*
 * Self-parent: a span whose parent_span_id == span_id.
 * Aspire rejects these to prevent infinite loops in waterfall rendering.
 * Our store should at least not crash and the span should be queryable.
 */
static int test_self_parent_span(void) {
    sqlite3 *db = setup_db();

    OteluxTrace trace = {0};
    snprintf(trace.trace_id, sizeof(trace.trace_id), "self_parent_trace");
    snprintf(trace.root_name, sizeof(trace.root_name), "self-loop");
    trace.start_time = T_BASE;
    store_trace_upsert(db, &trace);

    OteluxSpan span = {0};
    snprintf(span.span_id, sizeof(span.span_id), "DEADBEEF");
    snprintf(span.trace_id, sizeof(span.trace_id), "self_parent_trace");
    snprintf(span.parent_span_id, sizeof(span.parent_span_id), "DEADBEEF"); /* self-parent! */
    snprintf(span.name, sizeof(span.name), "self-loop-op");
    span.kind = 1;
    span.start_time = T_BASE;
    span.duration = T_50MS;
    ASSERT_EQ(store_span_insert(db, &span), 0);

    /* Should be retrievable */
    OteluxSpan *got = store_span_get(db, "DEADBEEF");
    ASSERT_NOT_NULL(got);
    ASSERT_STR_EQ(got->parent_span_id, "DEADBEEF");
    store_span_free(got);

    db_close(db);
    return 0;
}

/*
 * Service name preservation: root span's service_name should survive
 * upserts from child spans of different services.
 * (Bug we fixed: child span's service_name was overwriting root's.)
 */
static int test_service_name_upsert_from_root(void) {
    sqlite3 *db = setup_db();

    /* Root span arrives first with service_name = "api-gateway" */
    OteluxTrace t1 = {0};
    snprintf(t1.trace_id, sizeof(t1.trace_id), "svc_trace");
    snprintf(t1.root_name, sizeof(t1.root_name), "POST /orders");
    snprintf(t1.service_name, sizeof(t1.service_name), "api-gateway");
    t1.start_time = T_BASE;
    t1.duration = T_100MS;
    t1.span_count = 1;
    ASSERT_EQ(store_trace_upsert(db, &t1), 0);

    /* Child span arrives with service_name = "order-service", no root_name */
    OteluxTrace t2 = {0};
    snprintf(t2.trace_id, sizeof(t2.trace_id), "svc_trace");
    /* root_name is empty — this is a non-root span */
    snprintf(t2.service_name, sizeof(t2.service_name), "order-service");
    t2.start_time = T_BASE + T_10MS;
    t2.duration = T_50MS;
    t2.span_count = 1;
    ASSERT_EQ(store_trace_upsert(db, &t2), 0);

    /* Service name should still be "api-gateway" (root wins) */
    OteluxTraceList *list = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_NOT_NULL(list);
    ASSERT_EQ(list->count, 1);
    ASSERT_STR_EQ(list->items[0].service_name, "api-gateway");
    ASSERT_STR_EQ(list->items[0].root_name, "POST /orders");
    store_trace_list_free(list);

    db_close(db);
    return 0;
}

/*
 * Reverse: child arrives before root. Root arriving later should
 * overwrite the service_name.
 */
static int test_service_name_upsert_child_first(void) {
    sqlite3 *db = setup_db();

    /* Child span arrives first */
    OteluxTrace t1 = {0};
    snprintf(t1.trace_id, sizeof(t1.trace_id), "child_first");
    /* no root_name — it's a child */
    snprintf(t1.service_name, sizeof(t1.service_name), "backend-db");
    t1.start_time = T_BASE + T_10MS;
    t1.duration = T_50MS;
    t1.span_count = 1;
    ASSERT_EQ(store_trace_upsert(db, &t1), 0);

    /* Trace should have backend-db as service initially */
    OteluxTraceList *list = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_EQ(list->count, 1);
    ASSERT_STR_EQ(list->items[0].service_name, "backend-db");
    store_trace_list_free(list);

    /* Root arrives later */
    OteluxTrace t2 = {0};
    snprintf(t2.trace_id, sizeof(t2.trace_id), "child_first");
    snprintf(t2.root_name, sizeof(t2.root_name), "GET /api");
    snprintf(t2.service_name, sizeof(t2.service_name), "api-gateway");
    t2.start_time = T_BASE;
    t2.duration = T_100MS;
    t2.span_count = 1;
    ASSERT_EQ(store_trace_upsert(db, &t2), 0);

    /* Root's service name should win now */
    list = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_EQ(list->count, 1);
    ASSERT_STR_EQ(list->items[0].service_name, "api-gateway");
    ASSERT_STR_EQ(list->items[0].root_name, "GET /api");
    store_trace_list_free(list);

    db_close(db);
    return 0;
}

/*
 * Zero-duration span: start_time == end_time.
 * Should be stored and queryable (Aspire tests this explicitly).
 */
static int test_zero_duration_span(void) {
    sqlite3 *db = setup_db();

    OteluxTrace trace = {0};
    snprintf(trace.trace_id, sizeof(trace.trace_id), "zero_dur");
    snprintf(trace.root_name, sizeof(trace.root_name), "instant-op");
    trace.start_time = T_BASE;
    trace.duration = 0;
    store_trace_upsert(db, &trace);

    OteluxSpan span = {0};
    snprintf(span.span_id, sizeof(span.span_id), "zero_span");
    snprintf(span.trace_id, sizeof(span.trace_id), "zero_dur");
    snprintf(span.name, sizeof(span.name), "instant-op");
    span.start_time = T_BASE;
    span.duration = 0;
    span.kind = 0; /* INTERNAL */
    ASSERT_EQ(store_span_insert(db, &span), 0);

    OteluxSpan *got = store_span_get(db, "zero_span");
    ASSERT_NOT_NULL(got);
    ASSERT_EQ(got->duration, 0);
    store_span_free(got);

    db_close(db);
    return 0;
}

/*
 * Duplicate span insert (same span_id). Should succeed
 * because we use INSERT OR REPLACE.
 */
static int test_duplicate_span_replace(void) {
    sqlite3 *db = setup_db();

    OteluxTrace trace = {0};
    snprintf(trace.trace_id, sizeof(trace.trace_id), "dup_trace");
    store_trace_upsert(db, &trace);

    OteluxSpan span = {0};
    snprintf(span.span_id, sizeof(span.span_id), "dup_span");
    snprintf(span.trace_id, sizeof(span.trace_id), "dup_trace");
    snprintf(span.name, sizeof(span.name), "original-name");
    span.start_time = T_BASE;
    span.duration = T_10MS;
    ASSERT_EQ(store_span_insert(db, &span), 0);

    /* Re-insert same span_id with different name */
    snprintf(span.name, sizeof(span.name), "updated-name");
    ASSERT_EQ(store_span_insert(db, &span), 0);

    /* Should have only 1 span, with updated name */
    OteluxSpanList *spans = store_spans_by_trace(db, "dup_trace");
    ASSERT_NOT_NULL(spans);
    ASSERT_EQ(spans->count, 1);
    ASSERT_STR_EQ(spans->items[0].name, "updated-name");
    store_span_list_free(spans);

    db_close(db);
    return 0;
}

/*
 * has_error propagation: error in any span should set has_error on trace.
 */
static int test_error_propagation(void) {
    sqlite3 *db = setup_db();

    /* Insert OK trace */
    OteluxTrace t = {0};
    snprintf(t.trace_id, sizeof(t.trace_id), "err_trace");
    snprintf(t.root_name, sizeof(t.root_name), "GET /ok");
    snprintf(t.service_name, sizeof(t.service_name), "svc");
    t.start_time = T_BASE;
    t.has_error = 0;
    ASSERT_EQ(store_trace_upsert(db, &t), 0);

    /* Verify no error */
    OteluxTraceList *list = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_EQ(list->items[0].has_error, 0);
    store_trace_list_free(list);

    /* Upsert child with error */
    OteluxTrace t2 = {0};
    snprintf(t2.trace_id, sizeof(t2.trace_id), "err_trace");
    t2.start_time = T_BASE + T_10MS;
    t2.has_error = 1;
    ASSERT_EQ(store_trace_upsert(db, &t2), 0);

    /* Error should propagate */
    list = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_EQ(list->items[0].has_error, 1);
    store_trace_list_free(list);

    db_close(db);
    return 0;
}

/*
 * start_time should always use MIN (earliest span wins).
 */
static int test_start_time_min(void) {
    sqlite3 *db = setup_db();

    /* Insert span with later start_time first */
    OteluxTrace t1 = {0};
    snprintf(t1.trace_id, sizeof(t1.trace_id), "time_trace");
    t1.start_time = T_BASE + T_100MS;
    ASSERT_EQ(store_trace_upsert(db, &t1), 0);

    /* Insert span with earlier start_time */
    OteluxTrace t2 = {0};
    snprintf(t2.trace_id, sizeof(t2.trace_id), "time_trace");
    t2.start_time = T_BASE;
    ASSERT_EQ(store_trace_upsert(db, &t2), 0);

    /* Trace start should be the earlier one */
    OteluxTraceList *list = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_EQ(list->count, 1);
    ASSERT_EQ(list->items[0].start_time, T_BASE);
    store_trace_list_free(list);

    db_close(db);
    return 0;
}

/*
 * span_count should increment on each upsert.
 */
static int test_span_count_increment(void) {
    sqlite3 *db = setup_db();

    OteluxTrace t = {0};
    snprintf(t.trace_id, sizeof(t.trace_id), "count_trace");
    t.span_count = 1;
    ASSERT_EQ(store_trace_upsert(db, &t), 0);

    /* Upsert 4 more times (simulate 4 more spans) */
    for (int i = 0; i < 4; i++) {
        t.span_count = 1;
        ASSERT_EQ(store_trace_upsert(db, &t), 0);
    }

    OteluxTraceList *list = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_EQ(list->count, 1);
    /* Initial insert = 1, then 4 upserts each adding 1 = 5 total */
    ASSERT_EQ(list->items[0].span_count, 5);
    store_trace_list_free(list);

    db_close(db);
    return 0;
}

int main(void) {
    printf("test_store_edge:\n");
    RUN_TEST(test_self_parent_span);
    RUN_TEST(test_service_name_upsert_from_root);
    RUN_TEST(test_service_name_upsert_child_first);
    RUN_TEST(test_zero_duration_span);
    RUN_TEST(test_duplicate_span_replace);
    RUN_TEST(test_error_propagation);
    RUN_TEST(test_start_time_min);
    RUN_TEST(test_span_count_increment);
    TEST_SUMMARY();
}
