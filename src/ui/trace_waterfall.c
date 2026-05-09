/*
 * OTelux — ui/trace_waterfall.c — Span waterfall view (GtkGLArea)
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "trace_waterfall.h"
#include "../render/gl_core.h"
#include "../render/quad.h"
#include "../render/text.h"
#include "../render/line.h"
#include "../store/traces.h"
#include "../util/color.h"
#include "../util/time_fmt.h"

#include <stdio.h>
#include <string.h>

typedef struct {
    OteluxApp    *app;
    QuadRenderer  quad;
    TextRenderer  text;
    LineRenderer  line;
    int           gl_initialized;
    int           row_height;
} WaterfallState;

/* Compute depth of each span via parent lookup */
static int compute_depth(const OteluxSpanList *spans, int idx) {
    int depth = 0;
    const char *parent = spans->items[idx].parent_span_id;
    while (parent[0] && depth < 20) {
        int found = 0;
        for (int i = 0; i < spans->count; i++) {
            if (strcmp(spans->items[i].span_id, parent) == 0) {
                parent = spans->items[i].parent_span_id;
                depth++;
                found = 1;
                break;
            }
        }
        if (!found) break;
    }
    return depth;
}

static void on_realize(GtkGLArea *area, gpointer user_data) {
    (void)user_data;
    gtk_gl_area_make_current(area);
}

