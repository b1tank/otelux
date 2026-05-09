/*
 * OTelux — util/arena.c — Arena allocator
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "arena.h"
#include <stdlib.h>
#include <string.h>

Arena *arena_create(size_t capacity) {
    Arena *a = malloc(sizeof(Arena));
    if (!a) return NULL;
    a->buf = malloc(capacity);
    if (!a->buf) { free(a); return NULL; }
    a->capacity = capacity;
    a->offset = 0;
    return a;
}

void *arena_alloc(Arena *a, size_t size) {
    /* Align to 8 bytes */
    size = (size + 7) & ~(size_t)7;
    if (a->offset + size > a->capacity) return NULL;
    void *ptr = a->buf + a->offset;
    a->offset += size;
    return ptr;
}

void arena_reset(Arena *a) {
    a->offset = 0;
}

void arena_destroy(Arena *a) {
    if (!a) return;
    free(a->buf);
    free(a);
}
