/*
 * OTelux — test/unit/test_color.c
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "../testlib.h"
#include "../../src/util/color.h"

static int test_color_hex(void) {
    OteluxColor c = color_hex("#FF8040");
    ASSERT_FLOAT_EQ(c.r, 1.0f, 0.01f);
    ASSERT_FLOAT_EQ(c.g, 0.502f, 0.01f);
    ASSERT_FLOAT_EQ(c.b, 0.251f, 0.01f);
    ASSERT_FLOAT_EQ(c.a, 1.0f, 0.01f);
    return 0;
}

static int test_color_hex_no_hash(void) {
    OteluxColor c = color_hex("00FF00");
    ASSERT_FLOAT_EQ(c.r, 0.0f, 0.01f);
    ASSERT_FLOAT_EQ(c.g, 1.0f, 0.01f);
    ASSERT_FLOAT_EQ(c.b, 0.0f, 0.01f);
    return 0;
}

static int test_span_kind_colors(void) {
    OteluxColor server = color_for_span_kind(1);
    OteluxColor client = color_for_span_kind(2);
    /* Should be different colors */
    ASSERT_TRUE(server.r != client.r || server.g != client.g || server.b != client.b);
    return 0;
}

static int test_service_color_deterministic(void) {
    OteluxColor c1 = color_for_service("my-service");
    OteluxColor c2 = color_for_service("my-service");
    ASSERT_FLOAT_EQ(c1.r, c2.r, 0.001f);
    ASSERT_FLOAT_EQ(c1.g, c2.g, 0.001f);
    ASSERT_FLOAT_EQ(c1.b, c2.b, 0.001f);
    return 0;
}

static int test_service_color_null(void) {
    OteluxColor c = color_for_service(NULL);
    ASSERT_TRUE(c.a > 0);
    return 0;
}

int main(void) {
    printf("test_color:\n");
    RUN_TEST(test_color_hex);
    RUN_TEST(test_color_hex_no_hash);
    RUN_TEST(test_span_kind_colors);
    RUN_TEST(test_service_color_deterministic);
    RUN_TEST(test_service_color_null);
    TEST_SUMMARY();
}
