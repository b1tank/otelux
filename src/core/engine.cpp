#include "engine.hpp"

#include "cJSON/cJSON.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string_view>
#include <utility>

namespace {

constexpr const char *SchemaSql = R"sql(
CREATE TABLE IF NOT EXISTS traces (
    trace_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    service_name TEXT NOT NULL,
    start_time_unix_nano INTEGER NOT NULL,
    duration_nano INTEGER NOT NULL,
    span_count INTEGER NOT NULL,
    has_error INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spans (
    span_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    parent_span_id TEXT NOT NULL,
    name TEXT NOT NULL,
    service_name TEXT NOT NULL,
    kind INTEGER NOT NULL,
    status INTEGER NOT NULL,
    start_time_unix_nano INTEGER NOT NULL,
    duration_nano INTEGER NOT NULL,
    attributes_json TEXT NOT NULL,
    events_json TEXT NOT NULL,
    FOREIGN KEY (trace_id) REFERENCES traces(trace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_traces_time ON traces(start_time_unix_nano);
CREATE INDEX IF NOT EXISTS idx_traces_service ON traces(service_name);
CREATE INDEX IF NOT EXISTS idx_traces_error ON traces(has_error);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id, start_time_unix_nano);
CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service_name);
CREATE INDEX IF NOT EXISTS idx_spans_status ON spans(status);
)sql";

struct TraceSummaryRecord {
    std::string traceId;
    std::string name;
    std::string serviceName;
    int64_t startTime = 0;
    int64_t duration = 0;
    int spanCount = 0;
    int hasError = 0;
};

char *copy_string(const std::string &value) {
    auto *copy = static_cast<char *>(std::malloc(value.size() + 1));
    if (copy == nullptr) {
        return nullptr;
    }
    std::memcpy(copy, value.c_str(), value.size() + 1);
    return copy;
}

std::string json_string(cJSON *object, const char *name) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, name);
    if (cJSON_IsString(item) && item->valuestring != nullptr) {
        return item->valuestring;
    }
    return {};
}

int json_int(cJSON *object, const char *name, int fallback = 0) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, name);
    if (cJSON_IsNumber(item)) {
        return item->valueint;
    }
    return fallback;
}

int64_t json_i64(cJSON *object, const char *name) {
    cJSON *item = cJSON_GetObjectItemCaseSensitive(object, name);
    if (cJSON_IsString(item) && item->valuestring != nullptr) {
        return std::strtoll(item->valuestring, nullptr, 10);
    }
    if (cJSON_IsNumber(item)) {
        return static_cast<int64_t>(item->valuedouble);
    }
    return 0;
}

std::string print_json(cJSON *item) {
    if (item == nullptr) {
        return "[]";
    }
    char *printed = cJSON_PrintUnformatted(item);
    if (printed == nullptr) {
        return "[]";
    }
    std::string result = printed;
    cJSON_free(printed);
    return result;
}

std::string attribute_value_string(cJSON *attribute) {
    cJSON *value = cJSON_GetObjectItemCaseSensitive(attribute, "value");
    if (!cJSON_IsObject(value)) {
        return {};
    }

    for (const char *name : {"stringValue", "intValue", "doubleValue", "boolValue"}) {
        cJSON *item = cJSON_GetObjectItemCaseSensitive(value, name);
        if (cJSON_IsString(item) && item->valuestring != nullptr) {
            return item->valuestring;
        }
        if (cJSON_IsBool(item)) {
            return cJSON_IsTrue(item) ? "true" : "false";
        }
        if (cJSON_IsNumber(item)) {
            return std::to_string(item->valuedouble);
        }
    }

    return {};
}

