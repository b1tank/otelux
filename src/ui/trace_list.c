/*
 * OTelux — ui/trace_list.c — Trace list (GtkGLArea)
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "trace_list.h"
#include "../render/gl_core.h"
#include "../render/quad.h"
#include "../render/text.h"
#include "../store/traces.h"
#include "../util/color.h"
#include "../util/time_fmt.h"

#include <stdio.h>
#include <string.h>

typedef struct {
    OteluxApp    *app;
    QuadRenderer  quad;
    TextRenderer  text;
    int           gl_initialized;
    int           scroll_offset;
    int           row_height;
} TraceListState;

static const char *SYSTEM_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";

static void on_realize(GtkGLArea *area, gpointer user_data) {
    (void)user_data;
    gtk_gl_area_make_current(area);
}

static gboolean on_render(GtkGLArea *area, GdkGLContext *ctx, gpointer user_data) {
    (void)ctx;
    TraceListState *state = (TraceListState *)user_data;

    if (!state->gl_initialized) {
        gl_core_init();
        quad_renderer_init(&state->quad);

        /* Try to find a monospace font */
        const char *fonts[] = {
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
            "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
            NULL
        };
        const char *font = SYSTEM_FONT;
        for (int i = 0; fonts[i]; i++) {
            FILE *f = fopen(fonts[i], "r");
            if (f) { fclose(f); font = fonts[i]; break; }
        }
        text_renderer_init(&state->text, font, 18);
        state->gl_initialized = 1;
        state->row_height = 36;
    }

    int width = gtk_widget_get_width(GTK_WIDGET(area));
    int height = gtk_widget_get_height(GTK_WIDGET(area));
    int scale = gtk_widget_get_scale_factor(GTK_WIDGET(area));
    gl_core_set_viewport(width * scale, height * scale);

    float projection[16];
    gl_core_get_ortho(projection, (float)width, (float)height);

    /* Clear */
    glClearColor(COLOR_BG.r, COLOR_BG.g, COLOR_BG.b, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    /* Header */
    float rh = (float)state->row_height;
    quad_render(&state->quad, 0, 0, (float)width, rh,
                COLOR_BG_ALT.r, COLOR_BG_ALT.g, COLOR_BG_ALT.b, 1.0f, projection);

    /* Proportional columns based on window width */
    float w = (float)width;
    float col_time    = 12;
    float col_name    = w * 0.18f;
    float col_service = w * 0.42f;
    float col_dur     = w * 0.58f;
    float col_status  = w * 0.82f;
    float text_baseline = (rh - (float)state->text.font_size) * 0.5f;

    text_render(&state->text, "Timestamp", col_time, text_baseline, 1.0f,
                COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);
    text_render(&state->text, "Name", col_name, text_baseline, 1.0f,
                COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);
    text_render(&state->text, "Service", col_service, text_baseline, 1.0f,
                COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);
    text_render(&state->text, "Duration", col_dur, text_baseline, 1.0f,
                COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);
    text_render(&state->text, "Status", col_status, text_baseline, 1.0f,
                COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);

    /* Query traces */
    if (!state->app->db) return FALSE;

    int visible_rows = height / state->row_height;
    OteluxTraceList *traces = store_traces_list(
        state->app->db,
        state->app->filter_service[0] ? state->app->filter_service : NULL,
        state->app->filter_search[0] ? state->app->filter_search : NULL,
        state->app->filter_span_kind,
        visible_rows + 1, state->scroll_offset);

    if (!traces) return FALSE;

    /* Find max duration for proportional bars */
    int64_t max_dur = 1;
    for (int i = 0; i < traces->count; i++) {
        if (traces->items[i].duration > max_dur)
            max_dur = traces->items[i].duration;
    }

    /* Render rows */
    for (int i = 0; i < traces->count; i++) {
        OteluxTrace *t = &traces->items[i];
        float y = (float)((i + 1) * state->row_height);

        /* Alternating row background */
        if (i % 2 == 0) {
            quad_render(&state->quad, 0, y, w, rh,
                        COLOR_BG_ALT.r, COLOR_BG_ALT.g, COLOR_BG_ALT.b, 0.3f, projection);
        }

        /* Error indicator — left border */
        if (t->has_error) {
            quad_render(&state->quad, 0, y, 4, rh,
                        COLOR_ERROR.r, COLOR_ERROR.g, COLOR_ERROR.b, 1.0f, projection);
        } else {
            quad_render(&state->quad, 0, y, 4, rh,
                        COLOR_SUCCESS.r, COLOR_SUCCESS.g, COLOR_SUCCESS.b, 1.0f, projection);
        }

        float text_y = y + text_baseline;

        /* Timestamp */
        char time_buf[32];
        time_fmt_clock(t->start_time, time_buf, sizeof(time_buf));
        text_render(&state->text, time_buf, col_time, text_y, 1.0f,
                    COLOR_FG.r, COLOR_FG.g, COLOR_FG.b, projection);

        /* Name */
        text_render(&state->text, t->root_name, col_name, text_y, 1.0f,
                    COLOR_FG.r, COLOR_FG.g, COLOR_FG.b, projection);

        /* Service */
        OteluxColor svc_color = color_for_service(t->service_name);
        text_render(&state->text, t->service_name, col_service, text_y, 1.0f,
                    svc_color.r, svc_color.g, svc_color.b, projection);

        /* Duration bar */
        float bar_max_w = w * 0.15f;
        float bar_w = bar_max_w * ((float)t->duration / (float)max_dur);
        if (bar_w < 3) bar_w = 3;
        float bar_h = rh * 0.4f;
        float bar_y = y + (rh - bar_h) * 0.5f;
        quad_render(&state->quad, col_dur, bar_y, bar_w, bar_h,
                    COLOR_ACCENT.r, COLOR_ACCENT.g, COLOR_ACCENT.b, 0.7f, projection);

        char dur_buf[32];
        time_fmt_duration(t->duration, dur_buf, sizeof(dur_buf));
        text_render(&state->text, dur_buf, col_dur + bar_w + 6, text_y, 1.0f,
                    COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);

        /* Status */
        const char *status = t->has_error ? "ERR" : "OK";
        OteluxColor sc = t->has_error ? COLOR_ERROR : COLOR_SUCCESS;
        text_render(&state->text, status, col_status, text_y, 1.0f,
                    sc.r, sc.g, sc.b, projection);
    }

    store_trace_list_free(traces);
    return FALSE;
}

