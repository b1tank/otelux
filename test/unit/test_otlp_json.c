/*
 * OTelux — test/unit/test_otlp_json.c — OTLP JSON parsing tests
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "../testlib.h"
#include "../../src/store/db.h"
#include "../../src/store/traces.h"
#include "../../src/ingest/otlp_json.h"
#include <stdio.h>
#include <stdlib.h>

/* Helper: read file into malloc'd buffer */
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

static int test_parse_sample_trace(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    int len;
    char *json = read_file_contents("test/fixtures/sample_trace.json", &len);
    ASSERT_NOT_NULL(json);

    int n = otlp_json_parse_traces(db, json, len);
    ASSERT_EQ(n, 3);  /* 3 spans in fixture */

    /* Verify spans stored */
    OteluxSpanList *spans = store_spans_by_trace(db, "abcdef1234567890abcdef1234567890");
    ASSERT_NOT_NULL(spans);
    ASSERT_EQ(spans->count, 3);

    /* Verify first span */
    ASSERT_STR_EQ(spans->items[0].name, "GET /api/users");
    ASSERT_EQ(spans->items[0].kind, 1); /* server */
    ASSERT_EQ(spans->items[0].status, 1); /* ok */

    /* Verify attributes parsed */
    ASSERT_NOT_NULL(spans->items[0].attributes);

    store_span_list_free(spans);
    free(json);
    db_close(db);
    return 0;
}

static int test_parse_error_trace(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    int len;
    char *json = read_file_contents("test/fixtures/sample_trace_error.json", &len);
    ASSERT_NOT_NULL(json);

    int n = otlp_json_parse_traces(db, json, len);
    ASSERT_EQ(n, 2);

    /* Check error span */
    OteluxSpan *span = store_span_get(db, "e000000000000002");
    ASSERT_NOT_NULL(span);
    ASSERT_EQ(span->status, 2); /* error */
    ASSERT_NOT_NULL(span->events); /* has exception event */

    store_span_free(span);
    free(json);
    db_close(db);
    return 0;
}

static int test_parse_malformed(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    int n = otlp_json_parse_traces(db, "{{broken", 8);
    ASSERT_EQ(n, -1);

    db_close(db);
    return 0;
}

static int test_parse_empty(void) {
    sqlite3 *db = db_open(":memory:");
    db_migrate(db);

    int len;
    char *json = read_file_contents("test/fixtures/empty_trace.json", &len);
    ASSERT_NOT_NULL(json);

    int n = otlp_json_parse_traces(db, json, len);
    ASSERT_EQ(n, 0);  /* no spans */

    ASSERT_EQ(store_traces_count(db), 0);

    free(json);
    db_close(db);
    return 0;
}

int main(void) {
    printf("test_otlp_json:\n");
    RUN_TEST(test_parse_sample_trace);
    RUN_TEST(test_parse_error_trace);
    RUN_TEST(test_parse_malformed);
    RUN_TEST(test_parse_empty);
    TEST_SUMMARY();
}