std::string resource_service_name(cJSON *resourceSpan) {
    cJSON *resource = cJSON_GetObjectItemCaseSensitive(resourceSpan, "resource");
    cJSON *attributes = cJSON_IsObject(resource) ? cJSON_GetObjectItemCaseSensitive(resource, "attributes") : nullptr;
    if (!cJSON_IsArray(attributes)) {
        return "unknown-service";
    }

    cJSON *attribute = nullptr;
    cJSON_ArrayForEach(attribute, attributes) {
        if (json_string(attribute, "key") == "service.name") {
            std::string value = attribute_value_string(attribute);
            return value.empty() ? "unknown-service" : value;
        }
    }

    return "unknown-service";
}

std::optional<std::vector<SpanRecord>> parse_trace_json(const char *json, size_t length) {
    cJSON *root = cJSON_ParseWithLength(json, length);
    if (root == nullptr) {
        return std::nullopt;
    }

    std::unique_ptr<cJSON, decltype(&cJSON_Delete)> rootGuard(root, cJSON_Delete);
    cJSON *resourceSpans = cJSON_GetObjectItemCaseSensitive(root, "resourceSpans");
    if (!cJSON_IsArray(resourceSpans)) {
        return std::nullopt;
    }

    std::vector<SpanRecord> spans;
    cJSON *resourceSpan = nullptr;
    cJSON_ArrayForEach(resourceSpan, resourceSpans) {
        const std::string serviceName = resource_service_name(resourceSpan);
        cJSON *scopeSpans = cJSON_GetObjectItemCaseSensitive(resourceSpan, "scopeSpans");
        if (!cJSON_IsArray(scopeSpans)) {
            continue;
        }

        cJSON *scopeSpan = nullptr;
        cJSON_ArrayForEach(scopeSpan, scopeSpans) {
            cJSON *spanArray = cJSON_GetObjectItemCaseSensitive(scopeSpan, "spans");
            if (!cJSON_IsArray(spanArray)) {
                continue;
            }

            cJSON *span = nullptr;
            cJSON_ArrayForEach(span, spanArray) {
                SpanRecord record;
                record.traceId = json_string(span, "traceId");
                record.spanId = json_string(span, "spanId");
                record.parentSpanId = json_string(span, "parentSpanId");
                record.name = json_string(span, "name");
                record.serviceName = serviceName;
                record.kind = json_int(span, "kind");
                record.startTime = json_i64(span, "startTimeUnixNano");
                record.endTime = json_i64(span, "endTimeUnixNano");
                cJSON *status = cJSON_GetObjectItemCaseSensitive(span, "status");
                record.status = cJSON_IsObject(status) ? json_int(status, "code") : OTELUX_STATUS_UNSET;
                record.attributesJson = print_json(cJSON_GetObjectItemCaseSensitive(span, "attributes"));
                record.eventsJson = print_json(cJSON_GetObjectItemCaseSensitive(span, "events"));

                if (record.traceId.empty() || record.spanId.empty() || record.name.empty()) {
                    return std::nullopt;
                }
                spans.push_back(std::move(record));
            }
        }
    }

    return spans;
}

int exec_sql(sqlite3 *db, const char *sql) {
    char *error = nullptr;
    int rc = sqlite3_exec(db, sql, nullptr, nullptr, &error);
    if (error != nullptr) {
        sqlite3_free(error);
    }
    return rc == SQLITE_OK ? 0 : -1;
}

void bind_text(sqlite3_stmt *statement, int index, const std::string &value) {
    sqlite3_bind_text(statement, index, value.c_str(), static_cast<int>(value.size()), SQLITE_TRANSIENT);
}

int step_done(sqlite3_stmt *statement) {
    return sqlite3_step(statement) == SQLITE_DONE ? 0 : -1;
}