static gboolean on_scroll(GtkEventControllerScroll *ctrl,
                           double dx, double dy, gpointer user_data) {
    (void)ctrl; (void)dx;
    TraceListState *state = (TraceListState *)user_data;
    state->scroll_offset += (int)(dy * 3);
    if (state->scroll_offset < 0) state->scroll_offset = 0;
    gtk_widget_queue_draw(GTK_WIDGET(
        gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(ctrl))));
    return TRUE;
}

static void on_click(GtkGestureClick *gesture, int n_press,
                     double x, double y, gpointer user_data) {
    (void)gesture; (void)n_press; (void)x;
    TraceListState *state = (TraceListState *)user_data;

    int row = (int)(y / state->row_height) - 1 + state->scroll_offset;
    if (row < 0) return;

    /* Query the trace at this row */
    OteluxTraceList *traces = store_traces_list(
        state->app->db,
        state->app->filter_service[0] ? state->app->filter_service : NULL,
        state->app->filter_search[0] ? state->app->filter_search : NULL,
        state->app->filter_span_kind,
        row + 1, 0);

    if (traces && row < traces->count) {
        snprintf(state->app->selected_trace_id,
                 sizeof(state->app->selected_trace_id),
                 "%s", traces->items[row].trace_id);

        /* Switch to waterfall view */
        gtk_stack_set_visible_child_name(
            GTK_STACK(state->app->content_stack), "trace-detail");
        if (state->app->waterfall_gl) {
            gtk_widget_queue_draw(state->app->waterfall_gl);
        }
    }

    store_trace_list_free(traces);
}

GtkWidget *otelux_trace_list_create(OteluxApp *app) {
    TraceListState *state = g_new0(TraceListState, 1);
    state->app = app;

    GtkWidget *gl_area = gtk_gl_area_new();
    gtk_gl_area_set_required_version(GTK_GL_AREA(gl_area), 3, 3);
    gtk_widget_set_hexpand(gl_area, TRUE);
    gtk_widget_set_vexpand(gl_area, TRUE);

    g_signal_connect(gl_area, "realize", G_CALLBACK(on_realize), state);
    g_signal_connect(gl_area, "render", G_CALLBACK(on_render), state);

    /* Scroll */
    GtkEventController *scroll_ctrl = gtk_event_controller_scroll_new(
        GTK_EVENT_CONTROLLER_SCROLL_VERTICAL);
    g_signal_connect(scroll_ctrl, "scroll", G_CALLBACK(on_scroll), state);
    gtk_widget_add_controller(gl_area, scroll_ctrl);

    /* Click */
    GtkGesture *click = gtk_gesture_click_new();
    g_signal_connect(click, "pressed", G_CALLBACK(on_click), state);
    gtk_widget_add_controller(gl_area, GTK_EVENT_CONTROLLER(click));

    app->trace_list_gl = gl_area;
    return gl_area;
}
