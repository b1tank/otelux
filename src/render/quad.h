/*
 * OTelux — render/quad.h — Quad/rectangle batch renderer
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_RENDER_QUAD_H
#define OTELUX_RENDER_QUAD_H

#include "gl_core.h"

typedef struct {
    OteluxShader shader;
    GLuint       vao;
    GLuint       vbo;
} QuadRenderer;

int  quad_renderer_init(QuadRenderer *qr);
void quad_renderer_destroy(QuadRenderer *qr);
void quad_render(QuadRenderer *qr, float x, float y, float w, float h,
                 float r, float g, float b, float a, const float *projection);

#endif