std::vector<TraceSummaryRecord> summarize_spans(const std::vector<SpanRecord> &spans) {
    std::map<std::string, std::vector<const SpanRecord *>> grouped;
    for (const SpanRecord &span : spans) {
        grouped[span.traceId].push_back(&span);
    }

    std::vector<TraceSummaryRecord> summaries;
    summaries.reserve(grouped.size());
    for (auto &[traceId, traceSpans] : grouped) {
        const SpanRecord *root = nullptr;
        const SpanRecord *earliest = nullptr;
        int64_t start = std::numeric_limits<int64_t>::max();
        int64_t end = std::numeric_limits<int64_t>::min();
        bool hasError = false;

        for (const SpanRecord *span : traceSpans) {
            if (span->parentSpanId.empty() && root == nullptr) {
                root = span;
            }
            if (earliest == nullptr || span->startTime < earliest->startTime) {
                earliest = span;
            }
            start = std::min(start, span->startTime);
            end = std::max(end, span->endTime);
            hasError = hasError || span->status == OTELUX_STATUS_ERROR;
        }

        if (root == nullptr) {
            root = earliest;
        }

        TraceSummaryRecord summary;
        summary.traceId = traceId;
        summary.name = root != nullptr ? root->name : traceId;
        summary.serviceName = root != nullptr ? root->serviceName : "unknown-service";
        summary.startTime = start == std::numeric_limits<int64_t>::max() ? 0 : start;
        summary.duration = end > summary.startTime ? end - summary.startTime : 0;
        summary.spanCount = static_cast<int>(traceSpans.size());
        summary.hasError = hasError ? 1 : 0;
        summaries.push_back(std::move(summary));
    }

    return summaries;
}

int delete_existing_spans(sqlite3 *db, const std::vector<TraceSummaryRecord> &summaries) {
    sqlite3_stmt *statement = nullptr;
    if (sqlite3_prepare_v2(db, "DELETE FROM spans WHERE trace_id = ?", -1, &statement, nullptr) != SQLITE_OK) {
        return -1;
    }
    std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> guard(statement, sqlite3_finalize);

    for (const TraceSummaryRecord &summary : summaries) {
        sqlite3_reset(statement);
        sqlite3_clear_bindings(statement);
        bind_text(statement, 1, summary.traceId);
        if (step_done(statement) != 0) {
            return -1;
        }
    }

    return 0;
}

int upsert_traces(sqlite3 *db, const std::vector<TraceSummaryRecord> &summaries) {
    constexpr const char *sql =
        "INSERT INTO traces(trace_id, name, service_name, start_time_unix_nano, duration_nano, span_count, has_error) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(trace_id) DO UPDATE SET "
        "name=excluded.name, service_name=excluded.service_name, start_time_unix_nano=excluded.start_time_unix_nano, "
        "duration_nano=excluded.duration_nano, span_count=excluded.span_count, has_error=excluded.has_error";

    sqlite3_stmt *statement = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) {
        return -1;
    }
    std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> guard(statement, sqlite3_finalize);

    for (const TraceSummaryRecord &summary : summaries) {
        sqlite3_reset(statement);
        sqlite3_clear_bindings(statement);
        bind_text(statement, 1, summary.traceId);
        bind_text(statement, 2, summary.name);
        bind_text(statement, 3, summary.serviceName);
        sqlite3_bind_int64(statement, 4, summary.startTime);
        sqlite3_bind_int64(statement, 5, summary.duration);
        sqlite3_bind_int(statement, 6, summary.spanCount);
        sqlite3_bind_int(statement, 7, summary.hasError);
        if (step_done(statement) != 0) {
            return -1;
        }
    }

    return 0;
}

std::string sort_clause(int sort, int descending) {
    const char *column = "t.start_time_unix_nano";
    if (sort == OTELUX_TRACE_SORT_DURATION) {
        column = "t.duration_nano";
    } else if (sort == OTELUX_TRACE_SORT_NAME) {
        column = "t.name";
    }

    std::string clause = " ORDER BY ";
    clause += column;
    clause += descending == 0 ? " ASC" : " DESC";
    clause += ", t.trace_id ASC";
    return clause;
}

struct WhereClause {
    std::string sql;
    std::vector<std::string> textBindings;
    int status = OTELUX_STATUS_ANY;
};

