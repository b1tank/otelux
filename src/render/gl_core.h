/*
 * OTelux — render/gl_core.h — OpenGL context, shaders, projection
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_RENDER_GL_CORE_H
#define OTELUX_RENDER_GL_CORE_H

#include <glad/gl.h>

typedef struct {
    GLuint program;
    GLint  loc_projection;
    GLint  loc_color;
    GLint  loc_model;
} OteluxShader;

int  gl_core_init(void);
void gl_core_set_viewport(int width, int height);
void gl_core_get_ortho(float *mat4, float w, float h);

OteluxShader gl_shader_load(const char *vert_src, const char *frag_src);
void         gl_shader_use(const OteluxShader *s);
void         gl_shader_set_mat4(const OteluxShader *s, GLint loc, const float *mat4);
void         gl_shader_set_vec4(const OteluxShader *s, GLint loc, float r, float g, float b, float a);

#endif
