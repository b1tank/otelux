/*
 * OTelux — store/db.h — SQLite database lifecycle
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_STORE_DB_H
#define OTELUX_STORE_DB_H

#include <sqlite3.h>

sqlite3 *db_open(const char *path);
void     db_close(sqlite3 *db);
int      db_migrate(sqlite3 *db);

#endif
