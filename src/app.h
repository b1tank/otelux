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

/* Sort columns for trace list (matches GNOME System Monitor pattern) */
typedef enum {
    SORT_COL_TIMESTAMP = 0,
    SORT_COL_NAME      = 1,
    SORT_COL_SERVICE   = 2,
    SORT_COL_DURATION  = 3,
    SORT_COL_STATUS    = 4,
} SortColumn;

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

    /* Sort state (like GNOME System Monitor column headers) */
    SortColumn sort_column;     /* which column is sorted */
    int        sort_ascending;  /* 0 = descending (default), 1 = ascending */

    /* Auto-refresh */
    guint      refresh_timer_id; /* g_timeout source id, 0 = none */
    int        auto_refresh;     /* 1 = running, 0 = paused */

    /* Status filter */
    int        filter_status;    /* -1 = all, 0 = unset, 1 = ok, 2 = error */
} OteluxApp;

/* Lifecycle */
OteluxApp *otelux_app_new(void);
void       otelux_app_free(OteluxApp *app);
int        otelux_app_run(OteluxApp *app, int argc, char **argv);

/* Called by GTK activate signal */
void otelux_app_on_activate(GtkApplication *gtk_app, gpointer user_data);

#endif /* OTELUX_APP_H */
