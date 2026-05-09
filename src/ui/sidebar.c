/*
 * OTelux — ui/sidebar.c — Navigation sidebar
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "sidebar.h"

static void on_traces_clicked(GtkButton *btn, gpointer user_data) {
    (void)btn;
    OteluxApp *app = (OteluxApp *)user_data;
    gtk_stack_set_visible_child_name(GTK_STACK(app->content_stack), "trace-list");
}

GtkWidget *otelux_sidebar_create(OteluxApp *app) {
    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_size_request(box, 180, -1);

    /* App title */
    GtkWidget *title = gtk_label_new("OTelux");
    PangoAttrList *attrs = pango_attr_list_new();
    pango_attr_list_insert(attrs, pango_attr_weight_new(PANGO_WEIGHT_BOLD));
    pango_attr_list_insert(attrs, pango_attr_scale_new(1.4));
    gtk_label_set_attributes(GTK_LABEL(title), attrs);
    pango_attr_list_unref(attrs);
    gtk_widget_set_margin_top(title, 16);
    gtk_widget_set_margin_bottom(title, 16);
    gtk_box_append(GTK_BOX(box), title);

    GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_box_append(GTK_BOX(box), sep);

    /* Traces button */
    GtkWidget *btn_traces = gtk_button_new_with_label("Traces");
    gtk_widget_set_margin_start(btn_traces, 8);
    gtk_widget_set_margin_end(btn_traces, 8);
    gtk_widget_set_margin_top(btn_traces, 8);
    g_signal_connect(btn_traces, "clicked", G_CALLBACK(on_traces_clicked), app);
    gtk_box_append(GTK_BOX(box), btn_traces);

    /* Metrics button (placeholder) */
    GtkWidget *btn_metrics = gtk_button_new_with_label("Metrics");
    gtk_widget_set_margin_start(btn_metrics, 8);
    gtk_widget_set_margin_end(btn_metrics, 8);
    gtk_widget_set_sensitive(btn_metrics, FALSE);
    gtk_box_append(GTK_BOX(box), btn_metrics);

    /* Events button (placeholder) */
    GtkWidget *btn_events = gtk_button_new_with_label("Events");
    gtk_widget_set_margin_start(btn_events, 8);
    gtk_widget_set_margin_end(btn_events, 8);
    gtk_widget_set_sensitive(btn_events, FALSE);
    gtk_box_append(GTK_BOX(box), btn_events);

    return box;
}
