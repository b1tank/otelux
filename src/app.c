/*
 * OTelux — Linux-Native OpenTelemetry Viewer
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "app.h"
#include "store/db.h"
#include "ingest/otlp_http.h"
#include "ui/window.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

OteluxApp *otelux_app_new(void) {
    OteluxApp *app = calloc(1, sizeof(OteluxApp));
    if (!app) return NULL;

    app->http_port = 4318;
    app->filter_span_kind = -1;
    snprintf(app->db_path, sizeof(app->db_path), "/tmp/otelux.db");

    return app;
}

void otelux_app_free(OteluxApp *app) {
    if (!app) return;
    if (app->httpd) {
        otlp_http_stop(app);
    }
    if (app->db) {
        db_close(app->db);
        app->db = NULL;
    }
    free(app);
}

void otelux_app_on_activate(GtkApplication *gtk_app, gpointer user_data) {
    OteluxApp *app = (OteluxApp *)user_data;
    app->gtk_app = gtk_app;

    /* Init database */
    app->db = db_open(app->db_path);
    if (!app->db) {
        fprintf(stderr, "ERROR: Failed to open database: %s\n", app->db_path);
        return;
    }
    db_migrate(app->db);

    /* Start OTLP HTTP server */
    if (otlp_http_start(app) != 0) {
        fprintf(stderr, "WARNING: Failed to start OTLP HTTP server on port %d\n",
                app->http_port);
    } else {
        printf("OTLP HTTP server listening on :%d\n", app->http_port);
    }

    /* Build UI */
    otelux_window_create(app);
}

int otelux_app_run(OteluxApp *app, int argc, char **argv) {
    /* Parse CLI args */
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            app->http_port = atoi(argv[++i]);
        } else if (strcmp(argv[i], "--db") == 0 && i + 1 < argc) {
            snprintf(app->db_path, sizeof(app->db_path), "%s", argv[++i]);
        } else if (strcmp(argv[i], "--help") == 0) {
            printf("OTelux v%s — Linux-Native OpenTelemetry Viewer\n\n", OTELUX_VERSION);
            printf("Usage: otelux [OPTIONS]\n\n");
            printf("Options:\n");
            printf("  --port PORT   OTLP HTTP port (default: 4318)\n");
            printf("  --db PATH     SQLite database path (default: /tmp/otelux.db)\n");
            printf("  --help        Show this help message\n");
            return 0;
        }
    }

    app->gtk_app = gtk_application_new("com.otelux.app", G_APPLICATION_FLAGS_NONE);
    g_signal_connect(app->gtk_app, "activate",
                     G_CALLBACK(otelux_app_on_activate), app);

    int status = g_application_run(G_APPLICATION(app->gtk_app), 0, NULL);
    g_object_unref(app->gtk_app);
    return status;
}
