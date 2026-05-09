/*
 * OTelux — ui/window.c — Main window with sidebar + content
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "window.h"
#include "sidebar.h"
#include "toolbar.h"
#include "trace_list.h"
#include "trace_waterfall.h"
#include "trace_detail.h"

void otelux_window_create(OteluxApp *app) {
    GtkWidget *window = gtk_application_window_new(app->gtk_app);
    gtk_window_set_title(GTK_WINDOW(window), "OTelux — OpenTelemetry Viewer");
    gtk_window_set_default_size(GTK_WINDOW(window), 1280, 800);
    app->main_window = GTK_WINDOW(window);

    /* Main horizontal layout: sidebar | content */
    GtkWidget *hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
    gtk_window_set_child(GTK_WINDOW(window), hbox);

    /* Sidebar */
    app->sidebar = otelux_sidebar_create(app);
    gtk_box_append(GTK_BOX(hbox), app->sidebar);

    /* Separator */
    GtkWidget *sep = gtk_separator_new(GTK_ORIENTATION_VERTICAL);
    gtk_box_append(GTK_BOX(hbox), sep);

    /* Right side: toolbar + content stack */
    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_widget_set_hexpand(vbox, TRUE);
    gtk_widget_set_vexpand(vbox, TRUE);
    gtk_box_append(GTK_BOX(hbox), vbox);

    /* Toolbar */
    app->toolbar = otelux_toolbar_create(app);
    gtk_box_append(GTK_BOX(vbox), app->toolbar);

    /* Content stack */
    app->content_stack = gtk_stack_new();
    gtk_widget_set_hexpand(app->content_stack, TRUE);
    gtk_widget_set_vexpand(app->content_stack, TRUE);
    gtk_box_append(GTK_BOX(vbox), app->content_stack);

    /* Trace list view (default) */
    GtkWidget *trace_list = otelux_trace_list_create(app);
    gtk_stack_add_named(GTK_STACK(app->content_stack), trace_list, "trace-list");

    /* Trace waterfall + detail (paned) */
    GtkWidget *trace_paned = gtk_paned_new(GTK_ORIENTATION_HORIZONTAL);
    gtk_paned_set_position(GTK_PANED(trace_paned), 800);

    GtkWidget *waterfall = otelux_trace_waterfall_create(app);
    gtk_paned_set_start_child(GTK_PANED(trace_paned), waterfall);

    GtkWidget *detail = otelux_trace_detail_create(app);
    gtk_paned_set_end_child(GTK_PANED(trace_paned), detail);

    gtk_stack_add_named(GTK_STACK(app->content_stack), trace_paned, "trace-detail");

    /* Show trace list by default */
    gtk_stack_set_visible_child_name(GTK_STACK(app->content_stack), "trace-list");

    gtk_window_present(GTK_WINDOW(window));
}
