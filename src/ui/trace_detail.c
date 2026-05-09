/*
 * OTelux — ui/trace_detail.c — Span detail panel (GTK widgets)
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "trace_detail.h"
#include "../store/traces.h"
#include "../util/time_fmt.h"
#include <cJSON/cJSON.h>
#include <stdio.h>
#include <string.h>

typedef struct {
    OteluxApp *app;
    GtkWidget *content_box;
} DetailState;

static void clear_container(GtkWidget *box) {
    GtkWidget *child;
    while ((child = gtk_widget_get_first_child(box)) != NULL) {
        gtk_box_remove(GTK_BOX(box), child);
    }
}

static void add_label(GtkWidget *box, const char *text, gboolean bold) {
    GtkWidget *label = gtk_label_new(text);
    gtk_label_set_xalign(GTK_LABEL(label), 0.0f);
    gtk_label_set_wrap(GTK_LABEL(label), TRUE);
    gtk_label_set_selectable(GTK_LABEL(label), TRUE);
    if (bold) {
        PangoAttrList *attrs = pango_attr_list_new();
        pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
        gtk_label_set_attributes(GTK_LABEL(label), attrs);
        pango_attr_list_unref(attrs);
    }
    gtk_box_append(GTK_BOX(box), label);
}

static void add_kv(GtkWidget *box, const char *key, const char *value) {
    char buf[512];
    snprintf(buf, sizeof(buf), "%s: %s", key, value);
    add_label(box, buf, FALSE);
}

static void refresh_detail(DetailState *state) {
    clear_container(state->content_box);

    if (!state->app->db || !state->app->selected_span_id[0]) {
        add_label(state->content_box, "Click a span to see details", FALSE);
        return;
    }

    OteluxSpan *span = store_span_get(state->app->db, state->app->selected_span_id);
    if (!span) {
        add_label(state->content_box, "Span not found", FALSE);
        return;
    }

    /* Span header */
    add_label(state->content_box, span->name, TRUE);

    GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_box_append(GTK_BOX(state->content_box), sep);

    /* Basic info */
    add_kv(state->content_box, "Span ID", span->span_id);
    add_kv(state->content_box, "Trace ID", span->trace_id);
    if (span->parent_span_id[0]) {
        add_kv(state->content_box, "Parent", span->parent_span_id);
    }
    add_kv(state->content_box, "Service", span->service_name);

    const char *kind_names[] = {"Internal", "Server", "Client", "Producer", "Consumer"};
    const char *kind_str = (span->kind >= 0 && span->kind <= 4) ? kind_names[span->kind] : "Unknown";
    add_kv(state->content_box, "Kind", kind_str);

    const char *status_names[] = {"Unset", "OK", "Error"};
    const char *status_str = (span->status >= 0 && span->status <= 2) ? status_names[span->status] : "Unknown";
    add_kv(state->content_box, "Status", status_str);

    char dur_buf[32];
    time_fmt_duration(span->duration, dur_buf, sizeof(dur_buf));
    add_kv(state->content_box, "Duration", dur_buf);

    char time_buf[64];
    time_fmt_iso(span->start_time, time_buf, sizeof(time_buf));
    add_kv(state->content_box, "Start", time_buf);

    /* Attributes */
    if (span->attributes && span->attributes[0]) {
        GtkWidget *sep2 = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
        gtk_widget_set_margin_top(sep2, 8);
        gtk_box_append(GTK_BOX(state->content_box), sep2);

        add_label(state->content_box, "Attributes", TRUE);

        cJSON *attrs = cJSON_Parse(span->attributes);
        if (attrs) {
            cJSON *item;
            cJSON_ArrayForEach(item, attrs) {
                if (cJSON_IsString(item)) {
                    add_kv(state->content_box, item->string, item->valuestring);
                } else if (cJSON_IsNumber(item)) {
                    char nbuf[64];
                    snprintf(nbuf, sizeof(nbuf), "%g", item->valuedouble);
                    add_kv(state->content_box, item->string, nbuf);
                } else if (cJSON_IsBool(item)) {
                    add_kv(state->content_box, item->string,
                           cJSON_IsTrue(item) ? "true" : "false");
                }
            }
            cJSON_Delete(attrs);
        }
    }

    store_span_free(span);
}

static gboolean on_draw(GtkWidget *widget, gpointer user_data) {
    (void)widget;
    DetailState *state = (DetailState *)user_data;
    refresh_detail(state);
    return FALSE;
}

GtkWidget *otelux_trace_detail_create(OteluxApp *app) {
    DetailState *state = g_new0(DetailState, 1);
    state->app = app;

    GtkWidget *scroll = gtk_scrolled_window_new();
    gtk_widget_set_size_request(scroll, 300, -1);
    gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(scroll),
                                   GTK_POLICY_NEVER, GTK_POLICY_AUTOMATIC);

    state->content_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_margin_start(state->content_box, 12);
    gtk_widget_set_margin_end(state->content_box, 12);
    gtk_widget_set_margin_top(state->content_box, 8);
    gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(scroll), state->content_box);

    add_label(state->content_box, "Click a span to see details", FALSE);

    /* Use map signal to refresh content when panel becomes visible */
    g_signal_connect(scroll, "map", G_CALLBACK(on_draw), state);

    app->detail_panel = scroll;
    return scroll;
}
