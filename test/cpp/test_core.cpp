#include "../../src/core/api.h"
#include "../testlib.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <string>

namespace {

std::string read_file(const char *path) {
    std::ifstream stream(path, std::ios::binary);
    if (!stream) {
        return {};
    }
    return std::string(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
}

otelux_engine_t *new_memory_engine() {
    return otelux_engine_create(":memory:");
}

int ingest_fixture(otelux_engine_t *engine, const char *path) {
    std::string payload = read_file(path);
    ASSERT_TRUE(!payload.empty());
    return otelux_engine_ingest_trace_json(engine, payload.c_str(), payload.size());
}

static int test_engine_lifecycle(void) {
    otelux_engine_t *engine = new_memory_engine();
    ASSERT_NOT_NULL(engine);
    otelux_engine_destroy(engine);
    return 0;
}

static int test_trace_ingest_fixture(void) {
    otelux_engine_t *engine = new_memory_engine();
    ASSERT_NOT_NULL(engine);
    ASSERT_EQ(ingest_fixture(engine, "test/fixtures/sample_trace.json"), 3);

    otelux_trace_query_t query = {};
    query.status = OTELUX_STATUS_ANY;
    query.sort = OTELUX_TRACE_SORT_START_TIME;
    query.descending = 1;
    query.limit = 10;

    otelux_trace_list_t *traces = otelux_query_traces(engine, &query);
    ASSERT_NOT_NULL(traces);
    ASSERT_EQ(traces->count, 1);
    ASSERT_EQ(traces->total_count, 1);
    ASSERT_STR_EQ(traces->items[0].trace_id, "abcdef1234567890abcdef1234567890");
    ASSERT_STR_EQ(traces->items[0].name, "GET /api/users");
    ASSERT_STR_EQ(traces->items[0].service_name, "api-gateway");
    ASSERT_EQ(traces->items[0].span_count, 3);
    ASSERT_EQ(traces->items[0].duration_nano, 45000000LL);
    ASSERT_EQ(traces->items[0].has_error, 0);

    otelux_trace_list_destroy(traces);
    otelux_engine_destroy(engine);
    return 0;
}

static int test_trace_query_filters(void) {
    otelux_engine_t *engine = new_memory_engine();
    ASSERT_NOT_NULL(engine);
    ASSERT_EQ(ingest_fixture(engine, "test/fixtures/sample_trace.json"), 3);
    ASSERT_EQ(ingest_fixture(engine, "test/fixtures/sample_trace_error.json"), 2);

    otelux_trace_query_t query = {};
    query.status = OTELUX_STATUS_ANY;
    query.sort = OTELUX_TRACE_SORT_NAME;
    query.descending = 0;
    query.limit = 10;

    otelux_trace_list_t *traces = otelux_query_traces(engine, &query);
    ASSERT_NOT_NULL(traces);
    ASSERT_EQ(traces->count, 2);
    ASSERT_EQ(traces->total_count, 2);
    ASSERT_STR_EQ(traces->items[0].name, "GET /api/users");
    otelux_trace_list_destroy(traces);

    query.service = "order-svc";
    traces = otelux_query_traces(engine, &query);
    ASSERT_NOT_NULL(traces);
    ASSERT_EQ(traces->count, 1);
    ASSERT_STR_EQ(traces->items[0].service_name, "order-svc");
    otelux_trace_list_destroy(traces);

    query.service = nullptr;
    query.status = OTELUX_STATUS_ERROR;
    traces = otelux_query_traces(engine, &query);
    ASSERT_NOT_NULL(traces);
    ASSERT_EQ(traces->count, 1);
    ASSERT_EQ(traces->items[0].has_error, 1);
    otelux_trace_list_destroy(traces);

    query.status = OTELUX_STATUS_ANY;
    query.search = "users";
    query.limit = 1;
    query.offset = 0;
    traces = otelux_query_traces(engine, &query);
    ASSERT_NOT_NULL(traces);
    ASSERT_EQ(traces->count, 1);
    ASSERT_EQ(traces->total_count, 1);
    ASSERT_STR_EQ(traces->items[0].name, "GET /api/users");
    otelux_trace_list_destroy(traces);

    otelux_engine_destroy(engine);
    return 0;
}

static int test_trace_reingest_idempotent(void) {
    otelux_engine_t *engine = new_memory_engine();
    ASSERT_NOT_NULL(engine);
    ASSERT_EQ(ingest_fixture(engine, "test/fixtures/sample_trace.json"), 3);
    ASSERT_EQ(ingest_fixture(engine, "test/fixtures/sample_trace.json"), 3);

    otelux_waterfall_t *waterfall = otelux_get_trace_waterfall(engine, "abcdef1234567890abcdef1234567890", nullptr, 0);
    ASSERT_NOT_NULL(waterfall);
    ASSERT_EQ(waterfall->count, 3);
    otelux_waterfall_destroy(waterfall);

    otelux_engine_destroy(engine);
    return 0;
}

static int test_waterfall_layout(void) {
    otelux_engine_t *engine = new_memory_engine();
    ASSERT_NOT_NULL(engine);
    ASSERT_EQ(ingest_fixture(engine, "test/fixtures/sample_trace.json"), 3);

    otelux_waterfall_t *waterfall = otelux_get_trace_waterfall(engine, "abcdef1234567890abcdef1234567890", nullptr, 0);
    ASSERT_NOT_NULL(waterfall);
    ASSERT_EQ(waterfall->count, 3);
    ASSERT_STR_EQ(waterfall->rows[0].span_id, "1111111111111111");
    ASSERT_EQ(waterfall->rows[0].depth, 0);
    ASSERT_EQ(waterfall->rows[1].depth, 1);
    ASSERT_EQ(waterfall->rows[2].depth, 1);
    ASSERT_FLOAT_EQ(waterfall->rows[0].relative_start, 0.0, 0.0001);
    ASSERT_FLOAT_EQ(waterfall->rows[0].relative_width, 1.0, 0.0001);
    ASSERT_TRUE(waterfall->rows[2].relative_start > waterfall->rows[1].relative_start);

    otelux_waterfall_destroy(waterfall);
    otelux_engine_destroy(engine);
    return 0;
}

static int test_waterfall_collapse(void) {
    otelux_engine_t *engine = new_memory_engine();
    ASSERT_NOT_NULL(engine);
    ASSERT_EQ(ingest_fixture(engine, "test/fixtures/sample_trace.json"), 3);

    const char *collapsed[] = {"1111111111111111"};
    otelux_waterfall_t *waterfall = otelux_get_trace_waterfall(engine, "abcdef1234567890abcdef1234567890", collapsed, 1);
    ASSERT_NOT_NULL(waterfall);
    ASSERT_EQ(waterfall->count, 1);
    ASSERT_STR_EQ(waterfall->rows[0].span_id, "1111111111111111");

    otelux_waterfall_destroy(waterfall);
    otelux_engine_destroy(engine);
    return 0;
}

static int test_malformed_payload(void) {
    otelux_engine_t *engine = new_memory_engine();
    ASSERT_NOT_NULL(engine);
    ASSERT_EQ(otelux_engine_ingest_trace_json(engine, "{{broken", 8), -1);

    otelux_trace_query_t query = {};
    query.status = OTELUX_STATUS_ANY;
    query.limit = 10;
    otelux_trace_list_t *traces = otelux_query_traces(engine, &query);
    ASSERT_NOT_NULL(traces);
    ASSERT_EQ(traces->count, 0);
    ASSERT_EQ(traces->total_count, 0);
    otelux_trace_list_destroy(traces);

    otelux_engine_destroy(engine);
    return 0;
}

} // namespace

int main(void) {
    std::printf("test_core:\n");
    RUN_TEST(test_engine_lifecycle);
    RUN_TEST(test_trace_ingest_fixture);
    RUN_TEST(test_trace_query_filters);
    RUN_TEST(test_trace_reingest_idempotent);
    RUN_TEST(test_waterfall_layout);
    RUN_TEST(test_waterfall_collapse);
    RUN_TEST(test_malformed_payload);
    TEST_SUMMARY();
}