WhereClause build_where(const otelux_trace_query_t *query) {
    WhereClause where;
    where.sql = " WHERE 1=1";

    if (query != nullptr && query->service != nullptr && query->service[0] != '\0') {
        where.sql += " AND EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND s.service_name = ?)";
        where.textBindings.emplace_back(query->service);
    }
    if (query != nullptr && query->search != nullptr && query->search[0] != '\0') {
        where.sql += " AND t.name LIKE ? ESCAPE '\\'";
        std::string pattern = "%";
        for (char ch : std::string_view(query->search)) {
            if (ch == '%' || ch == '_' || ch == '\\') {
                pattern.push_back('\\');
            }
            pattern.push_back(ch);
        }
        pattern.push_back('%');
        where.textBindings.push_back(std::move(pattern));
    }
    if (query != nullptr && query->status != OTELUX_STATUS_ANY) {
        where.status = query->status;
        where.sql += " AND t.has_error = ?";
    }

    return where;
}

int bind_where(sqlite3_stmt *statement, const WhereClause &where) {
    int index = 1;
    for (const std::string &value : where.textBindings) {
        bind_text(statement, index++, value);
    }
    if (where.status != OTELUX_STATUS_ANY) {
        sqlite3_bind_int(statement, index++, where.status == OTELUX_STATUS_ERROR ? 1 : 0);
    }
    return index;
}

size_t query_total(sqlite3 *db, const WhereClause &where) {
    std::string sql = "SELECT COUNT(*) FROM traces t" + where.sql;
    sqlite3_stmt *statement = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK) {
        return 0;
    }
    std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> guard(statement, sqlite3_finalize);
    bind_where(statement, where);
    if (sqlite3_step(statement) != SQLITE_ROW) {
        return 0;
    }
    return static_cast<size_t>(sqlite3_column_int64(statement, 0));
}

std::string column_text(sqlite3_stmt *statement, int column) {
    const unsigned char *text = sqlite3_column_text(statement, column);
    return text != nullptr ? reinterpret_cast<const char *>(text) : "";
}

struct Node {
    SpanRecord span;
    std::vector<size_t> children;
};

void append_layout_rows(const std::vector<Node> &nodes, size_t index, int depth, const std::set<std::string> &collapsed, int64_t traceStart, int64_t traceDuration, std::vector<otelux_waterfall_row_t> &rows) {
    const SpanRecord &span = nodes[index].span;
    otelux_waterfall_row_t row = {};
    row.span_id = copy_string(span.spanId);
    row.parent_span_id = copy_string(span.parentSpanId);
    row.name = copy_string(span.name);
    row.service_name = copy_string(span.serviceName);
    row.kind = span.kind;
    row.status = span.status;
    row.depth = depth;
    row.row = static_cast<int>(rows.size());
    row.start_time_unix_nano = span.startTime;
    row.duration_nano = span.duration();
    const double divisor = traceDuration > 0 ? static_cast<double>(traceDuration) : 1.0;
    row.relative_start = static_cast<double>(span.startTime - traceStart) / divisor;
    row.relative_width = static_cast<double>(span.duration()) / divisor;
    rows.push_back(row);

    if (collapsed.contains(span.spanId)) {
        return;
    }

    for (size_t child : nodes[index].children) {
        append_layout_rows(nodes, child, depth + 1, collapsed, traceStart, traceDuration, rows);
    }
}

} // namespace

otelux_engine::otelux_engine(sqlite3 *database) : db(database) {
}

otelux_engine::~otelux_engine() {
    if (db != nullptr) {
        sqlite3_close(db);
    }
}

int64_t SpanRecord::duration() const {
    return endTime > startTime ? endTime - startTime : 0;
}

int migrate_database(sqlite3 *db) {
    if (db == nullptr) {
        return -1;
    }
    return exec_sql(db, SchemaSql);
}

