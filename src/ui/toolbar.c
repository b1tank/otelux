/*
 * OTelux — ui/toolbar.c — Top toolbar with search, filters & menu
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "toolbar.h"
#include <stdio.h>

static void on_search_changed(GtkEditable *editable, gpointer user_data) {
    OteluxApp *app = (OteluxApp *)user_data;
    const char *text = gtk_editable_get_text(editable);
    snprintf(app->filter_search, sizeof(app->filter_search), "%s", text);
    if (app->trace_list_gl) {
        gtk_widget_queue_draw(app->trace_list_gl);
    }
}

static void do_refresh(OteluxApp *app) {
    if (app->trace_list_gl) {
        gtk_widget_queue_draw(app->trace_list_gl);
    }
    if (app->waterfall_gl) {
        gtk_widget_queue_draw(app->waterfall_gl);
    }
}

static gboolean on_auto_refresh_tick(gpointer user_data) {
    OteluxApp *app = (OteluxApp *)user_data;
    if (app->auto_refresh) {
        do_refresh(app);
    }
    return G_SOURCE_CONTINUE;
}

static void on_refresh_clicked(GtkButton *btn, gpointer user_data) {
    (void)btn;
    do_refresh((OteluxApp *)user_data);
}

static void on_pause_toggled(GtkToggleButton *btn, gpointer user_data) {
    OteluxApp *app = (OteluxApp *)user_data;
    app->auto_refresh = !gtk_toggle_button_get_active(btn);
    gtk_button_set_label(GTK_BUTTON(btn),
                         app->auto_refresh ? "Pause" : "Resume");
}

static void on_status_changed(GtkDropDown *dropdown, GParamSpec *pspec,
                               gpointer user_data) {
    (void)pspec;
    OteluxApp *app = (OteluxApp *)user_data;
    guint sel = gtk_drop_down_get_selected(dropdown);
    /* 0=All, 1=OK, 2=Error */
    app->filter_status = (sel == 0) ? -1 : (int)sel;
    do_refresh(app);
}

static void on_clear_clicked(GtkButton *btn, gpointer user_data) {
    (void)btn;
    OteluxApp *app = (OteluxApp *)user_data;
    if (app->db) {
        sqlite3_exec(app->db, "DELETE FROM spans; DELETE FROM traces;",
                     NULL, NULL, NULL);
    }
    do_refresh(app);
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

    /* Status filter dropdown */
    const char *status_items[] = { "All", "OK", "Error", NULL };
    GtkStringList *status_model = gtk_string_list_new(status_items);
    GtkWidget *status_dd = gtk_drop_down_new(G_LIST_MODEL(status_model), NULL);
    gtk_drop_down_set_selected(GTK_DROP_DOWN(status_dd), 0);
    g_signal_connect(status_dd, "notify::selected",
                     G_CALLBACK(on_status_changed), app);
    gtk_box_append(GTK_BOX(box), status_dd);

    /* Refresh button */
    GtkWidget *refresh = gtk_button_new_with_label("Refresh");
    g_signal_connect(refresh, "clicked", G_CALLBACK(on_refresh_clicked), app);
    gtk_box_append(GTK_BOX(box), refresh);

    /* Pause/Resume toggle */
    GtkWidget *pause_btn = gtk_toggle_button_new_with_label("Pause");
    g_signal_connect(pause_btn, "toggled", G_CALLBACK(on_pause_toggled), app);
    gtk_box_append(GTK_BOX(box), pause_btn);

    /* Start auto-refresh timer (2s) */
    app->refresh_timer_id = g_timeout_add(2000, on_auto_refresh_tick, app);

    /* Hamburger menu button (GNOME System Monitor pattern) */
    GtkWidget *menu_btn = gtk_menu_button_new();
    gtk_menu_button_set_icon_name(GTK_MENU_BUTTON(menu_btn), "open-menu-symbolic");

    /* Build popover content */
    GtkWidget *menu_box = gtk_box_new(GTK_ORIENTATION_VERTICAL, 4);
    gtk_widget_set_margin_start(menu_box, 12);
    gtk_widget_set_margin_end(menu_box, 12);
    gtk_widget_set_margin_top(menu_box, 8);
    gtk_widget_set_margin_bottom(menu_box, 8);

    /* Port info label */
    char port_info[64];
    snprintf(port_info, sizeof(port_info), "OTLP endpoint :  :%d", app->http_port);
    GtkWidget *port_label = gtk_label_new(port_info);
    gtk_label_set_xalign(GTK_LABEL(port_label), 0.0f);
    gtk_box_append(GTK_BOX(menu_box), port_label);

    /* DB path label */
    GtkWidget *db_label = gtk_label_new(app->db_path);
    gtk_label_set_xalign(GTK_LABEL(db_label), 0.0f);
    gtk_widget_add_css_class(db_label, "dim-label");
    gtk_box_append(GTK_BOX(menu_box), db_label);

    /* Separator */
    gtk_box_append(GTK_BOX(menu_box), gtk_separator_new(GTK_ORIENTATION_HORIZONTAL));

    /* Clear data button */
    GtkWidget *clear_btn = gtk_button_new_with_label("Clear All Data");
    gtk_widget_add_css_class(clear_btn, "destructive-action");
    g_signal_connect(clear_btn, "clicked", G_CALLBACK(on_clear_clicked), app);
    gtk_box_append(GTK_BOX(menu_box), clear_btn);

    GtkWidget *popover = gtk_popover_new();
    gtk_popover_set_child(GTK_POPOVER(popover), menu_box);
    gtk_menu_button_set_popover(GTK_MENU_BUTTON(menu_btn), popover);
    gtk_box_append(GTK_BOX(box), menu_btn);

    return box;
}
