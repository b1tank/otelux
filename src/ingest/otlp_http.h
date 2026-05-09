/*
 * OTelux — ingest/otlp_http.h — OTLP HTTP server
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_INGEST_OTLP_HTTP_H
#define OTELUX_INGEST_OTLP_HTTP_H

#include "../app.h"

int  otlp_http_start(OteluxApp *app);
void otlp_http_stop(OteluxApp *app);

#endif
