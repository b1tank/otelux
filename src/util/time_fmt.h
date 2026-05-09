/*
 * OTelux — util/time_fmt.h — Timestamp formatting
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_UTIL_TIME_FMT_H
#define OTELUX_UTIL_TIME_FMT_H

#include <stdint.h>

/* Format nanosecond timestamp to "HH:MM:SS.mmm" */
void time_fmt_clock(int64_t nanos, char *buf, int buf_len);

/* Format duration in nanos to human-readable: "1.23ms", "456µs", "1.5s" */
void time_fmt_duration(int64_t nanos, char *buf, int buf_len);

/* Format nanosecond timestamp to full ISO: "2026-01-15T14:23:01.123Z" */
void time_fmt_iso(int64_t nanos, char *buf, int buf_len);

#endif
