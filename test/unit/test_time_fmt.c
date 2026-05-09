/*
 * OTelux — test/unit/test_time_fmt.c
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "../testlib.h"
#include "../../src/util/time_fmt.h"

static int test_duration_nanos(void) {
    char buf[64];
    time_fmt_duration(500, buf, sizeof(buf));
    ASSERT_STR_EQ(buf, "500ns");
    return 0;
}

static int test_duration_micros(void) {
    char buf[64];
    time_fmt_duration(1500, buf, sizeof(buf));
    /* Should show as 1.5µs */
    ASSERT_TRUE(buf[0] == '1');
    return 0;
}

static int test_duration_millis(void) {
    char buf[64];
    time_fmt_duration(45000000LL, buf, sizeof(buf));
    ASSERT_STR_EQ(buf, "45.00ms");
    return 0;
}

static int test_duration_seconds(void) {
    char buf[64];
    time_fmt_duration(2500000000LL, buf, sizeof(buf));
    ASSERT_STR_EQ(buf, "2.50s");
    return 0;
}

static int test_clock_format(void) {
    char buf[64];
    /* 2023-11-14 00:00:00.000 UTC = 1700000000 seconds */
    int64_t nanos = 1700000000000000000LL;
    time_fmt_clock(nanos, buf, sizeof(buf));
    /* Just verify format: HH:MM:SS.mmm */
    ASSERT_EQ(buf[2], ':');
    ASSERT_EQ(buf[5], ':');
    ASSERT_EQ(buf[8], '.');
    return 0;
}

static int test_iso_format(void) {
    char buf[64];
    int64_t nanos = 1700000000123000000LL;
    time_fmt_iso(nanos, buf, sizeof(buf));
    /* Should contain T and Z */
    ASSERT_TRUE(strchr(buf, 'T') != NULL);
    ASSERT_TRUE(strchr(buf, 'Z') != NULL);
    /* Should contain .123 */
    ASSERT_TRUE(strstr(buf, ".123") != NULL);
    return 0;
}

int main(void) {
    printf("test_time_fmt:\n");
    RUN_TEST(test_duration_nanos);
    RUN_TEST(test_duration_micros);
    RUN_TEST(test_duration_millis);
    RUN_TEST(test_duration_seconds);
    RUN_TEST(test_clock_format);
    RUN_TEST(test_iso_format);
    TEST_SUMMARY();
}
