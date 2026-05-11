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
    int           total_traces;  /* for scrollbar */
    int           selected_row;  /* keyboard selection, -1 = none */
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
        text_renderer_init(&state->text, font, 18,
                           gtk_widget_get_scale_factor(GTK_WIDGET(area)));
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

    /* Column headers with sort indicators (GNOME System Monitor pattern) */
    struct { const char *label; float x; SortColumn col; } headers[] = {
        { "Timestamp", col_time,    SORT_COL_TIMESTAMP },
        { "Name",      col_name,    SORT_COL_NAME },
        { "Service",   col_service, SORT_COL_SERVICE },
        { "Duration",  col_dur,     SORT_COL_DURATION },
        { "Status",    col_status,  SORT_COL_STATUS },
    };
    for (int i = 0; i < 5; i++) {
        /* Highlight active sort column */
        int is_active = (state->app->sort_column == headers[i].col);
        float cr = is_active ? COLOR_FG.r : COLOR_FG_DIM.r;
        float cg = is_active ? COLOR_FG.g : COLOR_FG_DIM.g;
        float cb = is_active ? COLOR_FG.b : COLOR_FG_DIM.b;

        /* Render label + sort arrow */
        char hdr_buf[64];
        if (is_active) {
            const char *arrow = state->app->sort_ascending ? " ^" : " v";
            snprintf(hdr_buf, sizeof(hdr_buf), "%s%s", headers[i].label, arrow);
        } else {
            snprintf(hdr_buf, sizeof(hdr_buf), "%s", headers[i].label);
        }
        text_render(&state->text, hdr_buf, headers[i].x, text_baseline, 1.0f,
                    cr, cg, cb, projection);
    }

    /* Query traces with current sort */
    if (!state->app->db) return FALSE;

    state->total_traces = store_traces_count(state->app->db);
    int visible_rows = height / state->row_height;
    OteluxTraceList *traces = store_traces_list_sorted(
        state->app->db,
        state->app->filter_service[0] ? state->app->filter_service : NULL,
        state->app->filter_search[0] ? state->app->filter_search : NULL,
        state->app->filter_span_kind,
        state->app->filter_status,
        (int)state->app->sort_column, state->app->sort_ascending,
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

        /* Keyboard selection highlight */
        if (i + state->scroll_offset == state->selected_row) {
            quad_render(&state->quad, 0, y, w, rh,
                        COLOR_ACCENT.r, COLOR_ACCENT.g, COLOR_ACCENT.b, 0.18f, projection);
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

    /* Scrollbar (right edge, like GNOME System Monitor) */
    if (state->total_traces > visible_rows) {
        float sb_w = 6.0f;
        float sb_x = w - sb_w - 2.0f;
        float content_h = (float)height - rh; /* below header */

        /* Track */
        quad_render(&state->quad, sb_x, rh, sb_w, content_h,
                    COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, 0.15f, projection);

        /* Thumb */
        float visible_frac = (float)visible_rows / (float)state->total_traces;
        if (visible_frac > 1.0f) visible_frac = 1.0f;
        float thumb_h = content_h * visible_frac;
        if (thumb_h < 20.0f) thumb_h = 20.0f;

        float scroll_frac = (float)state->scroll_offset /
                            (float)(state->total_traces - visible_rows);
        if (scroll_frac > 1.0f) scroll_frac = 1.0f;
        float thumb_y = rh + (content_h - thumb_h) * scroll_frac;

        quad_render(&state->quad, sb_x, thumb_y, sb_w, thumb_h,
                    COLOR_ACCENT.r, COLOR_ACCENT.g, COLOR_ACCENT.b, 0.6f, projection);
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
    (void)gesture; (void)n_press;
    TraceListState *state = (TraceListState *)user_data;

    GtkWidget *widget = gtk_event_controller_get_widget(
        GTK_EVENT_CONTROLLER(gesture));
    gtk_widget_grab_focus(widget);
    float w = (float)gtk_widget_get_width(widget);

    /* Click on header row → toggle sort column */
    if (y < state->row_height) {
        /* Determine which column was clicked */
        float col_bounds[] = { 0, w * 0.18f, w * 0.42f, w * 0.58f, w * 0.82f, w };
        SortColumn cols[] = {
            SORT_COL_TIMESTAMP, SORT_COL_NAME, SORT_COL_SERVICE,
            SORT_COL_DURATION, SORT_COL_STATUS
        };
        for (int i = 0; i < 5; i++) {
            if (x >= col_bounds[i] && x < col_bounds[i + 1]) {
                if (state->app->sort_column == cols[i]) {
                    /* Same column → toggle direction */
                    state->app->sort_ascending = !state->app->sort_ascending;
                } else {
                    /* New column → set default direction */
                    state->app->sort_column = cols[i];
                    state->app->sort_ascending =
                        (cols[i] == SORT_COL_TIMESTAMP || cols[i] == SORT_COL_DURATION)
                        ? 0 : 1; /* numeric cols default desc, text cols asc */
                }
                state->scroll_offset = 0; /* reset scroll on sort change */
                gtk_widget_queue_draw(widget);
                return;
            }
        }
        return;
    }

    int row = (int)(y / state->row_height) - 1 + state->scroll_offset;
    if (row < 0) return;

    /* Query the trace at this row */
    OteluxTraceList *traces = store_traces_list_sorted(
        state->app->db,
        state->app->filter_service[0] ? state->app->filter_service : NULL,
        state->app->filter_search[0] ? state->app->filter_search : NULL,
        state->app->filter_span_kind,
        state->app->filter_status,
        (int)state->app->sort_column, state->app->sort_ascending,
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
            gtk_widget_grab_focus(state->app->waterfall_gl);
        }
    }

    store_trace_list_free(traces);
}

static void open_selected_trace(TraceListState *state) {
    if (state->selected_row < 0 || !state->app->db) return;

    OteluxTraceList *traces = store_traces_list_sorted(
        state->app->db,
        state->app->filter_service[0] ? state->app->filter_service : NULL,
        state->app->filter_search[0] ? state->app->filter_search : NULL,
        state->app->filter_span_kind,
        state->app->filter_status,
        (int)state->app->sort_column, state->app->sort_ascending,
        state->selected_row + 1, 0);

    if (traces && state->selected_row < traces->count) {
        snprintf(state->app->selected_trace_id,
                 sizeof(state->app->selected_trace_id),
                 "%s", traces->items[state->selected_row].trace_id);
        gtk_stack_set_visible_child_name(
            GTK_STACK(state->app->content_stack), "trace-detail");
        if (state->app->waterfall_gl) {
            gtk_widget_queue_draw(state->app->waterfall_gl);
            gtk_widget_grab_focus(state->app->waterfall_gl);
        }
    }
    store_trace_list_free(traces);
}

static gboolean on_key_pressed(GtkEventControllerKey *ctrl,
                                guint keyval, guint keycode,
                                GdkModifierType mods, gpointer user_data) {
    (void)ctrl; (void)keycode; (void)mods;
    TraceListState *state = (TraceListState *)user_data;
    GtkWidget *widget = gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(ctrl));
    int height = gtk_widget_get_height(widget);
    int visible_rows = height / state->row_height - 1; /* minus header */
    int max_row = state->total_traces - 1;

    switch (keyval) {
        case GDK_KEY_Down:
        case GDK_KEY_j:
            if (state->selected_row < max_row) state->selected_row++;
            break;
        case GDK_KEY_Up:
        case GDK_KEY_k:
            if (state->selected_row > 0) state->selected_row--;
            else state->selected_row = 0;
            break;
        case GDK_KEY_Page_Down:
            state->selected_row += visible_rows;
            if (state->selected_row > max_row) state->selected_row = max_row;
            break;
        case GDK_KEY_Page_Up:
            state->selected_row -= visible_rows;
            if (state->selected_row < 0) state->selected_row = 0;
            break;
        case GDK_KEY_Home:
            state->selected_row = 0;
            break;
        case GDK_KEY_End:
            state->selected_row = max_row;
            break;
        case GDK_KEY_Return:
        case GDK_KEY_KP_Enter:
            open_selected_trace(state);
            return TRUE;
        default:
            return FALSE;
    }

    /* Keep selection visible by adjusting scroll */
    if (state->selected_row < state->scroll_offset) {
        state->scroll_offset = state->selected_row;
    } else if (state->selected_row >= state->scroll_offset + visible_rows) {
        state->scroll_offset = state->selected_row - visible_rows + 1;
    }
    if (state->scroll_offset < 0) state->scroll_offset = 0;

    gtk_widget_queue_draw(widget);
    return TRUE;
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

    /* Keyboard */
    GtkEventController *key_ctrl = gtk_event_controller_key_new();
    g_signal_connect(key_ctrl, "key-pressed", G_CALLBACK(on_key_pressed), state);
    gtk_widget_add_controller(gl_area, key_ctrl);

    gtk_widget_set_focusable(gl_area, TRUE);

    app->trace_list_gl = gl_area;
    return gl_area;
}
