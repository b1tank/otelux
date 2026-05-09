/*
 * OTelux — test/unit/test_arena.c
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "../testlib.h"
#include "../../src/util/arena.h"

static int test_create_destroy(void) {
    Arena *a = arena_create(4096);
    ASSERT_NOT_NULL(a);
    arena_destroy(a);
    return 0;
}

static int test_alloc_basic(void) {
    Arena *a = arena_create(1024);
    void *p = arena_alloc(a, 64);
    ASSERT_NOT_NULL(p);
    arena_destroy(a);
    return 0;
}

static int test_alloc_overflow(void) {
    Arena *a = arena_create(64);
    void *p1 = arena_alloc(a, 32);
    ASSERT_NOT_NULL(p1);
    void *p2 = arena_alloc(a, 32);
    ASSERT_NOT_NULL(p2);
    void *p3 = arena_alloc(a, 32);
    ASSERT_NULL(p3);  /* should fail — arena exhausted */
    arena_destroy(a);
    return 0;
}

static int test_reset(void) {
    Arena *a = arena_create(64);
    arena_alloc(a, 32);
    arena_alloc(a, 32);
    ASSERT_NULL(arena_alloc(a, 1));  /* full */
    arena_reset(a);
    ASSERT_NOT_NULL(arena_alloc(a, 32));  /* works again after reset */
    arena_destroy(a);
    return 0;
}

static int test_alignment(void) {
    Arena *a = arena_create(4096);
    void *p1 = arena_alloc(a, 1);
    void *p2 = arena_alloc(a, 1);
    /* Both should be 8-byte aligned */
    ASSERT_EQ((size_t)p1 % 8, 0);
    ASSERT_EQ((size_t)p2 % 8, 0);
    /* p2 should be 8 bytes after p1 (aligned up from 1 byte) */
    ASSERT_EQ((char *)p2 - (char *)p1, 8);
    arena_destroy(a);
    return 0;
}

int main(void) {
    printf("test_arena:\n");
    RUN_TEST(test_create_destroy);
    RUN_TEST(test_alloc_basic);
    RUN_TEST(test_alloc_overflow);
    RUN_TEST(test_reset);
    RUN_TEST(test_alignment);
    TEST_SUMMARY();
}
