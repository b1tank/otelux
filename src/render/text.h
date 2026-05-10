/*
 * OTelux — render/text.h — FreeType text rendering
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_RENDER_TEXT_H
#define OTELUX_RENDER_TEXT_H

#include "gl_core.h"

typedef struct {
    GLuint texture_id;
    int    width;
    int    height;
    int    bearing_x;
    int    bearing_y;
    int    advance;
} GlyphInfo;

typedef struct {
    OteluxShader shader;
    GLuint       vao;
    GLuint       vbo;
    GlyphInfo    glyphs[128];
    int          font_size;      /* logical font size (CSS pixels) */
    int          scale_factor;   /* HiDPI scale (1 or 2) */
} TextRenderer;

int  text_renderer_init(TextRenderer *tr, const char *font_path, int font_size, int scale_factor);
void text_renderer_destroy(TextRenderer *tr);
void text_render(TextRenderer *tr, const char *text,
                 float x, float y, float scale,
                 float r, float g, float b,
                 const float *projection);
float text_width(TextRenderer *tr, const char *text, float scale);

#endif
