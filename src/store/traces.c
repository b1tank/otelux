/*
 * OTelux — store/traces.c — Trace/span CRUD operations
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#define _GNU_SOURCE
#include "traces.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int store_trace_upsert(sqlite3 *db, const OteluxTrace *t) {
    const char *sql =
        "INSERT INTO traces "
        "(trace_id, root_name, service_name, start_time, duration, span_count, has_error) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(trace_id) DO UPDATE SET "
        "root_name = CASE WHEN excluded.root_name != '' THEN excluded.root_name ELSE traces.root_name END, "
        "service_name = CASE WHEN excluded.root_name != '' THEN excluded.service_name ELSE traces.service_name END, "
        "start_time = MIN(traces.start_time, excluded.start_time), "
        "duration = MAX(traces.duration, excluded.duration), "
        "span_count = traces.span_count + 1, "
        "has_error = MAX(traces.has_error, excluded.has_error)";
    sqlite3_stmt *stmt;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) return -1;

    sqlite3_bind_text(stmt, 1, t->trace_id, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, t->root_name, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 3, t->service_name, -1, SQLITE_STATIC);
    sqlite3_bind_int64(stmt, 4, t->start_time);
    sqlite3_bind_int64(stmt, 5, t->duration);
    sqlite3_bind_int(stmt, 6, t->span_count);
    sqlite3_bind_int(stmt, 7, t->has_error);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return (rc == SQLITE_DONE) ? 0 : -1;
}

int store_span_insert(sqlite3 *db, const OteluxSpan *s) {
    const char *sql =
        "INSERT OR REPLACE INTO spans "
        "(span_id, trace_id, parent_span_id, name, service_name, kind, "
        "start_time, duration, status, attributes, events) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    sqlite3_stmt *stmt;
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) return -1;

    sqlite3_bind_text(stmt, 1, s->span_id, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, s->trace_id, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 3, s->parent_span_id[0] ? s->parent_span_id : NULL, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 4, s->name, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 5, s->service_name, -1, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 6, s->kind);
    sqlite3_bind_int64(stmt, 7, s->start_time);
    sqlite3_bind_int64(stmt, 8, s->duration);
    sqlite3_bind_int(stmt, 9, s->status);
    sqlite3_bind_text(stmt, 10, s->attributes, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 11, s->events, -1, SQLITE_STATIC);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return (rc == SQLITE_DONE) ? 0 : -1;
}

OteluxTraceList *store_traces_list(sqlite3 *db, const char *service_filter,
                                   const char *search, int span_kind,
                                   int limit, int offset) {
    OteluxTraceList *list = calloc(1, sizeof(OteluxTraceList));
    if (!list) return NULL;

    /* Build query dynamically */
    char sql[1024];
    int pos = snprintf(sql, sizeof(sql),
        "SELECT trace_id, root_name, service_name, start_time, duration, "
        "span_count, has_error FROM traces WHERE 1=1");

    if (service_filter && service_filter[0]) {
        pos += snprintf(sql + pos, sizeof(sql) - (size_t)pos,
            " AND service_name = '%s'", service_filter);
    }
    if (search && search[0]) {
        pos += snprintf(sql + pos, sizeof(sql) - (size_t)pos,
            " AND root_name LIKE '%%%s%%'", search);
    }
    /* span_kind filtering requires a subquery on spans table */
    if (span_kind >= 0) {
        pos += snprintf(sql + pos, sizeof(sql) - (size_t)pos,
            " AND trace_id IN (SELECT DISTINCT trace_id FROM spans WHERE kind = %d)",
            span_kind);
    }
    snprintf(sql + pos, sizeof(sql) - (size_t)pos,
        " ORDER BY start_time DESC LIMIT %d OFFSET %d", limit, offset);

    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        free(list);
        return NULL;
    }

    list->capacity = limit > 0 ? limit : 100;
    list->items = calloc((size_t)list->capacity, sizeof(OteluxTrace));

    while (sqlite3_step(stmt) == SQLITE_ROW && list->count < list->capacity) {
        OteluxTrace *t = &list->items[list->count];
        const char *val;

        val = (const char *)sqlite3_column_text(stmt, 0);
        if (val) snprintf(t->trace_id, sizeof(t->trace_id), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 1);
        if (val) snprintf(t->root_name, sizeof(t->root_name), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 2);
        if (val) snprintf(t->service_name, sizeof(t->service_name), "%s", val);
        t->start_time  = sqlite3_column_int64(stmt, 3);
        t->duration    = sqlite3_column_int64(stmt, 4);
        t->span_count  = sqlite3_column_int(stmt, 5);
        t->has_error   = sqlite3_column_int(stmt, 6);
        list->count++;
    }

    sqlite3_finalize(stmt);
    return list;
}

