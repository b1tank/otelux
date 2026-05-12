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

#include "trace_detail.h"

#include <stdio.h>
#include <string.h>

typedef struct {
    OteluxApp    *app;
    QuadRenderer  quad;
    TextRenderer  text;
    LineRenderer  line;
    int           gl_initialized;
    int           row_height;
    int           scroll_offset;
    int           total_spans;  /* cached for keyboard nav */

    /* Cached span data — avoid DB query per frame */
    OteluxSpanList *cached_spans;
    int            *cached_depths;
    char            cached_trace_id[33];
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

static void waterfall_invalidate_cache(WaterfallState *state) {
    if (state->cached_spans) {
        store_span_list_free(state->cached_spans);
        state->cached_spans = NULL;
    }
    free(state->cached_depths);
    state->cached_depths = NULL;
    state->cached_trace_id[0] = '\0';
    state->total_spans = 0;
}

/* Ensure cached span list matches current trace_id; reload if stale */
static OteluxSpanList *waterfall_get_spans(WaterfallState *state) {
    const char *tid = state->app->selected_trace_id;
    if (!state->app->db || !tid[0]) {
        waterfall_invalidate_cache(state);
        return NULL;
    }
    /* Cache hit */
    if (state->cached_spans && strcmp(state->cached_trace_id, tid) == 0) {
        return state->cached_spans;
    }
    /* Cache miss — reload */
    waterfall_invalidate_cache(state);
    state->cached_spans = store_spans_by_trace(state->app->db, tid);
    if (!state->cached_spans || state->cached_spans->count == 0) {
        waterfall_invalidate_cache(state);
        return NULL;
    }
    snprintf(state->cached_trace_id, sizeof(state->cached_trace_id), "%s", tid);
    state->total_spans = state->cached_spans->count;

    /* Precompute depths once instead of O(n²) per frame */
    int n = state->cached_spans->count;
    state->cached_depths = calloc((size_t)n, sizeof(int));
    for (int i = 0; i < n; i++) {
        state->cached_depths[i] = compute_depth(state->cached_spans, i);
    }
    return state->cached_spans;
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
        text_renderer_init(&state->text, font, 16,
                           gtk_widget_get_scale_factor(GTK_WIDGET(area)));
        state->gl_initialized = 1;
        state->row_height = 34;
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

    OteluxSpanList *spans = waterfall_get_spans(state);
    if (!spans || spans->count == 0) {
        text_render(&state->text, "No spans found", 20, 30, 1.0f,
                    COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);
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
    float label_width = 250.0f;
    float bar_area_x = label_width + 10;
    float bar_area_w = (float)width - bar_area_x - 20;
    float header_h = 34.0f;

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
    state->total_spans = spans->count;
    int visible_rows = (height - (int)header_h - 5) / state->row_height;
    int first = state->scroll_offset;
    if (first < 0) first = 0;
    int last = first + visible_rows + 1;
    if (last > spans->count) last = spans->count;

    for (int i = first; i < last; i++) {
        OteluxSpan *s = &spans->items[i];
        int depth = state->cached_depths[i];
        float y = header_h + 5 + (float)((i - state->scroll_offset) * state->row_height);

        /* Span name (indented by depth) */
        float indent = (float)(depth * 20);
        char name_buf[64];
        snprintf(name_buf, sizeof(name_buf), "%.24s", s->name);
        float text_y = y + ((float)state->row_height - (float)state->text.font_size) * 0.5f;
        text_render(&state->text, name_buf, 10 + indent, text_y, 1.0f,
                    COLOR_FG.r, COLOR_FG.g, COLOR_FG.b, projection);

        /* Span bar */
        float bar_start = bar_area_x + bar_area_w *
            ((float)(s->start_time - trace_start) / (float)trace_dur);
        float bar_w = bar_area_w * ((float)s->duration / (float)trace_dur);
        if (bar_w < 2) bar_w = 2;

        OteluxColor c = color_for_span_kind(s->kind);
        quad_render(&state->quad, bar_start, y + 4, bar_w, (float)state->row_height - 8,
                    c.r, c.g, c.b, 0.85f, projection);

        /* Duration label — inside bar if it extends past right edge, otherwise after bar */
        time_fmt_duration(s->duration, dur_buf, sizeof(dur_buf));
        float label_w = text_width(&state->text, dur_buf, 0.9f);
        if (bar_start + bar_w + 6 + label_w > (float)width - 10) {
            /* Place inside bar, right-aligned */
            text_render(&state->text, dur_buf, bar_start + bar_w - label_w - 6, text_y, 0.9f,
                        COLOR_FG.r, COLOR_FG.g, COLOR_FG.b, projection);
        } else {
            text_render(&state->text, dur_buf, bar_start + bar_w + 6, text_y, 0.9f,
                        COLOR_FG_DIM.r, COLOR_FG_DIM.g, COLOR_FG_DIM.b, projection);
        }

        /* Error indicator */
        if (s->status == 2) {
            quad_render(&state->quad, bar_start, y + 4, bar_w, (float)state->row_height - 8,
                        COLOR_ERROR.r, COLOR_ERROR.g, COLOR_ERROR.b, 0.35f, projection);
        }

        /* Selected span highlight */
        if (strcmp(s->span_id, state->app->selected_span_id) == 0) {
            quad_render(&state->quad, 0, y, (float)width, (float)state->row_height,
                        COLOR_ACCENT.r, COLOR_ACCENT.g, COLOR_ACCENT.b, 0.15f, projection);
        }
    }

    /* spans owned by cache — do not free here */
    return FALSE;
}

static void on_click(GtkGestureClick *gesture, int n_press,
                     double x, double y, gpointer user_data) {
    (void)gesture; (void)n_press; (void)x;
    WaterfallState *state = (WaterfallState *)user_data;

    GtkWidget *widget = gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(gesture));
    gtk_widget_grab_focus(widget);

    int row = (int)((y - 35) / state->row_height) + state->scroll_offset;
    if (row < 0) return;

    OteluxSpanList *spans = waterfall_get_spans(state);
    if (spans && row < spans->count) {
        snprintf(state->app->selected_span_id,
                 sizeof(state->app->selected_span_id),
                 "%s", spans->items[row].span_id);
        gtk_widget_queue_draw(
            gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(gesture)));
        /* Refresh detail panel */
        if (state->app->detail_panel) {
            otelux_trace_detail_refresh(state->app->detail_panel);
        }
    }
    /* spans owned by cache — do not free */
}

