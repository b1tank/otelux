#ifndef OTELUX_CORE_ENGINE_HPP
#define OTELUX_CORE_ENGINE_HPP

#include "api.h"

#include <sqlite3.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

struct otelux_engine {
    explicit otelux_engine(sqlite3 *database);
    ~otelux_engine();

    otelux_engine(const otelux_engine &) = delete;
    otelux_engine &operator=(const otelux_engine &) = delete;

    sqlite3 *db;
};

struct SpanRecord {
    std::string traceId;
    std::string spanId;
    std::string parentSpanId;
    std::string name;
    std::string serviceName;
    std::string attributesJson;
    std::string eventsJson;
    int kind = 0;
    int status = OTELUX_STATUS_UNSET;
    int64_t startTime = 0;
    int64_t endTime = 0;

    int64_t duration() const;
};

int migrate_database(sqlite3 *db);
int store_spans(sqlite3 *db, const std::vector<SpanRecord> &spans);
std::vector<SpanRecord> fetch_spans(sqlite3 *db, const std::string &traceId);

#endif