OteluxTraceList *store_traces_list_sorted(sqlite3 *db, const char *service_filter,
                                          const char *search, int span_kind,
                                          int sort_column, int sort_ascending,
                                          int limit, int offset) {
    OteluxTraceList *list = calloc(1, sizeof(OteluxTraceList));
    if (!list) return NULL;

    char sql[1024];
    int pos = snprintf(sql, sizeof(sql),
        "SELECT trace_id, root_name, service_name, start_time, duration, "
        "span_count, has_error FROM traces WHERE 1=1");

    if (service_filter && service_filter[0]) {
        pos += snprintf(sql + pos, sizeof(sql) - (size_t)pos,
            " AND service_name = '%s'", service_filter);
    }
    if (search && search[0]) {
        pos += snprintf(sql + pos, sizeof(sql) - (size_t)pos,
            " AND root_name LIKE '%%%s%%'", search);
    }
    if (span_kind >= 0) {
        pos += snprintf(sql + pos, sizeof(sql) - (size_t)pos,
            " AND trace_id IN (SELECT DISTINCT trace_id FROM spans WHERE kind = %d)",
            span_kind);
    }

    /* Sort column (like GNOME System Monitor clickable headers) */
    const char *order_col;
    switch (sort_column) {
        case 1:  order_col = "root_name"; break;
        case 2:  order_col = "service_name"; break;
        case 3:  order_col = "duration"; break;
        case 4:  order_col = "has_error"; break;
        default: order_col = "start_time"; break;
    }
    const char *order_dir = sort_ascending ? "ASC" : "DESC";
    snprintf(sql + pos, sizeof(sql) - (size_t)pos,
        " ORDER BY %s %s LIMIT %d OFFSET %d", order_col, order_dir, limit, offset);

    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        free(list);
        return NULL;
    }

    list->capacity = limit > 0 ? limit : 100;
    list->items = calloc((size_t)list->capacity, sizeof(OteluxTrace));

    while (sqlite3_step(stmt) == SQLITE_ROW && list->count < list->capacity) {
        OteluxTrace *t = &list->items[list->count];
        const char *val;

        val = (const char *)sqlite3_column_text(stmt, 0);
        if (val) snprintf(t->trace_id, sizeof(t->trace_id), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 1);
        if (val) snprintf(t->root_name, sizeof(t->root_name), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 2);
        if (val) snprintf(t->service_name, sizeof(t->service_name), "%s", val);
        t->start_time  = sqlite3_column_int64(stmt, 3);
        t->duration    = sqlite3_column_int64(stmt, 4);
        t->span_count  = sqlite3_column_int(stmt, 5);
        t->has_error   = sqlite3_column_int(stmt, 6);
        list->count++;
    }

    sqlite3_finalize(stmt);
    return list;
}

