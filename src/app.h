/*
 * OTelux — Linux-Native OpenTelemetry Viewer
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_APP_H
#define OTELUX_APP_H

#include <gtk/gtk.h>
#include <sqlite3.h>
#include <microhttpd.h>

typedef struct {
    GtkApplication *gtk_app;
    GtkWindow      *main_window;
    sqlite3        *db;
    struct MHD_Daemon *httpd;
    int             http_port;
    char            db_path[512];

    /* UI state */
    GtkWidget *sidebar;
    GtkWidget *content_stack;
    GtkWidget *trace_list_gl;
    GtkWidget *waterfall_gl;
    GtkWidget *detail_panel;
    GtkWidget *toolbar;

    /* Current selection */
    char selected_trace_id[33];
    char selected_span_id[33];
    char filter_service[256];
    char filter_search[256];
    int  filter_span_kind;  /* -1 = all */
} OteluxApp;

/* Lifecycle */
OteluxApp *otelux_app_new(void);
void       otelux_app_free(OteluxApp *app);
int        otelux_app_run(OteluxApp *app, int argc, char **argv);

/* Called by GTK activate signal */
void otelux_app_on_activate(GtkApplication *gtk_app, gpointer user_data);

#endif /* OTELUX_APP_H */