static gboolean on_wf_scroll(GtkEventControllerScroll *ctrl,
                              double dx, double dy, gpointer user_data) {
    (void)ctrl; (void)dx;
    WaterfallState *state = (WaterfallState *)user_data;
    state->scroll_offset += (int)(dy * 3);
    if (state->scroll_offset < 0) state->scroll_offset = 0;
    int max_off = state->total_spans - 5;
    if (max_off < 0) max_off = 0;
    if (state->scroll_offset > max_off) state->scroll_offset = max_off;
    gtk_widget_queue_draw(
        gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(ctrl)));
    return TRUE;
}

static int find_span_index(OteluxSpanList *spans, const char *span_id) {
    for (int i = 0; i < spans->count; i++) {
        if (strcmp(spans->items[i].span_id, span_id) == 0) return i;
    }
    return -1;
}

static gboolean on_wf_key(GtkEventControllerKey *ctrl,
                           guint keyval, guint keycode,
                           GdkModifierType mods, gpointer user_data) {
    (void)ctrl; (void)keycode; (void)mods;
    WaterfallState *state = (WaterfallState *)user_data;
    GtkWidget *widget = gtk_event_controller_get_widget(GTK_EVENT_CONTROLLER(ctrl));

    if (!state->app->db || !state->app->selected_trace_id[0]) return FALSE;

    OteluxSpanList *spans = waterfall_get_spans(state);
    if (!spans || spans->count == 0) {
        return FALSE;
    }

    int cur = find_span_index(spans, state->app->selected_span_id);
    int height = gtk_widget_get_height(widget);
    int visible_rows = (height - 40) / state->row_height;
    int max_idx = spans->count - 1;
    gboolean handled = TRUE;

    switch (keyval) {
        case GDK_KEY_Down:
        case GDK_KEY_j:
            if (cur < max_idx) cur++;
            else if (cur < 0) cur = 0;
            break;
        case GDK_KEY_Up:
        case GDK_KEY_k:
            if (cur > 0) cur--;
            else cur = 0;
            break;
        case GDK_KEY_Page_Down:
            cur += visible_rows;
            if (cur > max_idx) cur = max_idx;
            break;
        case GDK_KEY_Page_Up:
            cur -= visible_rows;
            if (cur < 0) cur = 0;
            break;
        case GDK_KEY_Home:
            cur = 0;
            break;
        case GDK_KEY_End:
            cur = max_idx;
            break;
        case GDK_KEY_Escape:
            /* Back to trace list */
            state->app->selected_span_id[0] = '\0';
            state->scroll_offset = 0;
            waterfall_invalidate_cache(state);
            gtk_stack_set_visible_child_name(
                GTK_STACK(state->app->content_stack), "trace-list");
            if (state->app->trace_list_gl) {
                gtk_widget_queue_draw(state->app->trace_list_gl);
                gtk_widget_grab_focus(state->app->trace_list_gl);
            }
            return TRUE;
        default:
            handled = FALSE;
            break;
    }

    if (handled && cur >= 0 && cur < spans->count) {
        snprintf(state->app->selected_span_id,
                 sizeof(state->app->selected_span_id),
                 "%s", spans->items[cur].span_id);

        /* Keep selection visible */
        if (cur < state->scroll_offset) {
            state->scroll_offset = cur;
        } else if (cur >= state->scroll_offset + visible_rows) {
            state->scroll_offset = cur - visible_rows + 1;
        }

        gtk_widget_queue_draw(widget);
        if (state->app->detail_panel) {
            otelux_trace_detail_refresh(state->app->detail_panel);
        }
    }

    /* spans owned by cache — do not free */
    return handled;
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

    /* Scroll */
    GtkEventController *scroll_ctrl = gtk_event_controller_scroll_new(
        GTK_EVENT_CONTROLLER_SCROLL_VERTICAL);
    g_signal_connect(scroll_ctrl, "scroll", G_CALLBACK(on_wf_scroll), state);
    gtk_widget_add_controller(gl_area, scroll_ctrl);

    /* Keyboard */
    GtkEventController *key_ctrl = gtk_event_controller_key_new();
    g_signal_connect(key_ctrl, "key-pressed", G_CALLBACK(on_wf_key), state);
    gtk_widget_add_controller(gl_area, key_ctrl);

    gtk_widget_set_focusable(gl_area, TRUE);

    app->waterfall_gl = gl_area;
    return gl_area;
}
