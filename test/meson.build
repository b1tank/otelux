# OTelux — test/meson.build
# Unit and integration test targets

# Common test dependencies (no GTK/GL needed for headless tests)
test_deps = [sqlite_dep, mhd_dep]

# Unit tests — pure logic, no GPU
test('test_time_fmt',
  executable('test_time_fmt',
    'unit/test_time_fmt.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
)

test('test_color',
  executable('test_color',
    'unit/test_color.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
)

test('test_arena',
  executable('test_arena',
    'unit/test_arena.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
)

test('test_store',
  executable('test_store',
    'unit/test_store.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
)

test('test_otlp_json',
  executable('test_otlp_json',
    'unit/test_otlp_json.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
  workdir: meson.project_source_root(),
)

test('test_otlp_proto',
  executable('test_otlp_proto',
    'unit/test_otlp_proto.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
)

test('test_store_edge',
  executable('test_store_edge',
    'unit/test_store_edge.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
)

# Integration tests
test('test_ingest_store',
  executable('test_ingest_store',
    'integration/test_ingest_store.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
  workdir: meson.project_source_root(),
)

test('test_distributed_trace',
  executable('test_distributed_trace',
    'integration/test_distributed_trace.c',
    include_directories: [glad_inc],
    link_with: otelux_lib,
    dependencies: all_deps,
  ),
  protocol: 'exitcode',
  workdir: meson.project_source_root(),
)
