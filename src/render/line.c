/*
 * OTelux — render/line.c — Line renderer
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "line.h"

static const char *LINE_VERT =
    "#version 330 core\n"
    "layout (location = 0) in vec2 aPos;\n"
    "uniform mat4 projection;\n"
    "void main() {\n"
    "    gl_Position = projection * vec4(aPos, 0.0, 1.0);\n"
    "}\n";

static const char *LINE_FRAG =
    "#version 330 core\n"
    "out vec4 FragColor;\n"
    "uniform vec4 color;\n"
    "void main() {\n"
    "    FragColor = color;\n"
    "}\n";

int line_renderer_init(LineRenderer *lr) {
    lr->shader = gl_shader_load(LINE_VERT, LINE_FRAG);
    if (!lr->shader.program) return -1;

    glGenVertexArrays(1, &lr->vao);
    glGenBuffers(1, &lr->vbo);

    return 0;
}

void line_renderer_destroy(LineRenderer *lr) {
    if (lr->vao) glDeleteVertexArrays(1, &lr->vao);
    if (lr->vbo) glDeleteBuffers(1, &lr->vbo);
    if (lr->shader.program) glDeleteProgram(lr->shader.program);
}

void line_render(LineRenderer *lr, const float *points, int count,
                 float r, float g, float b, float a,
                 float width, const float *projection) {
    if (count < 2) return;

    gl_shader_use(&lr->shader);
    gl_shader_set_mat4(&lr->shader, lr->shader.loc_projection, projection);
    gl_shader_set_vec4(&lr->shader, lr->shader.loc_color, r, g, b, a);

    glBindVertexArray(lr->vao);
    glBindBuffer(GL_ARRAY_BUFFER, lr->vbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(count * 2 * sizeof(float)),
                 points, GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 2 * sizeof(float), (void *)0);

    glLineWidth(width);
    glDrawArrays(GL_LINE_STRIP, 0, count);

    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glBindVertexArray(0);
}
