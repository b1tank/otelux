/*
 * OTelux — ingest/otlp_json.h — OTLP JSON parsing
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_INGEST_OTLP_JSON_H
#define OTELUX_INGEST_OTLP_JSON_H

#include "../store/traces.h"
#include <sqlite3.h>

/* Parse OTLP JSON trace export request body.
 * Inserts parsed spans/traces directly into the database.
 * Returns number of spans parsed, or -1 on error. */
int otlp_json_parse_traces(sqlite3 *db, const char *json, int len);

#endif
