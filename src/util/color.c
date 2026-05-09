/*
 * OTelux — util/color.c — Color palette and theme
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "color.h"
#include <string.h>
#include <stdlib.h>

/* Dark theme colors */
const OteluxColor COLOR_BG        = {0.12f, 0.12f, 0.14f, 1.0f};
const OteluxColor COLOR_BG_ALT    = {0.16f, 0.16f, 0.18f, 1.0f};
const OteluxColor COLOR_FG        = {0.90f, 0.90f, 0.92f, 1.0f};
const OteluxColor COLOR_FG_DIM    = {0.55f, 0.55f, 0.58f, 1.0f};
const OteluxColor COLOR_ACCENT    = {0.30f, 0.56f, 0.92f, 1.0f};
const OteluxColor COLOR_ERROR     = {0.90f, 0.30f, 0.30f, 1.0f};
const OteluxColor COLOR_WARNING   = {0.92f, 0.72f, 0.20f, 1.0f};
const OteluxColor COLOR_SUCCESS   = {0.30f, 0.80f, 0.40f, 1.0f};
const OteluxColor COLOR_INFO      = {0.30f, 0.56f, 0.92f, 1.0f};

const OteluxColor COLOR_SPAN_SERVER   = {0.30f, 0.65f, 0.90f, 1.0f};
const OteluxColor COLOR_SPAN_CLIENT   = {0.55f, 0.80f, 0.35f, 1.0f};
const OteluxColor COLOR_SPAN_INTERNAL = {0.60f, 0.55f, 0.80f, 1.0f};
const OteluxColor COLOR_SPAN_PRODUCER = {0.90f, 0.60f, 0.30f, 1.0f};
const OteluxColor COLOR_SPAN_CONSUMER = {0.80f, 0.40f, 0.70f, 1.0f};

OteluxColor color_for_span_kind(int kind) {
    switch (kind) {
        case 1: return COLOR_SPAN_SERVER;
        case 2: return COLOR_SPAN_CLIENT;
        case 3: return COLOR_SPAN_PRODUCER;
        case 4: return COLOR_SPAN_CONSUMER;
        default: return COLOR_SPAN_INTERNAL;
    }
}

/* Simple hash-based color for service names */
OteluxColor color_for_service(const char *name) {
    if (!name || !name[0]) return COLOR_SPAN_INTERNAL;

    unsigned int hash = 5381;
    for (const char *p = name; *p; p++) {
        hash = ((hash << 5) + hash) + (unsigned char)*p;
    }

    /* Predefined palette for consistent, visually distinct service colors */
    static const OteluxColor palette[] = {
        {0.30f, 0.65f, 0.90f, 1.0f},
        {0.55f, 0.80f, 0.35f, 1.0f},
        {0.90f, 0.60f, 0.30f, 1.0f},
        {0.80f, 0.40f, 0.70f, 1.0f},
        {0.40f, 0.75f, 0.70f, 1.0f},
        {0.85f, 0.50f, 0.50f, 1.0f},
        {0.60f, 0.55f, 0.80f, 1.0f},
        {0.70f, 0.75f, 0.30f, 1.0f},
    };
    int idx = (int)(hash % (sizeof(palette) / sizeof(palette[0])));
    return palette[idx];
}

OteluxColor color_hex(const char *hex) {
    OteluxColor c = {0, 0, 0, 1.0f};
    if (!hex) return c;
    if (hex[0] == '#') hex++;
    if (strlen(hex) < 6) return c;

    char tmp[3] = {0};
    tmp[0] = hex[0]; tmp[1] = hex[1];
    c.r = (float)strtol(tmp, NULL, 16) / 255.0f;
    tmp[0] = hex[2]; tmp[1] = hex[3];
    c.g = (float)strtol(tmp, NULL, 16) / 255.0f;
    tmp[0] = hex[4]; tmp[1] = hex[5];
    c.b = (float)strtol(tmp, NULL, 16) / 255.0f;
    return c;
}
