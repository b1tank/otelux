/*
 * OTelux — ingest/otlp_proto.h — OTLP protobuf trace parser
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_INGEST_OTLP_PROTO_H
#define OTELUX_INGEST_OTLP_PROTO_H

#include <sqlite3.h>

/**
 * Parse OTLP/HTTP protobuf trace data and insert into the database.
 * Returns the number of spans inserted, or -1 on error.
 *
 * Parses the ExportTraceServiceRequest protobuf wire format directly,
 * extracting resource attributes, spans, and their metadata.
 */
int otlp_proto_parse_traces(sqlite3 *db, const unsigned char *data, int len);

#endif
