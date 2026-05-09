/*
 * OTelux — Linux-Native OpenTelemetry Viewer
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "app.h"

int main(int argc, char **argv) {
    OteluxApp *app = otelux_app_new();
    if (!app) {
        fprintf(stderr, "ERROR: Failed to allocate app\n");
        return 1;
    }

    int status = otelux_app_run(app, argc, argv);
    otelux_app_free(app);
    return status;
}
