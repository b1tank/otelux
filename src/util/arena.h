/*
 * OTelux — util/arena.h — Arena allocator for per-frame allocations
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_UTIL_ARENA_H
#define OTELUX_UTIL_ARENA_H

#include <stddef.h>

typedef struct {
    char  *buf;
    size_t capacity;
    size_t offset;
} Arena;

Arena *arena_create(size_t capacity);
void  *arena_alloc(Arena *a, size_t size);
void   arena_reset(Arena *a);
void   arena_destroy(Arena *a);

#endif
