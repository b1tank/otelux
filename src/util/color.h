/*
 * OTelux — util/color.h — Color palette and theme
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_UTIL_COLOR_H
#define OTELUX_UTIL_COLOR_H

typedef struct {
    float r, g, b, a;
} OteluxColor;

/* Theme colors */
extern const OteluxColor COLOR_BG;
extern const OteluxColor COLOR_BG_ALT;
extern const OteluxColor COLOR_FG;
extern const OteluxColor COLOR_FG_DIM;
extern const OteluxColor COLOR_ACCENT;
extern const OteluxColor COLOR_ERROR;
extern const OteluxColor COLOR_WARNING;
extern const OteluxColor COLOR_SUCCESS;
extern const OteluxColor COLOR_INFO;

/* Span kind colors */
extern const OteluxColor COLOR_SPAN_SERVER;
extern const OteluxColor COLOR_SPAN_CLIENT;
extern const OteluxColor COLOR_SPAN_INTERNAL;
extern const OteluxColor COLOR_SPAN_PRODUCER;
extern const OteluxColor COLOR_SPAN_CONSUMER;

OteluxColor color_for_span_kind(int kind);
OteluxColor color_for_service(const char *name);
OteluxColor color_hex(const char *hex);

#endif
