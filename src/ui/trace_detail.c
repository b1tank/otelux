/*
 * OTelux — ui/trace_detail.c — Span detail panel (GTK widgets)
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 *
 * Collapsible sections: Header, Properties (attributes), Context (IDs),
 * Resource, Events, Links — matching Aspire SpanDetails.razor layout.
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
    GtkWidget *hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 6);
    gtk_widget_set_margin_top(hbox, 2);

    GtkWidget *k = gtk_label_new(key);
    gtk_label_set_xalign(GTK_LABEL(k), 0.0f);
    gtk_widget_add_css_class(k, "dim-label");
    gtk_widget_set_size_request(k, 100, -1);
    gtk_box_append(GTK_BOX(hbox), k);

    GtkWidget *v = gtk_label_new(value);
    gtk_label_set_xalign(GTK_LABEL(v), 0.0f);
    gtk_label_set_wrap(GTK_LABEL(v), TRUE);
    gtk_label_set_selectable(GTK_LABEL(v), TRUE);
    gtk_widget_set_hexpand(v, TRUE);
    gtk_box_append(GTK_BOX(hbox), v);

    gtk_box_append(GTK_BOX(box), hbox);
}

/* Create a collapsible GtkExpander section with a title + item count badge */
static GtkWidget *add_section(GtkWidget *parent, const char *title, int count) {
    char label_buf[128];
    if (count >= 0) {
        snprintf(label_buf, sizeof(label_buf), "%s (%d)", title, count);
    } else {
        snprintf(label_buf, sizeof(label_buf), "%s", title);
    }
    GtkWidget *expander = gtk_expander_new(label_buf);
    gtk_expander_set_expanded(GTK_EXPANDER(expander), TRUE);
    gtk_widget_set_margin_top(expander, 8);

    GtkWidget *inner = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
    gtk_widget_set_margin_start(inner, 8);
    gtk_expander_set_child(GTK_EXPANDER(expander), inner);

    gtk_box_append(GTK_BOX(parent), expander);
    return inner;
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

    /* ── Header ── */
    add_label(state->content_box, span->name, TRUE);

    const char *kind_names[] = {"Internal", "Server", "Client", "Producer", "Consumer"};
    const char *kind_str = (span->kind >= 0 && span->kind <= 4) ? kind_names[span->kind] : "Unknown";

    const char *status_names[] = {"Unset", "OK", "Error"};
    const char *status_str = (span->status >= 0 && span->status <= 2) ? status_names[span->status] : "Unknown";

    char dur_buf[32];
    time_fmt_duration(span->duration, dur_buf, sizeof(dur_buf));

    char time_buf[64];
    time_fmt_iso(span->start_time, time_buf, sizeof(time_buf));

    char summary[512];
    snprintf(summary, sizeof(summary), "%s  ·  %s  ·  %s  ·  %s",
             span->service_name, kind_str, status_str, dur_buf);
    add_label(state->content_box, summary, FALSE);

    GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_widget_set_margin_top(sep, 6);
    gtk_box_append(GTK_BOX(state->content_box), sep);

    /* ── Context section (IDs) ── */
    GtkWidget *ctx_box = add_section(state->content_box, "Context", -1);
    add_kv(ctx_box, "Span ID", span->span_id);
    add_kv(ctx_box, "Trace ID", span->trace_id);
    if (span->parent_span_id[0]) {
        add_kv(ctx_box, "Parent ID", span->parent_span_id);
    }
    add_kv(ctx_box, "Service", span->service_name);
    add_kv(ctx_box, "Kind", kind_str);
    add_kv(ctx_box, "Status", status_str);
    add_kv(ctx_box, "Duration", dur_buf);
    add_kv(ctx_box, "Start", time_buf);

    /* ── Properties (attributes) ── */
    int attr_count = 0;
    cJSON *attrs = NULL;
    if (span->attributes && span->attributes[0]) {
        attrs = cJSON_Parse(span->attributes);
        if (attrs) {
            cJSON *item;
            cJSON_ArrayForEach(item, attrs) { attr_count++; }
        }
    }

    GtkWidget *attr_box = add_section(state->content_box, "Properties", attr_count);
    if (attrs) {
        cJSON *item;
        cJSON_ArrayForEach(item, attrs) {
            if (cJSON_IsString(item)) {
                add_kv(attr_box, item->string, item->valuestring);
            } else if (cJSON_IsNumber(item)) {
                char nbuf[64];
                snprintf(nbuf, sizeof(nbuf), "%g", item->valuedouble);
                add_kv(attr_box, item->string, nbuf);
            } else if (cJSON_IsBool(item)) {
                add_kv(attr_box, item->string, cJSON_IsTrue(item) ? "true" : "false");
            }
        }
        cJSON_Delete(attrs);
    } else {
        add_label(attr_box, "No attributes", FALSE);
    }

    /* ── Events ── */
    int event_count = 0;
    cJSON *events = NULL;
    if (span->events && span->events[0]) {
        events = cJSON_Parse(span->events);
        if (events && cJSON_IsArray(events)) {
            event_count = cJSON_GetArraySize(events);
        }
    }

    GtkWidget *evt_box = add_section(state->content_box, "Events", event_count);
    if (events && event_count > 0) {
        cJSON *evt;
        cJSON_ArrayForEach(evt, events) {
            /* Each event: { "name": "...", "timeUnixNano": ..., "attributes": {...} } */
            cJSON *ename = cJSON_GetObjectItem(evt, "name");
            cJSON *etime = cJSON_GetObjectItem(evt, "timeUnixNano");

            char evt_label[256];
            if (ename && etime) {
                char evt_time[32];
                time_fmt_duration(etime->valuedouble > 0 ?
                    (int64_t)etime->valuedouble - span->start_time : 0,
                    evt_time, sizeof(evt_time));
                snprintf(evt_label, sizeof(evt_label), "+%s  %s",
                         evt_time, ename->valuestring);
            } else if (ename) {
                snprintf(evt_label, sizeof(evt_label), "%s", ename->valuestring);
            } else {
                snprintf(evt_label, sizeof(evt_label), "(unnamed event)");
            }

            GtkWidget *evt_exp = gtk_expander_new(evt_label);
            gtk_expander_set_expanded(GTK_EXPANDER(evt_exp), FALSE);
            GtkWidget *evt_inner = gtk_box_new(GTK_ORIENTATION_VERTICAL, 2);
            gtk_widget_set_margin_start(evt_inner, 12);

            cJSON *eattrs = cJSON_GetObjectItem(evt, "attributes");
            if (eattrs) {
                cJSON *ea;
                cJSON_ArrayForEach(ea, eattrs) {
                    if (cJSON_IsString(ea)) {
                        add_kv(evt_inner, ea->string, ea->valuestring);
                    } else if (cJSON_IsNumber(ea)) {
                        char nbuf[64];
                        snprintf(nbuf, sizeof(nbuf), "%g", ea->valuedouble);
                        add_kv(evt_inner, ea->string, nbuf);
                    }
                }
            } else {
                add_label(evt_inner, "No attributes", FALSE);
            }

            gtk_expander_set_child(GTK_EXPANDER(evt_exp), evt_inner);
            gtk_box_append(GTK_BOX(evt_box), evt_exp);
        }
    } else {
        add_label(evt_box, "No events", FALSE);
    }
    if (events) cJSON_Delete(events);

    store_span_free(span);
}

static gboolean on_draw(GtkWidget *widget, gpointer user_data) {
    (void)widget;
    DetailState *state = (DetailState *)user_data;
    refresh_detail(state);
    return FALSE;
}

/* Public refresh function called from waterfall click */
void otelux_trace_detail_refresh(GtkWidget *panel) {
    if (!panel) return;
    /* Emit a map signal to trigger refresh */
    g_signal_emit_by_name(panel, "map");
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