static gboolean on_render(GtkGLArea *area, GdkGLContext *ctx, gpointer user_data) {
    (void)ctx;
    WaterfallState *state = (WaterfallState *)user_data;

    if (!state->gl_initialized) {
        gl_core_init();
        quad_renderer_init(&state->quad);
        line_renderer_init(&state->line);

        const char *fonts[] = {
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
            "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
            NULL
        };
        const char *font = fonts[0];
        for (int i = 0; fonts[i]; i++) {
            FILE *f = fopen(fonts[i], "r");
            if (f) { fclose(f); font = fonts[i]; break; }
        }
        text_renderer_init(&state->text, font, 13);
        state->gl_initialized = 1;
        state->row_height = 30;
    }

    int width = gtk_widget_get_width(GTK_WIDGET(area));
    int height = gtk_widget_get_height(GTK_WIDGET(area));
    int scale = gtk_widget_get_scale_factor(GTK_WIDGET(area));
    gl_core_set_viewport(width * scale, height * scale);

    float projection[16];
    gl_core_get_ortho(projection, (float)width, (float)height);

    glClearColor(COLOR_BG.r, COLOR_BG.g, COLOR_BG.b, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    if (!state->app->db || !state->app->selected_trace_id[0]) {
        text_render(&state->text, "Select a trace from the list", 20, 30, 1.0f,
                    COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);
        return FALSE;
    }

    OteluxSpanList *spans = store_spans_by_trace(state->app->db,
                                                  state->app->selected_trace_id);
    if (!spans || spans->count == 0) {
        text_render(&state->text, "No spans found", 20, 30, 1.0f,
                    COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);
        store_span_list_free(spans);
        return FALSE;
    }

    /* Find trace time bounds */
    int64_t trace_start = spans->items[0].start_time;
    int64_t trace_end = trace_start;
    for (int i = 0; i < spans->count; i++) {
        if (spans->items[i].start_time < trace_start)
            trace_start = spans->items[i].start_time;
        int64_t end = spans->items[i].start_time + spans->items[i].duration;
        if (end > trace_end) trace_end = end;
    }
    int64_t trace_dur = trace_end - trace_start;
    if (trace_dur <= 0) trace_dur = 1;

    /* Layout constants */
    float label_width = 200.0f;
    float bar_area_x = label_width + 10;
    float bar_area_w = (float)width - bar_area_x - 20;
    float header_h = 30.0f;

    /* Header: trace title + duration */
    char header_buf[128];
    char dur_buf[32];
    time_fmt_duration(trace_dur, dur_buf, sizeof(dur_buf));
    snprintf(header_buf, sizeof(header_buf), "Trace %.8s... (%s)",
             state->app->selected_trace_id, dur_buf);
    text_render(&state->text, header_buf, 10, 8, 1.0f,
                COLOR_FG.r, COLOR_FG.g, COLOR_FG.b, projection);

    /* Time ruler line */
    float ruler_points[] = { bar_area_x, header_h, bar_area_x + bar_area_w, header_h };
    line_render(&state->line, ruler_points, 2,
                COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, 0.5f,
                1.0f, projection);

    /* Render each span as a bar */
    for (int i = 0; i < spans->count; i++) {
        OteluxSpan *s = &spans->items[i];
        int depth = compute_depth(spans, i);
        float y = header_h + 5 + (float)(i * state->row_height);

        /* Span name (indented by depth) */
        float indent = (float)(depth * 12);
        char name_buf[64];
        snprintf(name_buf, sizeof(name_buf), "%.20s", s->name);
        text_render(&state->text, name_buf, 10 + indent, y + 6, 1.0f,
                    COLOR_FG.r, COLOR_FG.g, COLOR_FG.b, projection);

        /* Span bar */
        float bar_start = bar_area_x + bar_area_w *
            ((float)(s->start_time - trace_start) / (float)trace_dur);
        float bar_w = bar_area_w * ((float)s->duration / (float)trace_dur);
        if (bar_w < 2) bar_w = 2;

        OteluxColor c = color_for_service(s->service_name);
        quad_render(&state->quad, bar_start, y + 2, bar_w, (float)state->row_height - 4,
                    c.r, c.g, c.b, 0.8f, projection);

        /* Duration label on bar */
        time_fmt_duration(s->duration, dur_buf, sizeof(dur_buf));
        text_render(&state->text, dur_buf, bar_start + bar_w + 4, y + 6, 0.9f,
                    COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);

        /* Error indicator */
        if (s->status == 2) {
            quad_render(&state->quad, bar_start, y + 2, bar_w, (float)state->row_height - 4,
                        COLOR_ERROR.r, COLOR_ERROR.g, COLOR_ERROR.b, 0.3f, projection);
        }

        /* Selected span highlight */
        if (strcmp(s->span_id, state->app->selected_span_id) == 0) {
            quad_render(&state->quad, 0, y, (float)width, (float)state->row_height,
                        COLOR_ACCENT.r, COLOR_ACCENT.g, COLOR_ACCENT.b, 0.15f, projection);
        }
    }

    store_span_list_free(spans);
    return FALSE;
}

static void on_click(GtkGestureClick *gesture, int n_press,
                     double x, double y, gpointer user_data) {
    (void)gesture; (void)n_press; (void)x;
    WaterfallState *state = (WaterfallState *)user_data;

    int row = (int)((y - 35) / state->row_height);
    if (row < 0) return;

    OteluxSpanList *spans = store_spans_by_trace(state->app->db,
                                                  state->app->selected_trace_id);
    if (spans && row < spans->count) {
        snprintf(state->app->selected_span_id,
                 sizeof(state->app->selected_span_id),
                 "%s", spans->items[row].span_id);
        gtk_widget_queue_draw(
            gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(gesture)));
        /* Refresh detail panel */
        if (state->app->detail_panel) {
            gtk_widget_queue_draw(state->app->detail_panel);
        }
    }
    store_span_list_free(spans);
}

GtkWidget *otelux_trace_waterfall_create(OteluxApp *app) {
    WaterfallState *state = g_new0(WaterfallState, 1);
    state->app = app;

    GtkWidget *gl_area = gtk_gl_area_new();
    gtk_gl_area_set_required_version(GTK_GL_AREA(gl_area), 3, 3);
    gtk_widget_set_hexpand(gl_area, TRUE);
    gtk_widget_set_vexpand(gl_area, TRUE);

    g_signal_connect(gl_area, "realize", G_CALLBACK(on_realize), state);
    g_signal_connect(gl_area, "render", G_CALLBACK(on_render), state);

    GtkGesture *click = gtk_gesture_click_new();
    g_signal_connect(click, "pressed", G_CALLBACK(on_click), state);
    gtk_widget_add_controller(gl_area, GTK_EVENT_CONTROLLER(click));

    app->waterfall_gl = gl_area;
    return gl_area;
}
