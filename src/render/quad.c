/*
 * OTelux — render/quad.c — Quad/rectangle renderer
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "quad.h"
#include <string.h>

static const char *QUAD_VERT =
    "#version 330 core\n"
    "layout (location = 0) in vec2 aPos;\n"
    "uniform mat4 projection;\n"
    "uniform mat4 model;\n"
    "void main() {\n"
    "    gl_Position = projection * model * vec4(aPos, 0.0, 1.0);\n"
    "}\n";

static const char *QUAD_FRAG =
    "#version 330 core\n"
    "out vec4 FragColor;\n"
    "uniform vec4 color;\n"
    "void main() {\n"
    "    FragColor = color;\n"
    "}\n";

int quad_renderer_init(QuadRenderer *qr) {
    qr->shader = gl_shader_load(QUAD_VERT, QUAD_FRAG);
    if (!qr->shader.program) return -1;

    float vertices[] = {
        0.0f, 0.0f,
        1.0f, 0.0f,
        1.0f, 1.0f,
        0.0f, 0.0f,
        1.0f, 1.0f,
        0.0f, 1.0f,
    };

    glGenVertexArrays(1, &qr->vao);
    glGenBuffers(1, &qr->vbo);

    glBindVertexArray(qr->vao);
    glBindBuffer(GL_ARRAY_BUFFER, qr->vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * sizeof(float), (void *)0);

    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glBindVertexArray(0);

    return 0;
}

void quad_renderer_destroy(QuadRenderer *qr) {
    if (qr->vao) glDeleteVertexArrays(1, &qr->vao);
    if (qr->vbo) glDeleteBuffers(1, &qr->vbo);
    if (qr->shader.program) glDeleteProgram(qr->shader.program);
}

void quad_render(QuadRenderer *qr, float x, float y, float w, float h,
                 float r, float g, float b, float a, const float *projection) {
    gl_shader_use(&qr->shader);
    gl_shader_set_mat4(&qr->shader, qr->shader.loc_projection, projection);

    /* Build model matrix: translate + scale */
    float model[16];
    memset(model, 0, sizeof(model));
    model[0]  = w;        /* scale x */
    model[5]  = h;        /* scale y */
    model[10] = 1.0f;
    model[12] = x;        /* translate x */
    model[13] = y;        /* translate y */
    model[15] = 1.0f;

    gl_shader_set_mat4(&qr->shader, qr->shader.loc_model, model);
    gl_shader_set_vec4(&qr->shader, qr->shader.loc_color, r, g, b, a);

    glBindVertexArray(qr->vao);
    glDrawArrays(GL_TRIANGLES, 0, 6);
    glBindVertexArray(0);
}
