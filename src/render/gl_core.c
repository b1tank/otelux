/*
 * OTelux — render/gl_core.c — OpenGL init, shaders, projection
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "gl_core.h"
#include <stdio.h>
#include <string.h>
#include <dlfcn.h>

static GLADapiproc glad_gl_loader(const char *name) {
    static void *libgl = NULL;
    if (!libgl) libgl = dlopen("libGL.so.1", RTLD_LAZY | RTLD_LOCAL);
    if (!libgl) return NULL;
    void *sym = dlsym(libgl, name);
    GLADapiproc fn;
    memcpy(&fn, &sym, sizeof(fn));
    return fn;
}

int gl_core_init(void) {
    int version = gladLoadGL(glad_gl_loader);
    if (!version) {
        fprintf(stderr, "gl_core_init: Failed to initialize GLAD\n");
        return -1;
    }
    printf("OpenGL %d.%d loaded\n", GLAD_VERSION_MAJOR(version),
           GLAD_VERSION_MINOR(version));

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    return 0;
}

void gl_core_set_viewport(int width, int height) {
    glViewport(0, 0, width, height);
}

/* Orthographic projection matrix (column-major for OpenGL) */
void gl_core_get_ortho(float *m, float w, float h) {
    memset(m, 0, 16 * sizeof(float));
    m[0]  =  2.0f / w;
    m[5]  = -2.0f / h;  /* flip Y: top-left = (0,0) */
    m[10] = -1.0f;
    m[12] = -1.0f;
    m[13] =  1.0f;
    m[14] =  0.0f;
    m[15] =  1.0f;
}

static GLuint compile_shader(GLenum type, const char *src) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &src, NULL);
    glCompileShader(shader);

    GLint success;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
    if (!success) {
        char log[512];
        glGetShaderInfoLog(shader, sizeof(log), NULL, log);
        fprintf(stderr, "Shader compile error: %s\n", log);
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

OteluxShader gl_shader_load(const char *vert_src, const char *frag_src) {
    OteluxShader s = {0};

    GLuint vert = compile_shader(GL_VERTEX_SHADER, vert_src);
    GLuint frag = compile_shader(GL_FRAGMENT_SHADER, frag_src);
    if (!vert || !frag) return s;

    s.program = glCreateProgram();
    glAttachShader(s.program, vert);
    glAttachShader(s.program, frag);
    glLinkProgram(s.program);

    GLint success;
    glGetProgramiv(s.program, GL_LINK_STATUS, &success);
    if (!success) {
        char log[512];
        glGetProgramInfoLog(s.program, sizeof(log), NULL, log);
        fprintf(stderr, "Shader link error: %s\n", log);
        s.program = 0;
    }

    glDeleteShader(vert);
    glDeleteShader(frag);

    s.loc_projection = glGetUniformLocation(s.program, "projection");
    s.loc_color = glGetUniformLocation(s.program, "color");
    s.loc_model = glGetUniformLocation(s.program, "model");

    return s;
}

void gl_shader_use(const OteluxShader *s) {
    glUseProgram(s->program);
}

void gl_shader_set_mat4(const OteluxShader *s, GLint loc, const float *mat4) {
    (void)s;
    glUniformMatrix4fv(loc, 1, GL_FALSE, mat4);
}

void gl_shader_set_vec4(const OteluxShader *s, GLint loc,
                        float r, float g, float b, float a) {
    (void)s;
    glUniform4f(loc, r, g, b, a);
}