int store_spans(sqlite3 *db, const std::vector<SpanRecord> &spans) {
    std::vector<TraceSummaryRecord> summaries = summarize_spans(spans);
    if (exec_sql(db, "BEGIN IMMEDIATE") != 0) {
        return -1;
    }

    auto rollback = [&]() {
        exec_sql(db, "ROLLBACK");
        return -1;
    };

    if (delete_existing_spans(db, summaries) != 0 || upsert_traces(db, summaries) != 0) {
        return rollback();
    }

    constexpr const char *sql =
        "INSERT INTO spans(span_id, trace_id, parent_span_id, name, service_name, kind, status, start_time_unix_nano, duration_nano, attributes_json, events_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    sqlite3_stmt *statement = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) {
        return rollback();
    }
    std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> guard(statement, sqlite3_finalize);

    for (const SpanRecord &span : spans) {
        sqlite3_reset(statement);
        sqlite3_clear_bindings(statement);
        bind_text(statement, 1, span.spanId);
        bind_text(statement, 2, span.traceId);
        bind_text(statement, 3, span.parentSpanId);
        bind_text(statement, 4, span.name);
        bind_text(statement, 5, span.serviceName);
        sqlite3_bind_int(statement, 6, span.kind);
        sqlite3_bind_int(statement, 7, span.status);
        sqlite3_bind_int64(statement, 8, span.startTime);
        sqlite3_bind_int64(statement, 9, span.duration());
        bind_text(statement, 10, span.attributesJson);
        bind_text(statement, 11, span.eventsJson);
        if (step_done(statement) != 0) {
            return rollback();
        }
    }

    if (exec_sql(db, "COMMIT") != 0) {
        return rollback();
    }
    return static_cast<int>(spans.size());
}

std::vector<SpanRecord> fetch_spans(sqlite3 *db, const std::string &traceId) {
    constexpr const char *sql =
        "SELECT trace_id, span_id, parent_span_id, name, service_name, kind, status, start_time_unix_nano, "
        "start_time_unix_nano + duration_nano, attributes_json, events_json "
        "FROM spans WHERE trace_id = ? ORDER BY start_time_unix_nano ASC, name ASC, span_id ASC";
    sqlite3_stmt *statement = nullptr;
    if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) {
        return {};
    }
    std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> guard(statement, sqlite3_finalize);
    bind_text(statement, 1, traceId);

    std::vector<SpanRecord> spans;
    while (sqlite3_step(statement) == SQLITE_ROW) {
        SpanRecord span;
        span.traceId = column_text(statement, 0);
        span.spanId = column_text(statement, 1);
        span.parentSpanId = column_text(statement, 2);
        span.name = column_text(statement, 3);
        span.serviceName = column_text(statement, 4);
        span.kind = sqlite3_column_int(statement, 5);
        span.status = sqlite3_column_int(statement, 6);
        span.startTime = sqlite3_column_int64(statement, 7);
        span.endTime = sqlite3_column_int64(statement, 8);
        span.attributesJson = column_text(statement, 9);
        span.eventsJson = column_text(statement, 10);
        spans.push_back(std::move(span));
    }
    return spans;
}

extern "C" otelux_engine_t *otelux_engine_create(const char *database_path) {
    if (database_path == nullptr) {
        return nullptr;
    }

    sqlite3 *db = nullptr;
    if (sqlite3_open(database_path, &db) != SQLITE_OK) {
        if (db != nullptr) {
            sqlite3_close(db);
        }
        return nullptr;
    }

    if (exec_sql(db, "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;") != 0 || migrate_database(db) != 0) {
        sqlite3_close(db);
        return nullptr;
    }

    try {
        return new otelux_engine(db);
    } catch (...) {
        sqlite3_close(db);
        return nullptr;
    }
}

extern "C" void otelux_engine_destroy(otelux_engine_t *engine) {
    delete engine;
}

