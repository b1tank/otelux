/*
 * OTelux — test/integration/test_ingest_store.c
 * Tests the full HTTP ingest → SQLite store pipeline
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
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

static int test_ingest_and_query_traces(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    /* Ingest sample trace */
    int len;
    char *json = read_file_contents("test/fixtures/sample_trace.json", &len);
    ASSERT_NOT_NULL(json);
    ASSERT_TRUE(otlp_json_parse_traces(db, json, len) > 0);
    free(json);

    /* Ingest error trace */
    json = read_file_contents("test/fixtures/sample_trace_error.json", &len);
    ASSERT_NOT_NULL(json);
    ASSERT_TRUE(otlp_json_parse_traces(db, json, len) > 0);
    free(json);

    /* Query all traces */
    OteluxTraceList *traces = store_traces_list(db, NULL, NULL, -1, 100, 0);
    ASSERT_NOT_NULL(traces);
    ASSERT_TRUE(traces->count >= 2);

    /* Query with search filter */
    OteluxTraceList *filtered = store_traces_list(db, NULL, "GET", -1, 100, 0);
    ASSERT_NOT_NULL(filtered);
    ASSERT_TRUE(filtered->count >= 1);

    store_trace_list_free(traces);
    store_trace_list_free(filtered);
    db_close(db);
    return 0;
}

static int test_pagination(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    /* Insert 20 traces */
    for (int i = 0; i < 20; i++) {
        OteluxTrace t = {0};
        snprintf(t.trace_id, sizeof(t.trace_id), "paginate_%03d", i);
        snprintf(t.root_name, sizeof(t.root_name), "op-%d", i);
        t.start_time = 1700000000000000000LL + (int64_t)i * 1000000000LL;
        store_trace_upsert(db, &t);
    }

    /* Page 1: first 10 */
    OteluxTraceList *page1 = store_traces_list(db, NULL, NULL, -1, 10, 0);
    ASSERT_NOT_NULL(page1);
    ASSERT_EQ(page1->count, 10);

    /* Page 2: next 10 */
    OteluxTraceList *page2 = store_traces_list(db, NULL, NULL, -1, 10, 10);
    ASSERT_NOT_NULL(page2);
    ASSERT_EQ(page2->count, 10);

    /* Pages should be different */
    ASSERT_TRUE(strcmp(page1->items[0].trace_id, page2->items[0].trace_id) != 0);

    store_trace_list_free(page1);
    store_trace_list_free(page2);
    db_close(db);
    return 0;
}

int main(void) {
    printf("test_ingest_store:\n");
    RUN_TEST(test_ingest_and_query_traces);
    RUN_TEST(test_pagination);
    TEST_SUMMARY();
}
