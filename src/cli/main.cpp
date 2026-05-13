#include "core/api.h"

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

} // namespace

int main(int argc, char **argv) {
    if (argc != 3) {
        std::fprintf(stderr, "usage: %s <db-path> <trace-fixture.json>\n", argv[0]);
        return 2;
    }

    std::string payload = read_file(argv[2]);
    if (payload.empty()) {
        std::fprintf(stderr, "failed to read fixture: %s\n", argv[2]);
        return 1;
    }

    otelux_engine_t *engine = otelux_engine_create(argv[1]);
    if (engine == nullptr) {
        std::fprintf(stderr, "failed to create engine\n");
        return 1;
    }

    int ingested = otelux_engine_ingest_trace_json(engine, payload.c_str(), payload.size());
    if (ingested < 0) {
        std::fprintf(stderr, "failed to ingest fixture\n");
        otelux_engine_destroy(engine);
        return 1;
    }

    otelux_trace_query_t query = {};
    query.status = OTELUX_STATUS_ANY;
    query.sort = OTELUX_TRACE_SORT_START_TIME;
    query.descending = 1;
    query.limit = 10;

    otelux_trace_list_t *traces = otelux_query_traces(engine, &query);
    if (traces == nullptr) {
        std::fprintf(stderr, "failed to query traces\n");
        otelux_engine_destroy(engine);
        return 1;
    }

    std::printf("ingested_spans=%d traces=%zu total=%zu\n", ingested, traces->count, traces->total_count);
    for (size_t i = 0; i < traces->count; ++i) {
        std::printf("trace %s %s service=%s spans=%d duration_ns=%lld error=%d\n",
            traces->items[i].trace_id,
            traces->items[i].name,
            traces->items[i].service_name,
            traces->items[i].span_count,
            static_cast<long long>(traces->items[i].duration_nano),
            traces->items[i].has_error);
    }

    otelux_trace_list_destroy(traces);
    otelux_engine_destroy(engine);
    return 0;
}
