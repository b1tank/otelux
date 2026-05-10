/*
 * OTelux — render/text.c — FreeType text rendering
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "text.h"
#include <ft2build.h>
#include FT_FREETYPE_H
#include <stdio.h>
#include <string.h>

static const char *TEXT_VERT =
    "#version 330 core\n"
    "layout (location = 0) in vec4 vertex;\n"
    "out vec2 TexCoords;\n"
    "uniform mat4 projection;\n"
    "void main() {\n"
    "    gl_Position = projection * vec4(vertex.xy, 0.0, 1.0);\n"
    "    TexCoords = vertex.zw;\n"
    "}\n";

static const char *TEXT_FRAG =
    "#version 330 core\n"
    "in vec2 TexCoords;\n"
    "out vec4 FragColor;\n"
    "uniform sampler2D text;\n"
    "uniform vec4 color;\n"
    "void main() {\n"
    "    float alpha = texture(text, TexCoords).r;\n"
    "    FragColor = vec4(color.rgb, color.a * alpha);\n"
    "}\n";

int text_renderer_init(TextRenderer *tr, const char *font_path, int font_size, int scale_factor) {
    tr->font_size = font_size;
    tr->scale_factor = scale_factor > 0 ? scale_factor : 1;

    tr->shader = gl_shader_load(TEXT_VERT, TEXT_FRAG);
    if (!tr->shader.program) return -1;

    FT_Library ft;
    if (FT_Init_FreeType(&ft)) {
        fprintf(stderr, "text_renderer_init: FreeType init failed\n");
        return -1;
    }

    FT_Face face;
    if (FT_New_Face(ft, font_path, 0, &face)) {
        fprintf(stderr, "text_renderer_init: Failed to load font: %s\n", font_path);
        FT_Done_FreeType(ft);
        return -1;
    }

    /* Rasterize at physical pixel size for sharp HiDPI text */
    FT_Set_Pixel_Sizes(face, 0, (FT_UInt)(font_size * tr->scale_factor));
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

    for (unsigned char c = 0; c < 128; c++) {
        if (FT_Load_Char(face, c, FT_LOAD_RENDER)) continue;

        GLuint texture;
        glGenTextures(1, &texture);
        glBindTexture(GL_TEXTURE_2D, texture);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RED,
                     (GLsizei)face->glyph->bitmap.width,
                     (GLsizei)face->glyph->bitmap.rows,
                     0, GL_RED, GL_UNSIGNED_BYTE,
                     face->glyph->bitmap.buffer);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

        tr->glyphs[c].texture_id = texture;
        tr->glyphs[c].width = (int)face->glyph->bitmap.width;
        tr->glyphs[c].height = (int)face->glyph->bitmap.rows;
        tr->glyphs[c].bearing_x = face->glyph->bitmap_left;
        tr->glyphs[c].bearing_y = face->glyph->bitmap_top;
        tr->glyphs[c].advance = (int)(face->glyph->advance.x >> 6);
    }

    FT_Done_Face(face);
    FT_Done_FreeType(ft);

    /* Setup VAO/VBO for text quads */
    glGenVertexArrays(1, &tr->vao);
    glGenBuffers(1, &tr->vbo);
    glBindVertexArray(tr->vao);
    glBindBuffer(GL_ARRAY_BUFFER, tr->vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(float) * 6 * 4, NULL, GL_DYNAMIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 4, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void *)0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);
    glBindVertexArray(0);

    return 0;
}

void text_renderer_destroy(TextRenderer *tr) {
    for (int i = 0; i < 128; i++) {
        if (tr->glyphs[i].texture_id)
            glDeleteTextures(1, &tr->glyphs[i].texture_id);
    }
    if (tr->vao) glDeleteVertexArrays(1, &tr->vao);
    if (tr->vbo) glDeleteBuffers(1, &tr->vbo);
    if (tr->shader.program) glDeleteProgram(tr->shader.program);
}

void text_render(TextRenderer *tr, const char *text,
                 float x, float y, float scale,
                 float r, float g, float b,
                 const float *projection) {
    gl_shader_use(&tr->shader);
    gl_shader_set_mat4(&tr->shader, tr->shader.loc_projection, projection);
    gl_shader_set_vec4(&tr->shader, tr->shader.loc_color, r, g, b, 1.0f);

    glActiveTexture(GL_TEXTURE0);
    glBindVertexArray(tr->vao);

    for (const char *p = text; *p; p++) {
        unsigned char c = (unsigned char)*p;
        if (c >= 128) continue;

        GlyphInfo *g_info = &tr->glyphs[c];
        float sf = (float)tr->scale_factor;
        float xpos = x + ((float)g_info->bearing_x / sf) * scale;
        float ypos = y + ((float)(tr->font_size * tr->scale_factor - g_info->bearing_y) / sf) * scale;
        float w = ((float)g_info->width / sf) * scale;
        float h = ((float)g_info->height / sf) * scale;

        float vertices[6][4] = {
            { xpos,     ypos,     0.0f, 0.0f },
            { xpos,     ypos + h, 0.0f, 1.0f },
            { xpos + w, ypos + h, 1.0f, 1.0f },
            { xpos,     ypos,     0.0f, 0.0f },
            { xpos + w, ypos + h, 1.0f, 1.0f },
            { xpos + w, ypos,     1.0f, 0.0f },
        };

        glBindTexture(GL_TEXTURE_2D, g_info->texture_id);
        glBindBuffer(GL_ARRAY_BUFFER, tr->vbo);
        glBufferSubData(GL_ARRAY_BUFFER, 0, sizeof(vertices), vertices);
        glBindBuffer(GL_ARRAY_BUFFER, 0);
        glDrawArrays(GL_TRIANGLES, 0, 6);

        x += ((float)g_info->advance / sf) * scale;
    }

    glBindVertexArray(0);
    glBindTexture(GL_TEXTURE_2D, 0);
}

float text_width(TextRenderer *tr, const char *text, float scale) {
    float w = 0;
    float sf = (float)tr->scale_factor;
    for (const char *p = text; *p; p++) {
        unsigned char c = (unsigned char)*p;
        if (c < 128) w += ((float)tr->glyphs[c].advance / sf) * scale;
    }
    return w;
}
