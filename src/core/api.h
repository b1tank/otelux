#ifndef OTELUX_CORE_API_H
#define OTELUX_CORE_API_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct otelux_engine otelux_engine_t;
typedef struct otelux_trace_list otelux_trace_list_t;
typedef struct otelux_waterfall otelux_waterfall_t;

enum {
    OTELUX_STATUS_ANY = -1,
    OTELUX_STATUS_UNSET = 0,
    OTELUX_STATUS_OK = 1,
    OTELUX_STATUS_ERROR = 2,
};

enum {
    OTELUX_TRACE_SORT_START_TIME = 0,
    OTELUX_TRACE_SORT_DURATION = 1,
    OTELUX_TRACE_SORT_NAME = 2,
};

typedef struct otelux_trace_query {
    const char *service;
    const char *search;
    int status;
    int sort;
    int descending;
    int limit;
    int offset;
} otelux_trace_query_t;

typedef struct otelux_trace_summary {
    char *trace_id;
    char *name;
    char *service_name;
    int64_t start_time_unix_nano;
    int64_t duration_nano;
    int span_count;
    int has_error;
} otelux_trace_summary_t;

struct otelux_trace_list {
    size_t count;
    size_t total_count;
    otelux_trace_summary_t *items;
};

typedef struct otelux_waterfall_row {
    char *span_id;
    char *parent_span_id;
    char *name;
    char *service_name;
    int kind;
    int status;
    int depth;
    int row;
    int64_t start_time_unix_nano;
    int64_t duration_nano;
    double relative_start;
    double relative_width;
} otelux_waterfall_row_t;

struct otelux_waterfall {
    char *trace_id;
    int64_t trace_start_time_unix_nano;
    int64_t trace_duration_nano;
    size_t count;
    otelux_waterfall_row_t *rows;
};

otelux_engine_t *otelux_engine_create(const char *database_path);
void otelux_engine_destroy(otelux_engine_t *engine);

int otelux_engine_ingest_trace_json(otelux_engine_t *engine, const char *json, size_t length);

otelux_trace_list_t *otelux_query_traces(otelux_engine_t *engine, const otelux_trace_query_t *query);
void otelux_trace_list_destroy(otelux_trace_list_t *list);

otelux_waterfall_t *otelux_get_trace_waterfall(otelux_engine_t *engine, const char *trace_id, const char *const *collapsed_span_ids, size_t collapsed_span_id_count);
void otelux_waterfall_destroy(otelux_waterfall_t *waterfall);

#ifdef __cplusplus
}
#endif

#endif
