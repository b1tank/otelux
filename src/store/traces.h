/*
 * OTelux — store/traces.h — Trace/span CRUD
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_STORE_TRACES_H
#define OTELUX_STORE_TRACES_H

#include <sqlite3.h>
#include <stdint.h>

typedef struct {
    char     trace_id[33];
    char     root_name[256];
    char     service_name[256];
    int64_t  start_time;   /* unix nanos */
    int64_t  duration;     /* nanos */
    int      span_count;
    int      has_error;
} OteluxTrace;

typedef struct {
    char     span_id[33];
    char     trace_id[33];
    char     parent_span_id[33];
    char     name[256];
    char     service_name[256];
    int      kind;         /* 0=internal,1=server,2=client,3=producer,4=consumer */
    int64_t  start_time;
    int64_t  duration;
    int      status;       /* 0=unset,1=ok,2=error */
    char    *attributes;   /* JSON string, heap-allocated */
    char    *events;       /* JSON array string, heap-allocated */
} OteluxSpan;

typedef struct {
    OteluxTrace *items;
    int          count;
    int          capacity;
} OteluxTraceList;

typedef struct {
    OteluxSpan *items;
    int         count;
    int         capacity;
} OteluxSpanList;

/* Insert */
int store_trace_upsert(sqlite3 *db, const OteluxTrace *trace);
int store_span_insert(sqlite3 *db, const OteluxSpan *span);

/* Query */
OteluxTraceList *store_traces_list(sqlite3 *db, const char *service_filter,
                                   const char *search, int span_kind,
                                   int limit, int offset);
OteluxTraceList *store_traces_list_sorted(sqlite3 *db, const char *service_filter,
                                          const char *search, int span_kind,
                                          int status_filter,
                                          int sort_column, int sort_ascending,
                                          int limit, int offset);
OteluxSpanList  *store_spans_by_trace(sqlite3 *db, const char *trace_id);
OteluxSpan      *store_span_get(sqlite3 *db, const char *span_id);

/* Count */
int store_traces_count(sqlite3 *db);

/* Free */
void store_trace_list_free(OteluxTraceList *list);
void store_span_list_free(OteluxSpanList *list);
void store_span_free(OteluxSpan *span);

#endif