extern "C" int otelux_engine_ingest_trace_json(otelux_engine_t *engine, const char *json, size_t length) {
    if (engine == nullptr || json == nullptr) {
        return -1;
    }

    try {
        std::optional<std::vector<SpanRecord>> parsed = parse_trace_json(json, length);
        if (!parsed.has_value()) {
            return -1;
        }
        if (parsed->empty()) {
            return 0;
        }
        return store_spans(engine->db, *parsed);
    } catch (...) {
        return -1;
    }
}

extern "C" otelux_trace_list_t *otelux_query_traces(otelux_engine_t *engine, const otelux_trace_query_t *query) {
    if (engine == nullptr) {
        return nullptr;
    }

    try {
        const int limit = query != nullptr && query->limit > 0 ? query->limit : 100;
        const int offset = query != nullptr && query->offset > 0 ? query->offset : 0;
        const int sort = query != nullptr ? query->sort : OTELUX_TRACE_SORT_START_TIME;
        const int descending = query == nullptr || query->descending != 0;
        WhereClause where = build_where(query);
        std::string sql = "SELECT t.trace_id, t.name, t.service_name, t.start_time_unix_nano, t.duration_nano, t.span_count, t.has_error FROM traces t" + where.sql + sort_clause(sort, descending) + " LIMIT ? OFFSET ?";

        sqlite3_stmt *statement = nullptr;
        if (sqlite3_prepare_v2(engine->db, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK) {
            return nullptr;
        }
        std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> guard(statement, sqlite3_finalize);
        int index = bind_where(statement, where);
        sqlite3_bind_int(statement, index++, limit);
        sqlite3_bind_int(statement, index++, offset);

        std::vector<TraceSummaryRecord> records;
        while (sqlite3_step(statement) == SQLITE_ROW) {
            TraceSummaryRecord record;
            record.traceId = column_text(statement, 0);
            record.name = column_text(statement, 1);
            record.serviceName = column_text(statement, 2);
            record.startTime = sqlite3_column_int64(statement, 3);
            record.duration = sqlite3_column_int64(statement, 4);
            record.spanCount = sqlite3_column_int(statement, 5);
            record.hasError = sqlite3_column_int(statement, 6);
            records.push_back(std::move(record));
        }

        auto *list = static_cast<otelux_trace_list_t *>(std::calloc(1, sizeof(otelux_trace_list_t)));
        if (list == nullptr) {
            return nullptr;
        }
        list->count = records.size();
        list->total_count = query_total(engine->db, where);
        list->items = static_cast<otelux_trace_summary_t *>(std::calloc(records.size(), sizeof(otelux_trace_summary_t)));
        if (!records.empty() && list->items == nullptr) {
            std::free(list);
            return nullptr;
        }

        for (size_t i = 0; i < records.size(); ++i) {
            list->items[i].trace_id = copy_string(records[i].traceId);
            list->items[i].name = copy_string(records[i].name);
            list->items[i].service_name = copy_string(records[i].serviceName);
            list->items[i].start_time_unix_nano = records[i].startTime;
            list->items[i].duration_nano = records[i].duration;
            list->items[i].span_count = records[i].spanCount;
            list->items[i].has_error = records[i].hasError;
        }
        return list;
    } catch (...) {
        return nullptr;
    }
}

extern "C" void otelux_trace_list_destroy(otelux_trace_list_t *list) {
    if (list == nullptr) {
        return;
    }
    for (size_t i = 0; i < list->count; ++i) {
        std::free(list->items[i].trace_id);
        std::free(list->items[i].name);
        std::free(list->items[i].service_name);
    }
    std::free(list->items);
    std::free(list);
}

extern "C" otelux_waterfall_t *otelux_get_trace_waterfall(otelux_engine_t *engine, const char *trace_id, const char *const *collapsed_span_ids, size_t collapsed_span_id_count) {
    if (engine == nullptr || trace_id == nullptr) {
        return nullptr;
    }

    try {
        std::vector<SpanRecord> spans = fetch_spans(engine->db, trace_id);
        if (spans.empty()) {
            return nullptr;
        }

        std::vector<Node> nodes;
        nodes.reserve(spans.size());
        std::map<std::string, size_t> indexBySpanId;
        int64_t traceStart = std::numeric_limits<int64_t>::max();
        int64_t traceEnd = std::numeric_limits<int64_t>::min();

        for (SpanRecord &span : spans) {
            traceStart = std::min(traceStart, span.startTime);
            traceEnd = std::max(traceEnd, span.endTime);
            indexBySpanId[span.spanId] = nodes.size();
            nodes.push_back(Node{std::move(span), {}});
        }

        std::vector<size_t> roots;
        for (size_t i = 0; i < nodes.size(); ++i) {
            const std::string &parent = nodes[i].span.parentSpanId;
            auto parentIt = indexBySpanId.find(parent);
            if (parent.empty() || parentIt == indexBySpanId.end()) {
                roots.push_back(i);
            } else {
                nodes[parentIt->second].children.push_back(i);
            }
        }

        auto sortNodeIndexes = [&](std::vector<size_t> &indexes) {
            std::sort(indexes.begin(), indexes.end(), [&](size_t left, size_t right) {
                const SpanRecord &a = nodes[left].span;
                const SpanRecord &b = nodes[right].span;
                if (a.startTime != b.startTime) {
                    return a.startTime < b.startTime;
                }
                if (a.name != b.name) {
                    return a.name < b.name;
                }
                return a.spanId < b.spanId;
            });
        };
        sortNodeIndexes(roots);
        for (Node &node : nodes) {
            sortNodeIndexes(node.children);
        }

        std::set<std::string> collapsed;
        for (size_t i = 0; i < collapsed_span_id_count; ++i) {
            if (collapsed_span_ids[i] != nullptr) {
                collapsed.emplace(collapsed_span_ids[i]);
            }
        }

        std::vector<otelux_waterfall_row_t> rows;
        const int64_t traceDuration = traceEnd > traceStart ? traceEnd - traceStart : 0;
        for (size_t root : roots) {
            append_layout_rows(nodes, root, 0, collapsed, traceStart, traceDuration, rows);
        }

        auto *waterfall = static_cast<otelux_waterfall_t *>(std::calloc(1, sizeof(otelux_waterfall_t)));
        if (waterfall == nullptr) {
            for (otelux_waterfall_row_t &row : rows) {
                std::free(row.span_id);
                std::free(row.parent_span_id);
                std::free(row.name);
                std::free(row.service_name);
            }
            return nullptr;
        }
        waterfall->trace_id = copy_string(trace_id);
        waterfall->trace_start_time_unix_nano = traceStart;
        waterfall->trace_duration_nano = traceDuration;
        waterfall->count = rows.size();
        waterfall->rows = static_cast<otelux_waterfall_row_t *>(std::calloc(rows.size(), sizeof(otelux_waterfall_row_t)));
        if (!rows.empty() && waterfall->rows == nullptr) {
            otelux_waterfall_destroy(waterfall);
            for (otelux_waterfall_row_t &row : rows) {
                std::free(row.span_id);
                std::free(row.parent_span_id);
                std::free(row.name);
                std::free(row.service_name);
            }
            return nullptr;
        }
        std::copy(rows.begin(), rows.end(), waterfall->rows);
        return waterfall;
    } catch (...) {
        return nullptr;
    }
}

extern "C" void otelux_waterfall_destroy(otelux_waterfall_t *waterfall) {
    if (waterfall == nullptr) {
        return;
    }
    std::free(waterfall->trace_id);
    for (size_t i = 0; i < waterfall->count; ++i) {
        std::free(waterfall->rows[i].span_id);
        std::free(waterfall->rows[i].parent_span_id);
        std::free(waterfall->rows[i].name);
        std::free(waterfall->rows[i].service_name);
    }
    std::free(waterfall->rows);
    std::free(waterfall);
}
