test_core = executable('test_core',
  files('cpp/test_core.cpp'),
  link_with : otelux_lib,
  include_directories : [src_inc, cjson_inc],
  dependencies : [sqlite_dep],
)

test('test_core',
  test_core,
  protocol : 'exitcode',
  workdir : meson.project_source_root(),
)

test('test_smoke_cli',
  otelux_smoke,
  args : [
    meson.project_build_root() / 'smoke-test.db',
    meson.project_source_root() / 'test/fixtures/sample_trace.json',
  ],
  protocol : 'exitcode',
)
