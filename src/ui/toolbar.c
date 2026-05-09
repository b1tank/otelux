/*
 * OTelux — ui/toolbar.c — Top toolbar with search & filters
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "toolbar.h"

static void on_search_changed(GtkEditable *editable, gpointer user_data) {
    OteluxApp *app = (OteluxApp *)user_data;
    const char *text = gtk_editable_get_text(editable);
    snprintf(app->filter_search, sizeof(app->filter_search), "%s", text);
    if (app->trace_list_gl) {
        gtk_widget_queue_draw(app->trace_list_gl);
    }
}

static void on_refresh_clicked(GtkButton *btn, gpointer user_data) {
    (void)btn;
    OteluxApp *app = (OteluxApp *)user_data;
    if (app->trace_list_gl) {
        gtk_widget_queue_draw(app->trace_list_gl);
    }
}

GtkWidget *otelux_toolbar_create(OteluxApp *app) {
    GtkWidget *box = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    gtk_widget_set_margin_start(box, 8);
    gtk_widget_set_margin_end(box, 8);
    gtk_widget_set_margin_top(box, 4);
    gtk_widget_set_margin_bottom(box, 4);

    /* Search entry */
    GtkWidget *search = gtk_search_entry_new();
    gtk_widget_set_hexpand(search, TRUE);
    g_signal_connect(search, "changed", G_CALLBACK(on_search_changed), app);
    gtk_box_append(GTK_BOX(box), search);

    /* Refresh button */
    GtkWidget *refresh = gtk_button_new_with_label("Refresh");
    g_signal_connect(refresh, "clicked", G_CALLBACK(on_refresh_clicked), app);
    gtk_box_append(GTK_BOX(box), refresh);

    return box;
}