OteluxSpanList *store_spans_by_trace(sqlite3 *db, const char *trace_id) {
    OteluxSpanList *list = calloc(1, sizeof(OteluxSpanList));
    if (!list) return NULL;

    const char *sql =
        "SELECT span_id, trace_id, parent_span_id, name, service_name, kind, "
        "start_time, duration, status, attributes, events "
        "FROM spans WHERE trace_id = ? ORDER BY start_time ASC";

    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        free(list);
        return NULL;
    }
    sqlite3_bind_text(stmt, 1, trace_id, -1, SQLITE_STATIC);

    list->capacity = 64;
    list->items = calloc((size_t)list->capacity, sizeof(OteluxSpan));

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (list->count >= list->capacity) {
            list->capacity *= 2;
            list->items = realloc(list->items, (size_t)list->capacity * sizeof(OteluxSpan));
        }
        OteluxSpan *s = &list->items[list->count];
        memset(s, 0, sizeof(*s));
        const char *val;

        val = (const char *)sqlite3_column_text(stmt, 0);
        if (val) snprintf(s->span_id, sizeof(s->span_id), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 1);
        if (val) snprintf(s->trace_id, sizeof(s->trace_id), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 2);
        if (val) snprintf(s->parent_span_id, sizeof(s->parent_span_id), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 3);
        if (val) snprintf(s->name, sizeof(s->name), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 4);
        if (val) snprintf(s->service_name, sizeof(s->service_name), "%s", val);
        s->kind       = sqlite3_column_int(stmt, 5);
        s->start_time = sqlite3_column_int64(stmt, 6);
        s->duration   = sqlite3_column_int64(stmt, 7);
        s->status     = sqlite3_column_int(stmt, 8);

        val = (const char *)sqlite3_column_text(stmt, 9);
        s->attributes = val ? strdup(val) : NULL;
        val = (const char *)sqlite3_column_text(stmt, 10);
        s->events = val ? strdup(val) : NULL;

        list->count++;
    }

    sqlite3_finalize(stmt);
    return list;
}

OteluxSpan *store_span_get(sqlite3 *db, const char *span_id) {
    const char *sql =
        "SELECT span_id, trace_id, parent_span_id, name, service_name, kind, "
        "start_time, duration, status, attributes, events "
        "FROM spans WHERE span_id = ?";

    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) return NULL;
    sqlite3_bind_text(stmt, 1, span_id, -1, SQLITE_STATIC);

    OteluxSpan *s = NULL;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        s = calloc(1, sizeof(OteluxSpan));
        const char *val;

        val = (const char *)sqlite3_column_text(stmt, 0);
        if (val) snprintf(s->span_id, sizeof(s->span_id), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 1);
        if (val) snprintf(s->trace_id, sizeof(s->trace_id), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 2);
        if (val) snprintf(s->parent_span_id, sizeof(s->parent_span_id), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 3);
        if (val) snprintf(s->name, sizeof(s->name), "%s", val);
        val = (const char *)sqlite3_column_text(stmt, 4);
        if (val) snprintf(s->service_name, sizeof(s->service_name), "%s", val);
        s->kind       = sqlite3_column_int(stmt, 5);
        s->start_time = sqlite3_column_int64(stmt, 6);
        s->duration   = sqlite3_column_int64(stmt, 7);
        s->status     = sqlite3_column_int(stmt, 8);

        val = (const char *)sqlite3_column_text(stmt, 9);
        s->attributes = val ? strdup(val) : NULL;
        val = (const char *)sqlite3_column_text(stmt, 10);
        s->events = val ? strdup(val) : NULL;
    }

    sqlite3_finalize(stmt);
    return s;
}

int store_traces_count(sqlite3 *db) {
    const char *sql = "SELECT COUNT(*) FROM traces";
    sqlite3_stmt *stmt;
    if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) return -1;
    int count = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        count = sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);
    return count;
}

void store_trace_list_free(OteluxTraceList *list) {
    if (!list) return;
    free(list->items);
    free(list);
}

void store_span_list_free(OteluxSpanList *list) {
    if (!list) return;
    for (int i = 0; i < list->count; i++) {
        free(list->items[i].attributes);
        free(list->items[i].events);
    }
    free(list->items);
    free(list);
}

void store_span_free(OteluxSpan *span) {
    if (!span) return;
    free(span->attributes);
    free(span->events);
    free(span);
}
