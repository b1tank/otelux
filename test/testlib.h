/*
 * OTelux — Linux-Native OpenTelemetry Viewer
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_TESTLIB_H
#define OTELUX_TESTLIB_H

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

static int _test_pass = 0;
static int _test_fail = 0;

#define ASSERT_EQ(a, b) do { \
    long long _a = (long long)(a); \
    long long _b = (long long)(b); \
    if (_a != _b) { \
        fprintf(stderr, "  FAIL %s:%d: %s == %lld, expected %lld\n", \
                __FILE__, __LINE__, #a, _a, _b); \
        return 1; \
    } \
} while(0)

#define ASSERT_NEQ(a, b) do { \
    if ((a) == (b)) { \
        fprintf(stderr, "  FAIL %s:%d: %s should != %s\n", \
                __FILE__, __LINE__, #a, #b); \
        return 1; \
    } \
} while(0)

#define ASSERT_STR_EQ(a, b) do { \
    const char *_a = (a); \
    const char *_b = (b); \
    if (_a == NULL || _b == NULL || strcmp(_a, _b) != 0) { \
        fprintf(stderr, "  FAIL %s:%d: \"%s\" != \"%s\"\n", \
                __FILE__, __LINE__, _a ? _a : "(null)", _b ? _b : "(null)"); \
        return 1; \
    } \
} while(0)

#define ASSERT_TRUE(x) do { \
    if (!(x)) { \
        fprintf(stderr, "  FAIL %s:%d: %s is false\n", \
                __FILE__, __LINE__, #x); \
        return 1; \
    } \
} while(0)

#define ASSERT_FALSE(x) do { \
    if ((x)) { \
        fprintf(stderr, "  FAIL %s:%d: %s is true\n", \
                __FILE__, __LINE__, #x); \
        return 1; \
    } \
} while(0)

#define ASSERT_NULL(x) do { \
    if ((x) != NULL) { \
        fprintf(stderr, "  FAIL %s:%d: %s is not NULL\n", \
                __FILE__, __LINE__, #x); \
        return 1; \
    } \
} while(0)

#define ASSERT_NOT_NULL(x) do { \
    if ((x) == NULL) { \
        fprintf(stderr, "  FAIL %s:%d: %s is NULL\n", \
                __FILE__, __LINE__, #x); \
        return 1; \
    } \
} while(0)

#define ASSERT_FLOAT_EQ(a, b, eps) do { \
    double _a = (double)(a); \
    double _b = (double)(b); \
    if (fabs(_a - _b) > (eps)) { \
        fprintf(stderr, "  FAIL %s:%d: %s == %f, expected %f (eps=%f)\n", \
                __FILE__, __LINE__, #a, _a, _b, (double)(eps)); \
        return 1; \
    } \
} while(0)

#define RUN_TEST(fn) do { \
    printf("  %-50s", #fn); \
    fflush(stdout); \
    if (fn() == 0) { printf("PASS\n"); _test_pass++; } \
    else { printf("FAIL\n"); _test_fail++; } \
} while(0)

#define TEST_SUMMARY() do { \
    printf("\n  %d passed, %d failed, %d total\n", \
           _test_pass, _test_fail, _test_pass + _test_fail); \
    return _test_fail > 0 ? 1 : 0; \
} while(0)

#endif /* OTELUX_TESTLIB_H */
