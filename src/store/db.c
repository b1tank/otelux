/*
 * OTelux — store/db.c — SQLite database lifecycle
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "db.h"
#include <stdio.h>
#include <string.h>

static const char *SCHEMA_SQL =
    "CREATE TABLE IF NOT EXISTS traces ("
    "  trace_id     TEXT PRIMARY KEY,"
    "  root_name    TEXT,"
    "  service_name TEXT,"
    "  start_time   INTEGER,"
    "  duration     INTEGER,"
    "  span_count   INTEGER,"
    "  has_error    INTEGER"
    ");"
    "CREATE TABLE IF NOT EXISTS spans ("
    "  span_id        TEXT PRIMARY KEY,"
    "  trace_id       TEXT NOT NULL,"
    "  parent_span_id TEXT,"
    "  name           TEXT,"
    "  service_name   TEXT,"
    "  kind           INTEGER,"
    "  start_time     INTEGER,"
    "  duration       INTEGER,"
    "  status         INTEGER,"
    "  attributes     TEXT,"
    "  events         TEXT,"
    "  FOREIGN KEY (trace_id) REFERENCES traces(trace_id)"
    ");"
    "CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);"
    "CREATE INDEX IF NOT EXISTS idx_spans_time ON spans(start_time);"
    "CREATE TABLE IF NOT EXISTS metric_points ("
    "  id            INTEGER PRIMARY KEY AUTOINCREMENT,"
    "  name          TEXT,"
    "  unit          TEXT,"
    "  type          INTEGER,"
    "  service_name  TEXT,"
    "  timestamp     INTEGER,"
    "  value         REAL,"
    "  attributes    TEXT,"
    "  exemplar_trace_id TEXT"
    ");"
    "CREATE INDEX IF NOT EXISTS idx_metrics_name ON metric_points(name, timestamp);"
    "CREATE TABLE IF NOT EXISTS events ("
    "  id            INTEGER PRIMARY KEY AUTOINCREMENT,"
    "  trace_id      TEXT,"
    "  span_id       TEXT,"
    "  severity      INTEGER,"
    "  timestamp     INTEGER,"
    "  message       TEXT,"
    "  scope         TEXT,"
    "  service_name  TEXT,"
    "  attributes    TEXT"
    ");"
    "CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp);"
    "CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);";

sqlite3 *db_open(const char *path) {
    sqlite3 *db = NULL;
    int rc = sqlite3_open(path, &db);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "db_open: %s\n", sqlite3_errmsg(db));
        sqlite3_close(db);
        return NULL;
    }

    /* Enable WAL mode for concurrent read/write */
    sqlite3_exec(db, "PRAGMA journal_mode=WAL;", NULL, NULL, NULL);
    sqlite3_exec(db, "PRAGMA synchronous=NORMAL;", NULL, NULL, NULL);
    sqlite3_exec(db, "PRAGMA foreign_keys=ON;", NULL, NULL, NULL);

    return db;
}

void db_close(sqlite3 *db) {
    if (db) sqlite3_close(db);
}

int db_migrate(sqlite3 *db) {
    char *errmsg = NULL;
    int rc = sqlite3_exec(db, SCHEMA_SQL, NULL, NULL, &errmsg);
    if (rc != SQLITE_OK) {
        fprintf(stderr, "db_migrate: %s\n", errmsg);
        sqlite3_free(errmsg);
        return -1;
    }
    return 0;
}
