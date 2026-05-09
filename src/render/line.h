/*
 * OTelux — render/line.h — Line renderer
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_RENDER_LINE_H
#define OTELUX_RENDER_LINE_H

#include "gl_core.h"

typedef struct {
    OteluxShader shader;
    GLuint       vao;
    GLuint       vbo;
} LineRenderer;

int  line_renderer_init(LineRenderer *lr);
void line_renderer_destroy(LineRenderer *lr);
void line_render(LineRenderer *lr, const float *points, int count,
                 float r, float g, float b, float a,
                 float width, const float *projection);

#endif
