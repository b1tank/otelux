/*
 * OTelux — util/time_fmt.c — Timestamp formatting
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "time_fmt.h"
#include <stdio.h>
#include <time.h>

void time_fmt_clock(int64_t nanos, char *buf, int buf_len) {
    time_t secs = (time_t)(nanos / 1000000000LL);
    int ms = (int)((nanos % 1000000000LL) / 1000000LL);
    struct tm tm;
    localtime_r(&secs, &tm);
    snprintf(buf, (size_t)buf_len, "%02d:%02d:%02d.%03d",
             tm.tm_hour, tm.tm_min, tm.tm_sec, ms);
}

void time_fmt_duration(int64_t nanos, char *buf, int buf_len) {
    if (nanos < 0) nanos = -nanos;

    if (nanos < 1000LL) {
        snprintf(buf, (size_t)buf_len, "%lldns", (long long)nanos);
    } else if (nanos < 1000000LL) {
        snprintf(buf, (size_t)buf_len, "%.1f\xC2\xB5s", (double)nanos / 1000.0);
    } else if (nanos < 1000000000LL) {
        snprintf(buf, (size_t)buf_len, "%.2fms", (double)nanos / 1000000.0);
    } else {
        snprintf(buf, (size_t)buf_len, "%.2fs", (double)nanos / 1000000000.0);
    }
}

void time_fmt_iso(int64_t nanos, char *buf, int buf_len) {
    time_t secs = (time_t)(nanos / 1000000000LL);
    int ms = (int)((nanos % 1000000000LL) / 1000000LL);
    struct tm tm;
    gmtime_r(&secs, &tm);
    snprintf(buf, (size_t)buf_len, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
             tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday,
             tm.tm_hour, tm.tm_min, tm.tm_sec, ms);
}
