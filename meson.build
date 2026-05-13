project('otelux', ['cpp', 'c'],
  version : '0.2.0',
  default_options : [
    'cpp_std=c++20',
    'c_std=c17',
    'warning_level=3',
    'werror=true',
    'b_sanitize=address,undefined',
  ],
)

sqlite_dep = dependency('sqlite3')

src_inc = include_directories('src')
cjson_inc = include_directories('vendor')
cjson_src = files('vendor/cJSON/cJSON.c')

core_sources = files(
  'src/core/engine.cpp',
)

otelux_lib = static_library('otelux_core',
  core_sources + cjson_src,
  include_directories : [src_inc, cjson_inc],
  dependencies : [sqlite_dep],
)

otelux_smoke = executable('otelux-smoke',
  files('src/cli/main.cpp'),
  link_with : otelux_lib,
  include_directories : [src_inc, cjson_inc],
  dependencies : [sqlite_dep],
  install : true,
)

subdir('test')
